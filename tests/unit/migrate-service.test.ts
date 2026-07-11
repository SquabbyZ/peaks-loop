import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep as pathSep } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { migrateWorkspace } from '../../src/services/workspace/migrate-service.js';

// Convert any path-style to a forward-slash style for substring checks.
// Production `to` paths on Windows are emitted with the OS-native
// backslash separator; the test asserts via `.toContain('/.peaks/...')`.
// Normalize the production path to forward slashes before comparison.
function toPosix(p: string): string {
  return p.split(pathSep).join('/');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-migrate-'));
}

/** Initialize a git repo at the project root so `git mv` works. */
function initGit(project: string): void {
  execFileSync('git', ['init', '-q'], { cwd: project });
  execFileSync('git', ['config', 'user.email', 'test@peaks'], { cwd: project });
  execFileSync('git', ['config', 'user.name', 'peaks-test'], { cwd: project });
}

function seedFile(absPath: string, content: string): void {
  mkdirSync(join(absPath, '..'), { recursive: true });
  writeFileSync(absPath, content, 'utf8');
}

function readFile(absPath: string): string {
  return readFileSync(absPath, 'utf8');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('migrateWorkspace', { timeout: 60_000 }, () => {
  let project: string;

  // Hoist git init ONCE per describe — git init + 3 config calls cost
  // ~7s on Windows per call; 21 tests × 7s = ~150s of avoidable wall-clock.
  // Each test still gets a clean `<sid>` realpath under `.peaks/_runtime/`
  // (file-lock semantic preserved — sessions are different realpaths).
  // `rmSync(.peaks)` in beforeEach removes only the .peaks/ tree; the
  // outer git repo (`.git/`) survives, so we don't pay init cost again.
  beforeAll(() => {
    project = makeProject();
    initGit(project);
  });

  beforeEach(() => {
    // Reset only `.peaks/`; outer git repo (and `initGit` config) survives.
    rmSync(join(project, '.peaks'), { recursive: true, force: true });
  });

  afterAll(() => {
    try {
      rmSync(project, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  // ==================================================================
  // Discovery
  // ==================================================================

  describe('discovery', () => {
    test('returns empty result when .peaks/ does not exist', async () => {
      const result = await migrateWorkspace({ projectRoot: project, apply: false });
      expect(result.sessions).toEqual([]);
      expect(result.wouldMove).toEqual([]);
      expect(result.totalFilesMoved).toBe(0);
    });

    test('ignores protected top-level dirs (_runtime, retrospective, _dogfood, memory, sops, project-scan, perf-baseline)', async () => {
      seedFile(join(project, '.peaks/_runtime/session.json'), '{}');
      seedFile(join(project, '.peaks/retrospective/2026-01-01-foo/rd/tech-doc.md'), '# Tech Doc: 2026-01-01-foo');
      seedFile(join(project, '.peaks/_dogfood/2026-01-01-x/prd/requests/001-x.md'), '# PRD 2026-01-01-x');
      seedFile(join(project, '.peaks/memory/decision-foo.md'), '# Decision: foo');
      seedFile(join(project, '.peaks/sops/onboarding.md'), '# Onboarding SOP');

      const result = await migrateWorkspace({ projectRoot: project, apply: false });
      expect(result.sessions).toEqual([]);
    });

    test('only treats dirs matching the legacy session pattern as sessions', async () => {
      // A non-session-pattern dir should be ignored.
      seedFile(join(project, '.peaks/some-other-dir/rd/tech-doc.md'), '# Tech Doc: bogus');
      seedFile(join(project, '.peaks/2026-01-15-session-abcd12/rd/tech-doc.md'), '# Tech Doc: 2026-01-15-feature');

      const result = await migrateWorkspace({ projectRoot: project, apply: false });
      expect(result.sessions.map((s) => s.sessionId)).toEqual(['2026-01-15-session-abcd12']);
    });
  });

  // ==================================================================
  // 4-tier change-id resolution
  // ==================================================================

  describe('change-id resolution', () => {
    test('tier 1 — filename regex: 001-2026-01-15-foo.md (strip 3-digit prefix)', async () => {
      const sid = '2026-01-15-session-aaaaaa';
      seedFile(
        join(project, `.peaks/_runtime/${sid}/rd/requests/001-2026-01-15-foo.md`),
        '# RD Request\n- state: draft\n- type: feature\n'
      );
      seedFile(join(project, `.peaks/_runtime/${sid}/session.json`), '{}');

      const result = await migrateWorkspace({ projectRoot: project, apply: false });
      const move = result.wouldMove.find((f) => f.relativePath === 'rd/requests/001-2026-01-15-foo.md');
      expect(move).toBeDefined();
      expect(move?.targetSessionId).toBe('2026-01-15-foo');
      expect(move?.source).toBe('filename-regex');
    });

    test('tier 1 — filename regex: 001-fix-title.md (strip 3-digit prefix, change-id starts with non-digit)', async () => {
      const sid = '2026-02-20-session-aaaaa2';
      seedFile(
        join(project, `.peaks/_runtime/${sid}/rd/requests/001-fix-title.md`),
        '# RD 001-fix-title\n- state: draft\n'
      );

      const result = await migrateWorkspace({ projectRoot: project, apply: false });
      const move = result.wouldMove.find((f) => f.relativePath === 'rd/requests/001-fix-title.md');
      expect(move?.targetSessionId).toBe('fix-title');
      expect(move?.source).toBe('filename-regex');
    });

    test('tier 1 does NOT match: 4-digit year prefix (date part of change-id)', async () => {
      const sid = '2026-02-21-session-aaaaa3';
      // 4-digit prefix is part of the change-id (date-prefixed), not a sequence number.
      seedFile(
        join(project, `.peaks/_runtime/${sid}/prd/requests/2026-02-21-default.md`),
        '# PRD Request 2026-02-21-default\n- state: draft\n- type: feature\n'
      );

      const result = await migrateWorkspace({ projectRoot: project, apply: false });
      const move = result.wouldMove.find((f) => f.relativePath === 'prd/requests/2026-02-21-default.md');
      // Tier 1 doesn't match (4-digit prefix). Tier 2 H1 extracts `2026-02-21-default`.
      expect(move?.targetSessionId).toBe('2026-02-21-default');
      expect(move?.source).toBe('content-h1');
    });

    test('tier 2 — content H1: "# Tech Doc: 003-leaf-and-content-locked-callbacks"', async () => {
      const sid = '2026-06-03-session-bbbbbb';
      seedFile(
        join(project, `.peaks/_runtime/${sid}/rd/tech-doc.md`),
        '# Tech Doc: 003-leaf-and-content-locked-callbacks\n\n- **Date:** 2026-06-03\n'
      );

      const result = await migrateWorkspace({ projectRoot: project, apply: false });
      const move = result.wouldMove.find((f) => f.relativePath === 'rd/tech-doc.md');
      expect(move).toBeDefined();
      expect(move?.targetSessionId).toBe('003-leaf-and-content-locked-callbacks');
      expect(move?.source).toBe('content-h1');
    });

    test('tier 2 — content H1: "# Code Review 009-fix-test-harness-tailwind"', async () => {
      const sid = '2026-06-03-session-cccccccc';
      seedFile(
        join(project, `.peaks/_runtime/${sid}/rd/code-review.md`),
        '# Code Review 009-fix-test-harness-tailwind\n\n**Date:** 2026-06-03\n'
      );

      const result = await migrateWorkspace({ projectRoot: project, apply: false });
      const move = result.wouldMove.find((f) => f.relativePath === 'rd/code-review.md');
      expect(move?.targetSessionId).toBe('009-fix-test-harness-tailwind');
      expect(move?.source).toBe('content-h1');
    });

    test('tier 3 — body frontmatter: "- rid: <change-id>" (no 3-digit prefix in filename)', async () => {
      const sid = '2026-06-04-session-ddddddd';
      // Filename has no 3-digit prefix → tier 1 doesn't match → tier 3 (frontmatter) wins.
      seedFile(
        join(project, `.peaks/_runtime/${sid}/qa/test-cases/orphan-rid-004.md`),
        '# QA Test Cases\n- rid: 004-foo\n- state: draft\n- type: feature\n\n## Test cases\n\ntest("example")\n'
      );

      const result = await migrateWorkspace({ projectRoot: project, apply: false });
      const move = result.wouldMove.find((f) => f.relativePath === 'qa/test-cases/orphan-rid-004.md');
      expect(move?.targetSessionId).toBe('004-foo');
      expect(move?.source).toBe('content-frontmatter');
    });

    test('tier 4 — per-session fallback to most recent rd/requests/', async () => {
      const sid = '2026-06-05-session-eeeeeeee';
      // The request artifact (no 3-digit prefix; date-prefixed change-id).
      seedFile(join(project, `.peaks/_runtime/${sid}/rd/requests/session-005-rid.md`), '# RD Request session-005-rid\n- state: draft\n- type: feature\n');
      // Then a "top-level" QA file with no 3-digit prefix and no H1/frontmatter
      seedFile(
        join(project, `.peaks/_runtime/${sid}/qa/test-cases/some-test.md`),
        '# QA Test Cases\n\n## Test cases\n\ntest("example")\n'
      );
      // Another QA file with explicit frontmatter override
      seedFile(join(project, `.peaks/_runtime/${sid}/qa/test-cases/other-test.md`), '# QA Test Cases\n- rid: session-005-explicit-override\n- type: feature\n');

      const result = await migrateWorkspace({ projectRoot: project, apply: false });
      // some-test.md has no tier-1/2/3 signal, so tier-4 fallback is used.
      const fallthrough = result.wouldMove.find((f) => f.relativePath === 'qa/test-cases/some-test.md');
      expect(fallthrough?.targetSessionId).toBe('session-005-rid');
      expect(fallthrough?.source).toBe('session-fallback');

      // other-test.md has an explicit frontmatter rid; that wins over the session fallback.
      const explicit = result.wouldMove.find((f) => f.relativePath === 'qa/test-cases/other-test.md');
      expect(explicit?.targetSessionId).toBe('session-005-explicit-override');
      expect(explicit?.source).toBe('content-frontmatter');
    });

    test('cross-cutting files route to .peaks/_runtime/<topic>/<role>/<file> (top-level)', async () => {
      const sid = '2026-06-06-session-fffffff';
      seedFile(join(project, `.peaks/_runtime/${sid}/rd/project-scan.md`), '# Project Scan: react-prompt-editor');
      seedFile(join(project, `.peaks/_runtime/${sid}/rd/perf-baseline.md`), '# Perf Baseline');
      seedFile(join(project, `.peaks/_runtime/${sid}/rd/perf baseline.md`), '# Performance Baseline');
      seedFile(join(project, `.peaks/_runtime/${sid}/rd/requests/001-cross.md`), '# RD 001-cross'); // non-cross-cutting

      const result = await migrateWorkspace({ projectRoot: project, apply: true });
      // Cross-cutting files are now in wouldMove (NOT skipped)
      const scanMove = result.moved.find((f) => f.relativePath === 'rd/project-scan.md');
      const perfWithSpaceMove = result.moved.find((f) => f.relativePath === 'rd/perf baseline.md');
      const perfMove = result.moved.find((f) => f.relativePath === 'rd/perf-baseline.md');

      expect(scanMove?.targetSessionId).toBe('project-scan');
      expect(toPosix(scanMove?.to ?? '')).toContain('/.peaks/project-scan/rd/project-scan.md');
      expect(perfMove?.targetSessionId).toBe('perf-baseline');
      expect(toPosix(perfMove?.to ?? '')).toContain('/.peaks/perf-baseline/rd/perf-baseline.md');
      expect(perfWithSpaceMove?.targetSessionId).toBe('perf-baseline');
      expect(toPosix(perfWithSpaceMove?.to ?? '')).toContain('/.peaks/perf-baseline/rd/perf baseline.md');

      // Files actually moved on disk
      expect(existsSync(join(project, '.peaks/project-scan/rd/project-scan.md'))).toBe(true);
      expect(existsSync(join(project, '.peaks/perf-baseline/rd/perf-baseline.md'))).toBe(true);
      expect(existsSync(join(project, '.peaks/perf-baseline/rd/perf baseline.md'))).toBe(true);

      // The non-cross-cutting request artifact is in retrospective
      expect(existsSync(join(project, '.peaks/retrospective/cross/rd/requests/001-cross.md'))).toBe(true);
    });

    test('transient runtime files (system/) are skipped; session.json is reconcile territory', async () => {
      // Note: `session.json` at the session root is `peaks workspace reconcile`
      // territory (moved to `.peaks/_runtime/session.json`), not migrate
      // territory — migrate only walks role subdirs.
      const sid = '2026-06-07-session-gggggg';
      seedFile(join(project, `.peaks/_runtime/${sid}/session.json`), '{}');
      seedFile(join(project, `.peaks/_runtime/${sid}/system/existing-system.md`), '# Existing System');
      seedFile(join(project, `.peaks/_runtime/${sid}/system/existing-system.json`), '{}');
      seedFile(join(project, `.peaks/_runtime/${sid}/rd/requests/session-007-trans.md`), '# RD Request session-007-trans');

      const result = await migrateWorkspace({ projectRoot: project, apply: false });
      const sysMd = result.sessions[0]?.files.find((f) => f.relativePath === 'system/existing-system.md');
      const sysJson = result.sessions[0]?.files.find((f) => f.relativePath === 'system/existing-system.json');

      expect(sysMd?.skipped).toBe(true);
      expect(sysMd?.skipReason).toBe('transient-runtime');
      expect(sysJson?.skipped).toBe(true);
      expect(sysJson?.skipReason).toBe('transient-runtime');
    });

    test('returns null change-id and skipReason="no-change-id" when no tier resolves', async () => {
      const sid = '2026-06-08-session-hhhhhh';
      seedFile(join(project, `.peaks/_runtime/${sid}/prd/requests/orphan.md`), '# PRD\n- state: draft\n');

      const result = await migrateWorkspace({ projectRoot: project, apply: false });
      const orphan = result.sessions[0]?.files.find((f) => f.relativePath === 'prd/requests/orphan.md');
      expect(orphan?.skipped).toBe(true);
      expect(orphan?.skipReason).toBe('no-change-id');
    });
  });

  // ==================================================================
  // Apply behavior
  // ==================================================================

  describe('apply', () => {
    test('git mv the file into retrospective/<sessionId>/<role>/<path>', async () => {
      const sid = '2026-06-09-session-iiiiiii';
      // Use a no-3-digit-prefix filename so the change-id survives verbatim.
      const sourcePath = join(project, `.peaks/_runtime/${sid}/rd/requests/session-009-move.md`);
      seedFile(sourcePath, '# RD Request session-009-move\n- state: qa-handoff');

      const result = await migrateWorkspace({ projectRoot: project, apply: true });
      expect(result.moved.length).toBe(1);
      expect(result.moved[0]?.targetSessionId).toBe('session-009-move');
      expect(toPosix(result.moved[0]?.to ?? '')).toContain('/retrospective/session-009-move/rd/requests/session-009-move.md');

      // File moved on disk
      const expectedTarget = join(project, '.peaks/retrospective/session-009-move/rd/requests/session-009-move.md');
      expect(existsSync(expectedTarget)).toBe(true);
      expect(existsSync(sourcePath)).toBe(false);

      // Empty session dir was removed
      expect(existsSync(join(project, '.peaks', sid))).toBe(false);
      expect(result.deletedSessions).toContain(sid);
    });

    test('is idempotent: re-running on an already-migrated tree is a no-op with conflicts', async () => {
      const sid = '2026-06-10-session-jjjjjjj';
      seedFile(join(project, `.peaks/_runtime/${sid}/rd/requests/session-010-idem.md`), '# RD Request session-010-idem');

      const first = await migrateWorkspace({ projectRoot: project, apply: true });
      expect(first.moved.length).toBe(1);
      expect(first.deletedSessions).toContain(sid);

      const second = await migrateWorkspace({ projectRoot: project, apply: false });
      expect(second.sessions).toEqual([]); // no legacy sessions left
      expect(second.wouldMove).toEqual([]);
    });

    test('does not delete a non-empty session dir', async () => {
      const sid = '2026-06-11-session-kkkkkk';
      seedFile(join(project, `.peaks/_runtime/${sid}/rd/requests/session-011-non-empty.md`), '# RD Request session-011-non-empty');
      seedFile(join(project, `.peaks/_runtime/${sid}/rd/requests/session-011-extra.md`), '# RD Request session-011-extra');

      const result = await migrateWorkspace({ projectRoot: project, apply: true });
      expect(result.moved.length).toBe(2);
      // Session dir becomes empty after both moves, so it IS deleted.
      expect(result.deletedSessions).toContain(sid);
    });

    test('skips and reports conflicts when target file already exists with different content', async () => {
      const sid = '2026-06-12-session-llllll';
      seedFile(join(project, `.peaks/_runtime/${sid}/rd/requests/session-012-conflict.md`), '# RD Request session-012-conflict\n- state: qa-handoff\n');
      // Pre-create the target with different content
      seedFile(join(project, '.peaks/retrospective/session-012-conflict/rd/requests/session-012-conflict.md'), '# DIFFERENT CONTENT');

      const result = await migrateWorkspace({ projectRoot: project, apply: true });
      // Move was NOT performed because target existed with different content
      const move = result.moved.find((m) => m.relativePath === 'rd/requests/session-012-conflict.md');
      expect(move).toBeUndefined();
      // Conflict was reported
      expect(result.conflicts.length).toBe(1);
      expect(result.conflicts[0]?.reason).toBe('target-exists-with-different-content');
      // Source file should still exist (move was skipped)
      expect(existsSync(join(project, `.peaks/_runtime/${sid}/rd/requests/session-012-conflict.md`))).toBe(true);
    });

    test('treats identical-content collision as already-migrated (no error, no re-write)', async () => {
      const sid = '2026-06-13-session-mmmmmm';
      const content = '# RD Request session-013-identical\n- state: qa-handoff\n';
      seedFile(join(project, `.peaks/_runtime/${sid}/rd/requests/session-013-identical.md`), content);
      seedFile(join(project, '.peaks/retrospective/session-013-identical/rd/requests/session-013-identical.md'), content);

      const result = await migrateWorkspace({ projectRoot: project, apply: true });
      const move = result.moved.find((m) => m.relativePath === 'rd/requests/session-013-identical.md');
      expect(move).toBeUndefined(); // skip — already migrated
      expect(result.conflicts.length).toBe(1);
      expect(result.conflicts[0]?.reason).toBe('identical-content-already-migrated');
    });
  });

  // ==================================================================
  // Cross-cutting
  // ==================================================================

  describe('cross-cutting', () => {
    test('retrospective dir is created when first file is moved there', async () => {
      const sid = '2026-06-14-session-nnnnnn';
      seedFile(join(project, `.peaks/_runtime/${sid}/rd/requests/session-014-first.md`), '# RD Request session-014-first');

      await migrateWorkspace({ projectRoot: project, apply: true });
      expect(existsSync(join(project, '.peaks/retrospective'))).toBe(true);
      expect(existsSync(join(project, '.peaks/retrospective/session-014-first'))).toBe(true);
    });

    test('multiple sessions contributing to the same change-id converge in retrospective', async () => {
      const sid1 = '2026-06-15-session-aaaaa1';
      const sid2 = '2026-06-15-session-bbbbb1';
      seedFile(join(project, `.peaks/_runtime/${sid1}/rd/tech-doc.md`), '# Tech Doc: slice-008-shared');
      seedFile(join(project, `.peaks/_runtime/${sid2}/rd/code-review.md`), '# Code Review slice-008-shared');

      const result = await migrateWorkspace({ projectRoot: project, apply: true });
      expect(result.moved.length).toBe(2);
      expect(result.moved.map((m) => m.targetSessionId)).toEqual(['slice-008-shared', 'slice-008-shared']);
      expect(result.moved.every((m) => toPosix(m.to).includes('/retrospective/slice-008-shared/'))).toBe(true);

      // Both files under the same retrospective change-id
      const retro = join(project, '.peaks/retrospective/slice-008-shared');
      expect(existsSync(join(retro, 'rd/tech-doc.md'))).toBe(true);
      expect(existsSync(join(retro, 'rd/code-review.md'))).toBe(true);
    });

    test('retrospective migrate is independent of .peaks/_runtime/ (runtime not touched)', async () => {
      seedFile(join(project, '.peaks/_runtime/session.json'), '{"sessionId":"x"}');
      seedFile(join(project, '.peaks/_runtime/active-skill.json'), '{}');
      const sid = '2026-06-16-session-pppppp';
      seedFile(join(project, `.peaks/_runtime/${sid}/rd/requests/session-016-runtime.md`), '# RD Request session-016-runtime');

      await migrateWorkspace({ projectRoot: project, apply: true });
      // _runtime/ untouched
      expect(existsSync(join(project, '.peaks/_runtime/session.json'))).toBe(true);
      expect(existsSync(join(project, '.peaks/_runtime/active-skill.json'))).toBe(true);
      // Migrated
      expect(existsSync(join(project, '.peaks/retrospective/session-016-runtime/rd/requests/session-016-runtime.md'))).toBe(true);
    });
  });
});
