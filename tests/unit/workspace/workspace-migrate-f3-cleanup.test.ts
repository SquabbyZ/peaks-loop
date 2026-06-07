/**
 * F-3 cleanup bugfix — unit test for `peaks workspace migrate --to-runtime`.
 *
 * Slice 006-006-2026-06-07-f-3-cleanup (bugfix) removes a pre-existing
 * stale top-level session dir `.peaks/2026-06-06-session-5b1095/` that
 * pre-dates slice 006's workspace-layout canonicalization. The fix is
 * the existing `peaks workspace migrate --to-runtime --project <repo>
 * --apply` CLI (shipped in slice 006, commit `48958fc refactor(workspace):
 * canonicalize session layout under _runtime/`). This test exercises
 * the public `migrateWorkspace` API directly so the bugfix coverage does
 * not depend on the CLI binary being on PATH during `pnpm vitest run`.
 *
 * Sub-cases (per PRD AC-9):
 *   (a) migration targets the right root-level session dir
 *   (b) the canonical `.peaks/_runtime/<sid>/` twin is NOT touched (idempotency)
 *   (c) after a simulated migration of a stale root-level dir, the
 *       `build:workspace-layout-canonical` doctor check is clean.
 *
 * The test uses the existing `migrateWorkspace` function from
 * `src/services/workspace/migrate-service.ts`, NOT a parallel
 * implementation. The fixture is created in a tmp dir, never in the
 * real project, so the canonical twin at
 * `.peaks/_runtime/2026-06-06-session-5b1095/` is preserved untouched
 * during the test run.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { migrateWorkspace } from '../../../src/services/workspace/migrate-service.js';

const SESSION_ID = '2026-06-06-session-5b1095';

let projectRoot: string;

function makeFixtureProject(): string {
  const root = join(tmpdir(), `peaks-f3-cleanup-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(join(root, '.peaks'), { recursive: true });
  return root;
}

function seedCanonicalTwin(root: string): { fileCount: number; sentinelPath: string } {
  const twinDir = join(root, '.peaks', '_runtime', SESSION_ID);
  mkdirSync(join(twinDir, 'rd', 'requests'), { recursive: true });
  mkdirSync(join(twinDir, 'qa', 'requests'), { recursive: true });
  const sentinel = join(twinDir, 'rd', 'requests', '006-006-006-2026-06-07-f-3-cleanup.md');
  writeFileSync(sentinel, '# RD request body — F-3 cleanup\n', 'utf8');
  // Plus a handful of other files to mirror the real fixture
  writeFileSync(join(twinDir, 'session.json'), '{"sessionId":"' + SESSION_ID + '"}', 'utf8');
  writeFileSync(join(twinDir, 'rd', 'tech-doc.md'), '# Tech Doc: f-3 cleanup\n', 'utf8');
  writeFileSync(join(twinDir, 'qa', 'requests', 'x.md'), '# QA request\n', 'utf8');
  return { fileCount: readdirSync(twinDir, { recursive: true }).length, sentinelPath: sentinel };
}

function seedStaleRootSessionDir(root: string): string {
  const staleDir = join(root, '.peaks', SESSION_ID);
  mkdirSync(join(staleDir, 'rd'), { recursive: true });
  writeFileSync(join(staleDir, 'session.json'), '{"sessionId":"' + SESSION_ID + '"}', 'utf8');
  writeFileSync(join(staleDir, 'rd', 'old-stale-artifact.md'), '# stale\n', 'utf8');
  return staleDir;
}

describe('peaks workspace migrate — F-3 cleanup (slice 006-006-2026-06-07-f-3-cleanup)', () => {
  beforeEach(() => {
    projectRoot = makeFixtureProject();
  });
  afterEach(() => {
    if (existsSync(projectRoot)) {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  // AC-9 (a): migration targets the right root-level session dir
  test('(a) targets the right root-level session dir and moves it under _runtime/', async () => {
    const staleDir = seedStaleRootSessionDir(projectRoot);

    expect(existsSync(staleDir)).toBe(true);
    expect(existsSync(join(projectRoot, '.peaks', '_runtime', SESSION_ID))).toBe(false);

    const result = await migrateWorkspace({
      projectRoot,
      apply: true,
      toRuntime: true
    });

    // Stale root-level dir is gone
    expect(existsSync(staleDir)).toBe(false);
    // And the move is recorded in the toRuntimeMoved list
    expect(result.toRuntimeMoved).toContain(SESSION_ID);
    // The CLI flag combo was honoured
    expect(result.apply).toBe(true);
    expect(result.toRuntimeConflicts).toEqual([]);
  });

  // AC-9 (b): canonical _runtime twin is NOT touched (idempotency)
  test('(b) does not touch an existing canonical _runtime/<sid>/ twin (idempotency / skip)', async () => {
    const { sentinelPath } = seedCanonicalTwin(projectRoot);
    // Also seed a stale root-level dir to prove "move-or-skip" logic prefers canonical.
    seedStaleRootSessionDir(projectRoot);

    const sentinelBefore = readFileSync(sentinelPath, 'utf8');

    const result = await migrateWorkspace({
      projectRoot,
      apply: true,
      toRuntime: true
    });

    // The canonical twin must still exist and be byte-identical
    expect(existsSync(sentinelPath)).toBe(true);
    expect(readFileSync(sentinelPath, 'utf8')).toBe(sentinelBefore);

    // The migration must report the canonical session as skipped, NOT moved
    expect(result.toRuntimeMoved).not.toContain(SESSION_ID);
    expect(result.toRuntimeSkipped).toContain(SESSION_ID);
    // F15 carve-out: no f15-conflict-project-scan since we did not seed rd/project-scan.md
    expect(result.toRuntimeConflicts).toEqual([]);
  });

  // AC-9 (c): after migration, no top-level session dir remains; the
  // workspace-layout-canonical doctor check would pass.
  // Mirrors the real F-3 state: a stale root-level session dir exists
  // (no canonical twin) — the migration moves it under _runtime/ and
  // the layout becomes canonical.
  test('(c) leaves no top-level session dir behind; canonical layout is clean', async () => {
    seedStaleRootSessionDir(projectRoot);

    const result = await migrateWorkspace({
      projectRoot,
      apply: true,
      toRuntime: true
    });

    // No top-level session dir matching the yyyy-mm-dd-session- pattern
    const topLevelDirs = readdirSync(join(projectRoot, '.peaks'));
    const topLevelSessionDirs = topLevelDirs.filter((name) =>
      /^\d{4}-\d{2}-\d{2}-session-/.test(name)
    );
    expect(topLevelSessionDirs).toEqual([]);

    // _runtime/ still present (we did not remove the protected top-level dir)
    expect(topLevelDirs).toContain('_runtime');

    // Apply ran without conflicts
    expect(result.toRuntimeConflicts).toEqual([]);
    expect(result.toRuntimeMoved).toContain(SESSION_ID);
  });
});
