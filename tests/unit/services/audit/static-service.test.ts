/**
 * Unit tests for the L2.3 P2-a static-service (peaks audit static).
 *
 * Slice 3 of 4.0.0-beta.10 removed the ECC AgentShield subprocess
 * integration. The audit is now peaks-loop-only: no `npx ecc-agentshield`
 * probe, no merged findings from the upstream scanner. The test
 * suite asserts:
 *   - agentShield state is always `disabled-and-ecc-missing`
 *     (the single collapsed reason code; the other literals remain
 *     as type-level union members so downstream consumers keep
 *     type-checking).
 *   - peaks-loop findings are still emitted.
 *   - NO runner call equals `['ecc-agentshield', '--version']` —
 *     the previous detect probe is gone.
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

describe('static-service — peaks audit static (Slice 3)', () => {
  it('always returns agentShield.reason="disabled-and-ecc-missing" (probe removed)', () => {
    const projectRoot = makeProjectWithPrefs({ agentShieldEnabled: true });
    try {
      const result = runStaticAudit({
        projectRoot,
        enableAgentShield: true,
      });
      expect(result.agentShield.spawned).toBe(false);
      expect(result.agentShield.installed).toBe(false);
      expect(result.agentShield.reason).toBe('disabled-and-ecc-missing');
      expect(result.agentShield.findings).toEqual([]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('ignores enableAgentShield=true (subprocess integration removed)', () => {
    const projectRoot = makeProjectWithPrefs({ agentShieldEnabled: false });
    try {
      const result = runStaticAudit({
        projectRoot,
        enableAgentShield: true,
      });
      // The flag is preserved on the input for backward-compat
      // but does not change the runtime state.
      expect(result.agentShield.spawned).toBe(false);
      expect(result.agentShield.reason).toBe('disabled-and-ecc-missing');
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('always runs the peaks-loop lint layer (enforcerFindings well-formed)', () => {
    const projectRoot = makeProjectWithPrefs({ agentShieldEnabled: false });
    try {
      const result = runStaticAudit({ projectRoot });
      expect(Array.isArray(result.audit.enforcerFindings)).toBe(true);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('never invokes a subprocess runner (AC3.11 invariant)', () => {
    const projectRoot = makeProjectWithPrefs({ agentShieldEnabled: true });
    const seenCommands: { command: string; args: readonly string[] }[] = [];
    const recordingRunner: SubprocessRunner = {
      run(command, args) {
        seenCommands.push({ command, args });
        return { status: 0, stdout: '', stderr: '' } satisfies SubprocessResult;
      },
    };
    try {
      runStaticAudit({
        projectRoot,
        enableAgentShield: true,
        subprocessRunner: recordingRunner,
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
    expect(seenCommands.length).toBe(0);
    for (const { args } of seenCommands) {
      expect(args).not.toEqual(['ecc-agentshield', '--version']);
    }
  });
});