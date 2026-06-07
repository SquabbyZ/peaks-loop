import { describe, expect, test } from 'vitest';
import { runDoctor } from '../../../src/services/doctor/doctor-service.js';

const PASSING_DIST_PROBE = () => ({ dist: '1.3.3', source: '1.3.3', match: true, distReadable: true });
const CLEAN_WORKSPACE_PROBE = () => ({ topLevelSessionDirs: [], legacyDotfiles: [] });

describe('doctor 35-checks aggregate (G4)', () => {
  test('runDoctor returns a stable set of check IDs with no duplicates', async () => {
    const report = await runDoctor({
      distVersionProbe: PASSING_DIST_PROBE,
      workspaceLayoutProbe: CLEAN_WORKSPACE_PROBE
    });

    const ids = report.checks.map((check) => check.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  test('every check ID is a non-empty string of the form "<namespace>:<name>"', async () => {
    const report = await runDoctor({
      distVersionProbe: PASSING_DIST_PROBE,
      workspaceLayoutProbe: CLEAN_WORKSPACE_PROBE
    });

    for (const check of report.checks) {
      expect(typeof check.id).toBe('string');
      expect(check.id.length).toBeGreaterThan(0);
      expect(check.id).toContain(':');
    }
  });

  test('all checks return ok: true on a clean workspace fixture (post F-3)', async () => {
    const report = await runDoctor({
      distVersionProbe: PASSING_DIST_PROBE,
      workspaceLayoutProbe: CLEAN_WORKSPACE_PROBE
    });

    const failing = report.checks.filter((check) => !check.ok);
    expect(failing).toEqual([]);
    expect(report.summary.ok).toBe(true);
    expect(report.summary.failed).toBe(0);
    expect(report.summary.passed).toBe(report.checks.length);
  });

  test('build:workspace-layout-canonical passes on the post-F-3 clean workspace (slice #011 F-3 fix)', async () => {
    const report = await runDoctor({
      distVersionProbe: PASSING_DIST_PROBE,
      workspaceLayoutProbe: CLEAN_WORKSPACE_PROBE
    });

    const check = report.checks.find((item) => item.id === 'build:workspace-layout-canonical');
    expect(check).toBeDefined();
    expect(check?.ok).toBe(true);
  });
});
