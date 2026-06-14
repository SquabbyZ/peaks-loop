import { describe, expect, it } from 'vitest';
import { runDoctor } from '../../../src/services/doctor/doctor-service.js';
import type { CompanionProbe } from '../../../src/services/companion/companion-types.js';

const PASSING_DIST_PROBE = () => ({ dist: '1.3.3', source: '1.3.3', match: true, distReadable: true });
const CLEAN_WORKSPACE_PROBE = () => ({ topLevelSessionDirs: [], legacyDotfiles: [], perChangeIdDirs: [] });

describe('doctor: capability:companion-binary-resolution', () => {
  it('reports ok=true with a friendly version+path message when the binary resolves', async () => {
    const report = await runDoctor({
      distVersionProbe: PASSING_DIST_PROBE,
      workspaceLayoutProbe: CLEAN_WORKSPACE_PROBE,
      companionBinaryProbe: () => ({ binaryPath: '/usr/local/bin/cc-connect', version: '1.3.2', ok: true, error: null } satisfies CompanionProbe)
    });
    const check = report.checks.find((c) => c.id === 'capability:companion-binary-resolution');
    expect(check).toBeDefined();
    expect(check?.ok).toBe(true);
    expect(check?.message).toContain('cc-connect@1.3.2');
    expect(check?.message).toContain('/usr/local/bin/cc-connect');
  });

  it('reports ok=true with an informational message when the binary is missing', async () => {
    const report = await runDoctor({
      distVersionProbe: PASSING_DIST_PROBE,
      workspaceLayoutProbe: CLEAN_WORKSPACE_PROBE,
      companionBinaryProbe: () => ({ binaryPath: null, version: null, ok: false, error: 'cc-connect binary not found on PATH' } satisfies CompanionProbe)
    });
    const check = report.checks.find((c) => c.id === 'capability:companion-binary-resolution');
    expect(check).toBeDefined();
    expect(check?.ok).toBe(true);
    expect(check?.message).toContain('cc-connect binary not found on PATH');
    expect(check?.message).toContain('peaks companion install');
  });

  it('falls back to the default probe when none is injected (does not crash)', async () => {
    // We do NOT inject companionBinaryProbe, so the default `probeCcConnect`
    // runs against the *real* process.env.PATH. We only assert the check
    // exists in the report (it is always present).
    const report = await runDoctor({
      distVersionProbe: PASSING_DIST_PROBE,
      workspaceLayoutProbe: CLEAN_WORKSPACE_PROBE
    });
    const check = report.checks.find((c) => c.id === 'capability:companion-binary-resolution');
    expect(check).toBeDefined();
    expect(typeof check?.ok).toBe('boolean');
  });
});
