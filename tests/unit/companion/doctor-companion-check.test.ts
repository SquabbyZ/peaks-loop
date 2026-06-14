import { describe, expect, it } from 'vitest';
import { runDoctor } from '../../../src/services/doctor/doctor-service.js';
import type { CompanionProbe } from '../../../src/services/companion/companion-types.js';

const PASSING_DIST_PROBE = () => ({ dist: '1.3.3', source: '1.3.3', match: true, distReadable: true });
const CLEAN_WORKSPACE_PROBE = () => ({ topLevelSessionDirs: [], legacyDotfiles: [], perChangeIdDirs: [] });

describe('doctor: capability:companion-binary-resolution', () => {
  it('reports ok=true with a friendly version+path+source message when the binary resolves from node_modules', async () => {
    const report = await runDoctor({
      distVersionProbe: PASSING_DIST_PROBE,
      workspaceLayoutProbe: CLEAN_WORKSPACE_PROBE,
      companionBinaryProbe: () => ({
        binaryPath: '/repo/node_modules/.bin/cc-connect',
        version: '1.3.2',
        ok: true,
        error: null,
        resolvedSource: 'node-modules'
      } satisfies CompanionProbe)
    });
    const check = report.checks.find((c) => c.id === 'capability:companion-binary-resolution');
    expect(check).toBeDefined();
    expect(check?.ok).toBe(true);
    expect(check?.message).toContain('cc-connect@1.3.2');
    expect(check?.message).toContain('/repo/node_modules/.bin/cc-connect');
    expect(check?.message).toContain('node_modules/.bin');
  });

  it('reports ok=true with source=PATH when the binary resolves from PATH', async () => {
    const report = await runDoctor({
      distVersionProbe: PASSING_DIST_PROBE,
      workspaceLayoutProbe: CLEAN_WORKSPACE_PROBE,
      companionBinaryProbe: () => ({
        binaryPath: '/usr/local/bin/cc-connect',
        version: '1.3.2',
        ok: true,
        error: null,
        resolvedSource: 'path'
      } satisfies CompanionProbe)
    });
    const check = report.checks.find((c) => c.id === 'capability:companion-binary-resolution');
    expect(check).toBeDefined();
    expect(check?.ok).toBe(true);
    expect(check?.message).toContain('cc-connect@1.3.2');
    expect(check?.message).toContain('/usr/local/bin/cc-connect');
    expect(check?.message).toContain('source=PATH');
  });

  it('reports ok=true with an informational message when the binary is missing', async () => {
    const report = await runDoctor({
      distVersionProbe: PASSING_DIST_PROBE,
      workspaceLayoutProbe: CLEAN_WORKSPACE_PROBE,
      companionBinaryProbe: () => ({
        binaryPath: null,
        version: null,
        ok: false,
        error: 'cc-connect binary not found (checked node_modules/.bin, require.resolve, and PATH)',
        resolvedSource: null
      } satisfies CompanionProbe)
    });
    const check = report.checks.find((c) => c.id === 'capability:companion-binary-resolution');
    expect(check).toBeDefined();
    expect(check?.ok).toBe(true);
    expect(check?.message).toContain('cc-connect binary not found');
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

  // Slice 2026-06-14-cc-connect-weixin (change-1): doctor surfaces
  // the peaks-config `companion.enabled` flag in the message so
  // users can tell at a glance whether cc-connect is opted in.
  it('appends companion.enabled=true to the message when peaks config opts in', async () => {
    const report = await runDoctor({
      distVersionProbe: PASSING_DIST_PROBE,
      workspaceLayoutProbe: CLEAN_WORKSPACE_PROBE,
      companionBinaryProbe: () => ({
        binaryPath: '/repo/node_modules/.bin/cc-connect',
        version: '1.3.2',
        ok: true,
        error: null,
        resolvedSource: 'node-modules'
      } satisfies CompanionProbe),
      companionPeaksConfigProbe: () => ({ enabled: true, configPath: '~/.cc-connect/config.toml' })
    });
    const check = report.checks.find((c) => c.id === 'capability:companion-binary-resolution');
    expect(check?.message).toContain('companion.enabled=true (peaks config)');
  });

  it('appends companion.enabled=false when peaks config has not opted in', async () => {
    const report = await runDoctor({
      distVersionProbe: PASSING_DIST_PROBE,
      workspaceLayoutProbe: CLEAN_WORKSPACE_PROBE,
      companionBinaryProbe: () => ({
        binaryPath: '/repo/node_modules/.bin/cc-connect',
        version: '1.3.2',
        ok: true,
        error: null,
        resolvedSource: 'node-modules'
      } satisfies CompanionProbe),
      companionPeaksConfigProbe: () => ({ enabled: false, configPath: '~/.cc-connect/config.toml' })
    });
    const check = report.checks.find((c) => c.id === 'capability:companion-binary-resolution');
    expect(check?.message).toContain('companion.enabled=false (peaks config');
  });

  it('omits the peaks-config suffix when the probe throws', async () => {
    const report = await runDoctor({
      distVersionProbe: PASSING_DIST_PROBE,
      workspaceLayoutProbe: CLEAN_WORKSPACE_PROBE,
      companionBinaryProbe: () => ({
        binaryPath: '/repo/node_modules/.bin/cc-connect',
        version: '1.3.2',
        ok: true,
        error: null,
        resolvedSource: 'node-modules'
      } satisfies CompanionProbe),
      companionPeaksConfigProbe: () => { throw new Error('config missing'); }
    });
    const check = report.checks.find((c) => c.id === 'capability:companion-binary-resolution');
    expect(check?.message).not.toContain('(peaks config');
  });
});
