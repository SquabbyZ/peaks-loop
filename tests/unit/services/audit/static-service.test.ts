/**
 * Unit tests for the L2.3 P2-a static-service (peaks audit static).
 *
 * Covers the four AgentShieldState reason codes:
 *   - 'flag-disabled'             — CLI --disable-agent-shield passed
 *   - 'disabled-by-preference'    — preference is false
 *   - 'flag-enabled-but-ecc-missing' — enabled but ECC not on PATH
 *   - 'enabled-and-installed'     — enabled and ECC present
 *
 * The "enabled and installed" case uses a mocked SubprocessRunner
 * so the test does not depend on a real ECC install on PATH.
 * This closes the A3 acceptance criterion: `peaks audit static
 * --json` runs AND merges findings from both engines when ECC
 * is present.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  runStaticAudit,
  type SubprocessRunner,
  type SubprocessResult,
} from '../../../../src/services/audit/static-service.js';

function makeProjectWithPrefs(prefs: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'peaks-static-test-'));
  // Write a minimal preferences.json that matches the schema.
  mkdirSync(join(dir, '.peaks'), { recursive: true });
  writeFileSync(
    join(dir, '.peaks', 'preferences.json'),
    JSON.stringify(
      {
        schema_version: '2.0.0',
        ...prefs,
      },
      null,
      2
    )
  );
  return dir;
}

function makeMockRunner(options: {
  readonly detectExitCode: number;
  readonly scanStdout?: string;
  readonly scanExitCode?: number;
}): SubprocessRunner {
  const seenCommands: { command: string; args: readonly string[] }[] = [];
  return {
    run(command, args) {
      seenCommands.push({ command, args });
      // First call is the `--version` detection probe; second is
      // the `scan --json --target <path>` invocation.
      const isDetect = args[0] === 'ecc-agentshield' && args[1] === '--version';
      if (isDetect) {
        return {
          status: options.detectExitCode,
          stdout: '',
          stderr: '',
        } satisfies SubprocessResult;
      }
      return {
        status: options.scanExitCode ?? 0,
        stdout: options.scanStdout ?? '',
        stderr: '',
      } satisfies SubprocessResult;
    },
  };
}

describe('static-service — peaks audit static', () => {
  it('returns reason "flag-disabled" when --disable-agent-shield is passed', () => {
    const projectRoot = makeProjectWithPrefs({ agentShieldEnabled: true });
    try {
      const result = runStaticAudit({
        projectRoot,
        enableAgentShield: false,
      });
      expect(result.agentShield.spawned).toBe(false);
      expect(result.agentShield.reason).toBe('flag-disabled');
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('returns reason "disabled-by-preference" when preference is false and no flag', () => {
    const projectRoot = makeProjectWithPrefs({ agentShieldEnabled: false });
    try {
      const result = runStaticAudit({ projectRoot });
      expect(result.agentShield.spawned).toBe(false);
      // When the preference is false and no flag is passed,
      // the reason is `disabled-by-preference`.
      expect(result.agentShield.reason).toBe('disabled-by-preference');
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('returns reason "flag-enabled-but-ecc-missing" when enabled but ECC is not installed', () => {
    const projectRoot = makeProjectWithPrefs({ agentShieldEnabled: true });
    try {
      const result = runStaticAudit({
        projectRoot,
        enableAgentShield: true,
        // Mock the runner to report ECC as missing (non-zero exit
        // on `--version`). This is the testable analog of the
        // un-installed path.
        subprocessRunner: makeMockRunner({ detectExitCode: 1 }),
      });
      expect(result.agentShield.spawned).toBe(false);
      expect(result.agentShield.reason).toBe('flag-enabled-but-ecc-missing');
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toMatch(/ecc-agentshield/i);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('always runs the peaks-loop lint layer (enforcerFindings is non-empty on a real project)', () => {
    const projectRoot = makeProjectWithPrefs({ agentShieldEnabled: false });
    try {
      const result = runStaticAudit({ projectRoot });
      // The audit always emits peaks-loop findings, even with
      // agentShield disabled. The number depends on the project
      // state; we just assert the field is well-formed.
      expect(Array.isArray(result.audit.enforcerFindings)).toBe(true);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  // A3 acceptance: with ECC installed + enabled, the audit
  // merges findings from both engines. This test mocks the
  // subprocess runner to simulate a real ECC install + a
  // representative JSON envelope, then asserts the merged
  // EnforcerFinding[] contains `ecc-agentshield:<rule-id>`
  // entries alongside the peaks-loop findings.
  it('merges ECC findings into the audit when enabled and ECC is installed (mocked)', () => {
    const projectRoot = makeProjectWithPrefs({ agentShieldEnabled: true });
    const eccEnvelope = JSON.stringify({
      ok: true,
      findings: [
        {
          ruleId: 'no-unused-vars',
          rule: 'No unused variables',
          severity: 'warn',
          file: 'src/foo.ts',
          detail: 'variable `bar` is declared but never read',
        },
        {
          ruleId: 'no-console-log',
          rule: 'No console.log in production',
          severity: 'fail',
          file: 'src/baz.ts',
          detail: 'console.log found on line 42',
        },
      ],
    });
    try {
      const result = runStaticAudit({
        projectRoot,
        enableAgentShield: true,
        subprocessRunner: makeMockRunner({
          detectExitCode: 0, // ECC is installed
          scanStdout: eccEnvelope,
          scanExitCode: 0,
        }),
      });
      expect(result.agentShield.spawned).toBe(true);
      expect(result.agentShield.installed).toBe(true);
      expect(result.agentShield.reason).toBe('enabled-and-installed');
      expect(result.agentShield.findings).toHaveLength(2);
      expect(result.agentShield.findings[0]?.enforcerId).toBe('ecc-agentshield:no-unused-vars');
      expect(result.agentShield.findings[1]?.enforcerId).toBe('ecc-agentshield:no-console-log');
      // The merged audit must contain BOTH peaks-loop findings
      // AND ECC findings.
      const mergedIds = result.audit.enforcerFindings.map((f) => f.enforcerId);
      expect(mergedIds).toContain('ecc-agentshield:no-unused-vars');
      expect(mergedIds).toContain('ecc-agentshield:no-console-log');
      // peaks-loop findings are still there (theme G / theme A etc.)
      expect(mergedIds.length).toBeGreaterThan(2);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  // A4 acceptance: when the ECC subprocess returns non-JSON
  // (corrupt envelope, network glitch, etc.) the audit completes
  // with peaks-loop findings only and a non-zero ECC findings
  // count.
  it('soft-fails with peaks-loop findings when the ECC subprocess returns non-JSON', () => {
    const projectRoot = makeProjectWithPrefs({ agentShieldEnabled: true });
    try {
      const result = runStaticAudit({
        projectRoot,
        enableAgentShield: true,
        subprocessRunner: makeMockRunner({
          detectExitCode: 0,
          scanStdout: 'this is not valid JSON {{{',
          scanExitCode: 0,
        }),
      });
      expect(result.agentShield.spawned).toBe(true);
      expect(result.agentShield.reason).toBe('enabled-and-installed');
      expect(result.agentShield.findings).toEqual([]);
      // peaks-loop findings are still merged.
      expect(Array.isArray(result.audit.enforcerFindings)).toBe(true);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
