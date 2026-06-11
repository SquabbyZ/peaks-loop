/**
 * Unit tests for the ECC 64 agents soft-optional wrapper.
 *
 * Per spec §7.2 line 818, the canonical subprocess is
 * `npx ecc agent run <name> --target <path> --json`. The
 * wrapper service in `src/services/agent/ecc-agent-service.ts`
 * mirrors `static-service.ts` (L2.3 P2-a AgentShield wrapper):
 * the same 5-state reason enum, the same SubprocessRunner
 * injection point, the same 4-option install prompt UX.
 */
import { describe, it, expect } from 'vitest';
import {
  runEccAgent,
  validateEccAgent,
  CANONICAL_ECC_AGENTS,
  type SubprocessRunner,
  type SubprocessResult,
} from '../../../../src/services/agent/ecc-agent-service.js';

function makeMockRunner(options: {
  readonly detectExitCode: number;
  readonly runStdout?: string;
  readonly runStatus?: number;
  readonly runError?: Error;
}): SubprocessRunner {
  return {
    run(_command, args) {
      // First call is the `--version` detection probe; second is
      // the `agent run --json --target <path>` invocation.
      const isDetect = args[0] === 'ecc' && args[1] === '--version';
      if (isDetect) {
        const r: SubprocessResult = {
          status: options.detectExitCode,
          stdout: '',
          stderr: '',
        };
        return r;
      }
      const r: SubprocessResult = {
        status: options.runStatus ?? 0,
        stdout: options.runStdout ?? '',
        stderr: '',
        ...(options.runError !== undefined ? { error: options.runError } : {}),
      };
      return r;
    },
  };
}

describe('ecc-agent-service — 64 agents soft-optional', () => {
  it('ships 12 canonical agents (most-used subset of the 64)', () => {
    expect(CANONICAL_ECC_AGENTS).toHaveLength(12);
    const names = CANONICAL_ECC_AGENTS.map((a) => a.name);
    expect(names).toContain('security-reviewer');
    expect(names).toContain('code-reviewer');
    expect(names).toContain('typescript-reviewer');
  });

  describe('validateEccAgent', () => {
    it('accepts a canonical agent name', () => {
      expect(validateEccAgent('security-reviewer')).toBeNull();
    });

    it('accepts a non-canonical but well-formed name (ECC may have 64 agents)', () => {
      expect(validateEccAgent('rust-reviewer')).toBeNull();
    });

    it('rejects an empty string', () => {
      expect(validateEccAgent('')).toMatch(/non-empty/);
    });

    it('rejects a name with invalid characters', () => {
      expect(validateEccAgent('Security Reviewer')).toMatch(/invalid/);
      expect(validateEccAgent('agent/with/slash')).toMatch(/invalid/);
    });
  });

  describe('runEccAgent', () => {
    it('returns reason "flag-disabled" when enableAgent is false', () => {
      const runner = makeMockRunner({ detectExitCode: 0 });
      const result = runEccAgent(
        { agent: 'security-reviewer', projectRoot: '.', enableAgent: false },
        runner
      );
      expect(result.spawned).toBe(false);
      expect(result.reason).toBe('flag-disabled');
      expect(result.result).toBeNull();
    });

    it('returns reason "flag-enabled-but-ecc-missing" when ECC is not installed', () => {
      const runner = makeMockRunner({ detectExitCode: 1 });
      const result = runEccAgent(
        { agent: 'security-reviewer', projectRoot: '.', enableAgent: true },
        runner
      );
      expect(result.spawned).toBe(false);
      expect(result.reason).toBe('flag-enabled-but-ecc-missing');
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toMatch(/ecc --version/);
    });

    it('returns reason "enabled-and-installed" + parsed JSON when ECC is present', () => {
      const envelope = JSON.stringify({
        findings: [
          { severity: 'warn', file: 'src/foo.ts', line: 42, message: 'no any' },
        ],
      });
      const runner = makeMockRunner({
        detectExitCode: 0,
        runStdout: envelope,
        runStatus: 0,
      });
      const result = runEccAgent(
        { agent: 'typescript-reviewer', projectRoot: '.', enableAgent: true },
        runner
      );
      expect(result.spawned).toBe(true);
      expect(result.reason).toBe('enabled-and-installed');
      expect(result.result?.ok).toBe(true);
      expect(result.result?.parsed).toEqual(JSON.parse(envelope));
    });

    it('soft-fails with non-zero exit (no panic on subprocess failure)', () => {
      const runner = makeMockRunner({
        detectExitCode: 0,
        runStatus: 1,
        runStdout: '',
      });
      const result = runEccAgent(
        { agent: 'code-reviewer', projectRoot: '.', enableAgent: true },
        runner
      );
      expect(result.spawned).toBe(true);
      expect(result.reason).toBe('enabled-and-installed');
      expect(result.result?.ok).toBe(false);
      expect(result.result?.error).toMatch(/exited with status 1/);
    });

    it('soft-fails on non-JSON stdout (parses as undefined but ok=true)', () => {
      const runner = makeMockRunner({
        detectExitCode: 0,
        runStdout: 'not-valid-json {{{',
        runStatus: 0,
      });
      const result = runEccAgent(
        { agent: 'security-reviewer', projectRoot: '.', enableAgent: true },
        runner
      );
      expect(result.result?.ok).toBe(true);
      expect(result.result?.parsed).toBeUndefined();
      expect(result.result?.stdout).toBe('not-valid-json {{{');
    });
  });
});
