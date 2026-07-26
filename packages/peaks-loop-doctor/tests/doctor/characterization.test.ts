/**
 * Characterization tests for the doctor-service refactor (slice rid-004).
 *
 * These tests pin the public behavior of `runDoctor` and the
 * legacy-import surface so future refactors can't silently change
 * emitted check IDs, the check count, the schema self-validation
 * behaviour, or the back-compat re-export.
 *
 * The legacy monolithic `doctor-service.ts` lived at
 * `packages/peaks-loop-doctor/src/services/doctor/doctor-service.ts`.
 * After the split, the same path is a thin shim re-exporting from
 * `./doctor-service/index.js`. The shim must keep working for the
 * existing test files (`doctor.test.ts`, `tests/doctor/*.test.ts`).
 */

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  collectGateguardEntries,
  compareDistVersion,
  inspectWorkspaceLayout,
  isWorkspaceInitializedAt,
  PLUGINS,
  runDoctor,
  type DoctorReport
} from '../../src/services/doctor/doctor-service.js';

const PASSING_DIST_PROBE = (): { dist: string; source: string; match: boolean; distReadable: boolean } => ({ dist: '1.3.3', source: '1.3.3', match: true, distReadable: true });
const CLEAN_WORKSPACE_PROBE = (): { topLevelSessionDirs: string[]; legacyDotfiles: string[]; perChangeIdDirs?: string[] } => ({ topLevelSessionDirs: [], legacyDotfiles: [], perChangeIdDirs: [] });

async function isolatedL3Root(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

describe('characterization: legacy import surface', () => {
  test('the legacy `from "../services/doctor/doctor-service.js"` import resolves runDoctor + public helpers', () => {
    expect(typeof runDoctor).toBe('function');
    expect(typeof isWorkspaceInitializedAt).toBe('function');
    expect(typeof compareDistVersion).toBe('function');
    expect(typeof inspectWorkspaceLayout).toBe('function');
    expect(typeof collectGateguardEntries).toBe('function');
  });

  test('PLUGINS array contains exactly the 18 expected plugins in fixed order', () => {
    expect(PLUGINS).toHaveLength(18);
    const names = PLUGINS.map((p) => p.name);
    expect(names).toEqual([
      'skill-existence',
      'skill-name-match',
      'skill-parse',
      'skill-runbook',
      'skill-apply-note',
      'schema-validity',
      'user-config',
      'skill-presence',
      'workspace-init',
      'statusline-install',
      'statusline-runtime',
      'codegraph-capability',
      'dist-source-version',
      'workspace-layout',
      'gateguard-conflict',
      'check-id-schema',
      'l3-orphan-sessions',
      'l3-memory-health'
    ]);
  });
});

describe('characterization: check IDs are stable across the registry split', () => {
  test('emitted check IDs are stable on a clean fixture (post F-3 canonical)', async () => {
    const report = await runDoctor({
      distVersionProbe: PASSING_DIST_PROBE,
      workspaceLayoutProbe: CLEAN_WORKSPACE_PROBE,
      l3ProjectRoot: await isolatedL3Root('peaks-characterization-ids-'),
      skillPresenceProbe: () => null
    });
    const ids = report.checks.map((check) => check.id);
    expect(ids.length).toBeGreaterThan(30);
    // Required-skill namespace MUST always be present.
    expect(ids.some((id) => id.startsWith('skill:'))).toBe(true);
    // Legacy L3 names MUST survive the split.
    expect(ids).toContain('L3:l3-orphan-sessions');
    expect(ids).toContain('L3:l3-memory-health');
    // Self-validation MUST survive the split.
    expect(ids).toContain('doctor-self:check-id-pattern');
    // No duplicate IDs (registry determinism).
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every emitted check ID passes the schema self-validation', async () => {
    const report: DoctorReport = await runDoctor({
      distVersionProbe: PASSING_DIST_PROBE,
      workspaceLayoutProbe: CLEAN_WORKSPACE_PROBE,
      l3ProjectRoot: await isolatedL3Root('peaks-characterization-self-validate-'),
      skillPresenceProbe: () => null
    });
    const selfCheck = report.checks.find((check) => check.id === 'doctor-self:check-id-pattern');
    expect(selfCheck).toBeDefined();
    expect(selfCheck?.ok).toBe(true);
  });

  test('summary.ok reflects the running failures across the plugin pipeline', async () => {
    const report = await runDoctor({
      distVersionProbe: PASSING_DIST_PROBE,
      workspaceLayoutProbe: CLEAN_WORKSPACE_PROBE,
      l3ProjectRoot: await isolatedL3Root('peaks-characterization-summary-'),
      skillPresenceProbe: () => null
    });
    expect(report.summary.ok).toBe(true);
    expect(report.summary.failed).toBe(0);
    expect(report.summary.passed).toBe(report.checks.length);
  });
});