/**
 * TDD coverage for the 1.x → 2.0 detection service.
 * Slice: 2026-06-12-code-step-0-55-1x-detection.
 *
 * Mirrors the cases in
 * `tests/unit/scripts/install-skills-1x-detector.test.ts`
 * so both surfaces stay in parity.
 */
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { detect1xProjectState } from '../../../../src/services/upgrade/1x-detector-service.js';

let tmpHome: string;
let tmpProject: string;
let originalHome: string | undefined;
// Slice 2026-06-24-doctor-1xdetector-residual: the production
// `detect1xProjectState` walks UP from the cwd looking for
// `.peaks/_runtime`. On a developer box (and on this CI runner)
// `os.tmpdir()` may contain a stale `.peaks/_runtime/` left over
// from a previous `peaks session init` (e.g. a `peaks-ac3-*`
// fixture run). When `mkdtempSync(join(tmpdir(), '...'))` puts the
// test's tmpProject *under* that stale directory, the walk-up
// returns the stale dir as `projectRoot` and the test that
// expects `projectRoot=null` fails.
//
// The fix is a per-test fixture scrub: walk up from `tmpProject`
// to `os.tmpdir()` (exclusive), and for any `.peaks/_runtime`
// found, rename it aside. Restore on `afterEach`. This isolates
// the test's effective cwd chain from leftover system state
// without touching `tmpdir()` itself or the production code.
const stashedAncestors: Array<{ runtime: string; backup: string }> = [];
let ancestorScrubCounter = 0;

function scrubAncestorPeaksRuntime(start: string): void {
  // Walk from `start`'s parent UP through every ancestor. On
  // developer/CI machines `os.tmpdir()` itself may contain a
  // stale `.peaks/_runtime/` (e.g. from a prior `peaks-ac3-*`
  // fixture run). We must scrub that too — it is the most
  // common leakage point. We do NOT scrub above
  // `<dirname of sysTmp>` (the OS temp boundary).
  const sysTmp = tmpdir();
  const sysTmpParent = dirname(sysTmp);
  let dir = dirname(start);
  while (dir.length > sysTmpParent.length) {
    const candidate = join(dir, '.peaks', '_runtime');
    if (existsSync(candidate)) {
      const backup = `${candidate}.test-scrub-${process.pid}-${ancestorScrubCounter}`;
      ancestorScrubCounter += 1;
      try {
        renameSync(candidate, backup);
        stashedAncestors.push({ runtime: candidate, backup });
      } catch {
        // best-effort — concurrent test worker may have moved it
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

function restoreAncestorPeaksRuntime(): void {
  while (stashedAncestors.length > 0) {
    const entry = stashedAncestors.pop();
    if (entry === undefined) break;
    if (existsSync(entry.backup)) {
      try {
        renameSync(entry.backup, entry.runtime);
      } catch {
        // best-effort restore
      }
    }
  }
}

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'peaks-1x-home-'));
  tmpProject = mkdtempSync(join(tmpdir(), 'peaks-1x-project-'));
  originalHome = process.env['HOME'];
  process.env['HOME'] = tmpHome;
  scrubAncestorPeaksRuntime(tmpProject);
});

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env['HOME'];
  } else {
    process.env['HOME'] = originalHome;
  }
  restoreAncestorPeaksRuntime();
  if (rmSync.length >= 1) {
    if (rmSync.length === 2) {
      rmSync(tmpHome, { recursive: true, force: true });
      rmSync(tmpProject, { recursive: true, force: true });
    } else {
      // older node signature
      rmSync(tmpHome, { recursive: true, force: true });
      rmSync(tmpProject, { recursive: true, force: true });
    }
  }
});

describe('detect1xProjectState (TypeScript mirror)', () => {
  test('returns isOneX=true when dev-preference.md references "peaks progress"', () => {
    mkdirSync(join(tmpProject, '.peaks', '_runtime'), { recursive: true });
    mkdirSync(join(tmpProject, '.claude', 'rules', 'common'), { recursive: true });
    writeFileSync(
      join(tmpProject, '.claude', 'rules', 'common', 'dev-preference.md'),
      '# dev-preference\n\nWe use peaks progress as the metric.\n',
      'utf8'
    );
    const state = detect1xProjectState(tmpProject);
    expect(state.signals.some((s) => s.includes('peaks progress'))).toBe(true);
    expect(state.isOneX).toBe(true);
  });

  test('returns isOneX=true when preferences.json has schema_version 1.0.0', () => {
    mkdirSync(join(tmpProject, '.peaks', '_runtime'), { recursive: true });
    mkdirSync(join(tmpProject, '.peaks'), { recursive: true });
    writeFileSync(
      join(tmpProject, '.peaks', 'preferences.json'),
      JSON.stringify({ schema_version: '1.0.0' }),
      'utf8'
    );
    const state = detect1xProjectState(tmpProject);
    expect(state.signals.some((s) => s.includes('schema_version'))).toBe(true);
    expect(state.isOneX).toBe(true);
  });

  test('returns isOneX=true when preferences.json is missing', () => {
    mkdirSync(join(tmpProject, '.peaks', '_runtime'), { recursive: true });
    const state = detect1xProjectState(tmpProject);
    expect(state.signals.some((s) => s.includes('preferences.json does not exist'))).toBe(true);
    expect(state.isOneX).toBe(true);
  });

  test('returns isOneX=false on a 2.0 project', () => {
    mkdirSync(join(tmpProject, '.peaks', '_runtime'), { recursive: true });
    mkdirSync(join(tmpProject, '.peaks'), { recursive: true });
    writeFileSync(
      join(tmpProject, '.peaks', 'preferences.json'),
      JSON.stringify({ schema_version: '2.0.0' }),
      'utf8'
    );
    const state = detect1xProjectState(tmpProject);
    expect(state.isOneX).toBe(false);
  });

  test('returns isOneX=false and projectRoot=null when no .peaks/_runtime/ exists', () => {
    const state = detect1xProjectState(tmpProject);
    expect(state.projectRoot).toBeNull();
    expect(state.isOneX).toBe(false);
  });

  test('returns projectRoot correctly resolved on a 1.x project', () => {
    mkdirSync(join(tmpProject, '.peaks', '_runtime'), { recursive: true });
    const state = detect1xProjectState(tmpProject);
    expect(state.projectRoot).toBe(tmpProject);
  });

  test('survives malformed preferences.json (parse error does not throw)', () => {
    mkdirSync(join(tmpProject, '.peaks', '_runtime'), { recursive: true });
    mkdirSync(join(tmpProject, '.peaks'), { recursive: true });
    writeFileSync(
      join(tmpProject, '.peaks', 'preferences.json'),
      '{not valid json',
      'utf8'
    );
    expect(() => detect1xProjectState(tmpProject)).not.toThrow();
    const state = detect1xProjectState(tmpProject);
    expect(state.signals.some((s) => s.includes('not valid JSON'))).toBe(true);
  });
});
