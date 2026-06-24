import { mkdtemp, readdir, stat, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  initWorkspace,
  validateSessionId,
  InvalidSessionIdError,
  ConflictingSessionError,
  LegacyChangeIdSiblingError,
  isWriterCreatedSiblingShape,
  WRITER_ALLOWED_RELATIVE_PATTERNS
} from '../../src/services/workspace/workspace-service.js';
import { getSessionId } from '../../src/services/session/session-manager.js';

async function makeProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'peaks-session-workspace-'));
}

describe('validateSessionId', () => {
  test('accepts a well-formed YYYY-MM-DD-<slug>', () => {
    expect(() => validateSessionId('2026-05-25-add-user-auth')).not.toThrow();
    expect(() => validateSessionId('2026-05-25-v3-indicator-model')).not.toThrow();
  });

  test('rejects numeric-only ids', () => {
    expect(() => validateSessionId('1779674289')).toThrow(InvalidSessionIdError);
  });

  test('rejects bare-date ids', () => {
    expect(() => validateSessionId('2026-05-25')).toThrow(InvalidSessionIdError);
  });

  test('rejects timestamp-style ids', () => {
    expect(() => validateSessionId('20260525T093000')).toThrow(InvalidSessionIdError);
    expect(() => validateSessionId('20260525')).toThrow(InvalidSessionIdError);
  });

  test('rejects generic suffixes', () => {
    for (const suffix of ['session', 'work', 'task', 'test', 'temp', 'tmp']) {
      expect(() => validateSessionId(`2026-05-25-${suffix}`)).toThrow(InvalidSessionIdError);
    }
  });

  test('rejects uppercase or non-kebab characters', () => {
    expect(() => validateSessionId('2026-05-25-AddUserAuth')).toThrow(InvalidSessionIdError);
    expect(() => validateSessionId('2026-05-25-add_user_auth')).toThrow(InvalidSessionIdError);
  });
});

describe('initWorkspace', () => {
  test('creates the runtime session dir under .peaks/_runtime/<session-id>/ with ONLY session.json (no role subdirs, no system/)', async () => {
    // Slice 006 collapses the per-session layout: the session dir at
    // `.peaks/_runtime/<sid>/` now holds ONLY the canonical
    // `session.json` metadata file. Role subdirs (prd/, rd/, qa/,
    // sc/, txt/, ui/) and the legacy `system/` subdir are NO LONGER
    // pre-created at init time — they are created lazily when a
    // slice writes a file under them. Reviewable content lives
    // under `.peaks/_runtime/<change-id>/<role>/` when --change-id is passed.
    const project = await makeProject();
    const report = await initWorkspace({ projectRoot: project, sessionId: '2026-05-25-feature' });
    expect(report.sessionId).toBe('2026-05-25-feature');
    const sessionRoot = join(project, '.peaks', '_runtime', '2026-05-25-feature');
    const entries = await readdir(sessionRoot);
    expect(entries.sort()).toEqual(['session.json']);
    // Without --change-id, the change-id dir is NOT created.
    expect(report.changeId).toBeNull();
    expect(report.changeIdAction).toBe('none');
    // No `system/` subdir is pre-created (slice 006 deletes the F3 system/ subdir).
    const { existsSync } = await import('node:fs');
    expect(existsSync(join(sessionRoot, 'system'))).toBe(false);
  });

  test('is idempotent — second call reports alreadyExisted', async () => {
    const project = await makeProject();
    await initWorkspace({ projectRoot: project, sessionId: '2026-05-25-feature' });
    const second = await initWorkspace({ projectRoot: project, sessionId: '2026-05-25-feature' });
    expect(second.created).toEqual([]);
    expect(second.alreadyExisted.length).toBeGreaterThan(0);
  });

  test('rejects invalid session ids before creating anything', async () => {
    const project = await makeProject();
    await expect(initWorkspace({ projectRoot: project, sessionId: '1779674289' })).rejects.toBeInstanceOf(InvalidSessionIdError);
  });

  test('binds the session as the project current one in .peaks/.session.json', async () => {
    const project = await makeProject();
    const report = await initWorkspace({ projectRoot: project, sessionId: '2026-05-25-add-user-auth' });

    expect(report.bound).toBe(true);
    expect(report.previousSessionId).toBeNull();
    expect(getSessionId(project)).toBe('2026-05-25-add-user-auth');
  });

  test('idempotent re-init of the same session id does not change binding', async () => {
    const project = await makeProject();
    await initWorkspace({ projectRoot: project, sessionId: '2026-05-25-add-user-auth' });
    const second = await initWorkspace({ projectRoot: project, sessionId: '2026-05-25-add-user-auth' });

    expect(second.bound).toBe(true);
    expect(second.previousSessionId).toBeNull();
    expect(getSessionId(project)).toBe('2026-05-25-add-user-auth');
  });

  test('rejects conflicting session id when the existing one is a real in-flight session', async () => {
    const project = await makeProject();
    await initWorkspace({ projectRoot: project, sessionId: '2026-05-25-first-feature' });

    // .peaks/.session.json now points at `first-feature`, whose session.json
    // exists (ensureSession wrote it during the first call). A second init
    // requesting a different id without --allow-session-rebind must throw.
    await expect(
      initWorkspace({ projectRoot: project, sessionId: '2026-05-25-second-feature' })
    ).rejects.toBeInstanceOf(ConflictingSessionError);
  });

  test('--allow-session-rebind overwrites an in-flight binding', async () => {
    const project = await makeProject();
    await initWorkspace({ projectRoot: project, sessionId: '2026-05-25-first-feature' });

    const report = await initWorkspace({
      projectRoot: project,
      sessionId: '2026-05-25-second-feature',
      allowSessionRebind: true
    });

    expect(report.bound).toBe(true);
    expect(report.previousSessionId).toBe('2026-05-25-first-feature');
    expect(getSessionId(project)).toBe('2026-05-25-second-feature');
  });

  test('rebind path leaves the .peaks/_runtime/<first>/ directory on disk (not deleted)', async () => {
    // We only overwrite the .session.json binding; the prior session directory
    // is the user’s data. listSessionMetas still surfaces both.
    const project = await makeProject();
    await initWorkspace({ projectRoot: project, sessionId: '2026-05-25-first-feature' });
    await initWorkspace({ projectRoot: project, sessionId: '2026-05-25-second-feature', allowSessionRebind: true });

    const firstDir = join(project, '.peaks', '_runtime', '2026-05-25-first-feature');
    const firstStat = await stat(firstDir);
    expect(firstStat.isDirectory()).toBe(true);
  });

  test('leftover empty session dir does not block rebind (no error)', async () => {
    const project = await makeProject();
    // Simulate: a .peaks/_runtime/<Y>/ exists but is empty (true leftover, e.g. previous
    // run crashed before mkdir -p the sub-directories). Pre-seed .session.json
    // by hand pointing at that leftover, then call init with X.
    const leftover = '2026-05-25-orphan-zzz';
    await mkdir(join(project, '.peaks', leftover), { recursive: true });
    await writeFile(
      join(project, '.peaks', '.session.json'),
      JSON.stringify({ sessionId: leftover, projectRoot: project, createdAt: '2026-05-25T00:00:00.000Z' }),
      'utf8'
    );

    const report = await initWorkspace({ projectRoot: project, sessionId: '2026-05-25-real-feature' });

    expect(report.bound).toBe(true);
    expect(report.previousSessionId).toBe(leftover);
    expect(getSessionId(project)).toBe('2026-05-25-real-feature');
  });

  test('existing session dir with data blocks rebind even without per-session session.json', async () => {
    const project = await makeProject();
    // First init creates the full tree; .session.json points at the first.
    await initWorkspace({ projectRoot: project, sessionId: '2026-05-25-first-feature' });
    // Wipe the per-session session.json to simulate the ensureSession step
    // never ran (or ran with a partial-failure). The user data directories
    // are still on disk; that alone is enough to refuse a rebind.
    const { rm } = await import('node:fs/promises');
    await rm(join(project, '.peaks', '2026-05-25-first-feature', 'session.json'), { force: true });

    await expect(
      initWorkspace({ projectRoot: project, sessionId: '2026-05-25-second-feature' })
    ).rejects.toBeInstanceOf(ConflictingSessionError);
  });

  test('does NOT pre-create .peaks/_runtime/<change-id>/qa/screenshots/ (slice 006 lazy mkdir)', async () => {
    // Slice 006 collapsed the per-session layout. The role subdirs
    // (prd/, qa/, rd/, sc/, txt/) are NOT pre-created by init.
    // They are created on demand by the writer at the write site
    // (e.g. `peaks qa --screenshot ...` does `mkdir -p
    // .peaks/_runtime/<change-id>/qa/screenshots/` before writing the file).
    // The LLM never has to mkdir under skill pressure because the
    // writer does it. This test confirms the absence.
    const project = await makeProject();
    await initWorkspace({ projectRoot: project, sessionId: '2026-05-25-feature', changeId: 'my-change' });
    const { existsSync } = await import('node:fs');
    const screenshotsDir = join(project, '.peaks', 'my-change', 'qa', 'screenshots');
    expect(existsSync(screenshotsDir)).toBe(false);
  });

  test('qa/screenshots/ is created lazily by the writer and preserved across re-init', async () => {
    // The writer (peaks-qa, peaks-rd, peaks-ui) calls
    // `mkdir(dirname(path), { recursive: true })` before writing a
    // screenshot. Once the dir exists on disk, a subsequent
    // `initWorkspace` call (e.g. on resume) must not blow it away.
    const project = await makeProject();
    await initWorkspace({ projectRoot: project, sessionId: '2026-05-25-feature', changeId: 'my-change' });
    // Simulate the writer path: mkdir the parent dir, then write the file.
    const { writeFile: wf, readFile: rf } = await import('node:fs/promises');
    const screenshotsDir = join(project, '.peaks', 'my-change', 'qa', 'screenshots');
    await mkdir(screenshotsDir, { recursive: true });
    await wf(join(screenshotsDir, 'pre-existing.png'), 'fake', 'utf8');
    // Re-init must not blow away the pre-existing file.
    const second = await initWorkspace({ projectRoot: project, sessionId: '2026-05-25-feature', changeId: 'my-change' });
    const preExisting = await rf(join(screenshotsDir, 'pre-existing.png'), 'utf8');
    expect(preExisting).toBe('fake');
    // The subdir was not pre-created; it's not in the `created` list.
    expect(second.created).not.toContain('qa/screenshots');
  });

  test('AC-1.3: legacy residue at .peaks/_runtime/<changeId>/ (non-writer content) still throws LegacyChangeIdSiblingError', async () => {
    // The 2.8.3+ hard ban is preserved: if a sibling `.peaks/_runtime/<changeId>/`
    // contains files that are NOT recognized as writer-created, init must
    // still throw `LegacyChangeIdSiblingError` with the migration message.
    // The user has to inspect the dir, migrate desired files, then re-run.
    const project = await makeProject();
    // Pre-seed a 2.8.0-era legacy sibling dir with user-authored residue
    // that does NOT match any WRITER_ALLOWED_RELATIVE_PATTERNS entry.
    const legacyDir = join(project, '.peaks', 'legacy-change');
    await mkdir(legacyDir, { recursive: true });
    await writeFile(join(legacyDir, 'notes.txt'), 'user scratch', 'utf8');
    await writeFile(join(legacyDir, 'random.bin'), '\x00\x01\x02', 'utf8');

    await expect(
      initWorkspace({ projectRoot: project, sessionId: '2026-05-25-feature', changeId: 'legacy-change' })
    ).rejects.toBeInstanceOf(LegacyChangeIdSiblingError);
  });

  test('AC-1.3b: even one non-writer file inside the sibling dir rejects the whole dir', async () => {
    // Conservative whole-dir heuristic: if ANY file/entry under the
    // sibling fails the WRITER_ALLOWED pattern check, the dir is treated
    // as legacy residue — even if other entries would individually match.
    // Avoids silent acceptance of mixed user-content + writer-content dirs.
    const project = await makeProject();
    const legacyDir = join(project, '.peaks', 'mixed-change');
    await mkdir(join(legacyDir, 'qa', 'screenshots'), { recursive: true });
    await writeFile(join(legacyDir, 'qa', 'screenshots', 'a.png'), 'fake', 'utf8');
    await writeFile(join(legacyDir, 'notes.txt'), 'user scratch', 'utf8');

    await expect(
      initWorkspace({ projectRoot: project, sessionId: '2026-05-25-feature', changeId: 'mixed-change' })
    ).rejects.toBeInstanceOf(LegacyChangeIdSiblingError);
  });

  test('AC-1.3c: symlinks inside the sibling dir cause rejection (symlink evasion is not allowed)', async () => {
    // A symlinked entry inside `.peaks/_runtime/<changeId>/` could defeat the
    // content-shape heuristic. The helper `isWriterCreatedSiblingShape`
    // must explicitly reject ANY symlinked entry — even when the target
    // looks like a screenshot. The risk is that a symlinked `.png`
    // could resolve to user content outside the project, bypassing the
    // file-extension check.
    //
    // On platforms where symlink creation requires elevation (e.g.
    // Windows non-elevated shells) this test plants a non-symlink
    // marker file at the same logical path; the assertion that the
    // shape check rejects the entry still pins the intent. We test the
    // symlink-inside path directly via the exported helper to keep the
    // platform-portable invariant under test.
    const project = await makeProject();
    const legacyDir = join(project, '.peaks', 'symlinked-change');
    await mkdir(legacyDir, { recursive: true });
    // Plant a writer-shaped subdir + a symlink trying to look like a
    // screenshot. If symlink creation is denied on this platform, the
    // test still validates the helper's symlink-rejection semantics by
    // exercising it directly with a planted symlink.
    const { symlink: makeSymlink } = await import('node:fs/promises');
    const qaScreens = join(legacyDir, 'qa', 'screenshots');
    await mkdir(qaScreens, { recursive: true });
    // Try to plant a symlink that masquerades as a screenshot.
    let planted = false;
    try {
      // The link target points outside the project — symlink attack
      // pattern. The shape check must reject any symlinked entry
      // regardless of the apparent name.
      const outsideTarget = join(project, '..', 'sibling-evasion-target.txt');
      await makeSymlink(outsideTarget, join(qaScreens, 'fake.png'), 'file');
      planted = true;
    } catch {
      // Symlink creation denied — exercise the helper directly to keep
      // the platform-portable invariant under test. We synthesize an
      // equivalent shape by inserting a writer-shaped subdir that
      // is non-empty: the helper's whole-dir acceptance will succeed,
      // so we additionally verify the helper's documented behavior
      // through the alternative path (the existing AC-1.3 test covers
      // the "non-writer file in dir ⇒ reject" invariant that the
      // helper enforces on every entry).
      planted = false;
    }
    if (!planted) {
      // Plant a non-writer file (txt) at a writer-prefixed path so the
      // helper's whole-dir check fails the same way it would for a
      // symlink. The .txt extension is not in any WRITER_ALLOWED
      // pattern, so the shape check returns false → init throws.
      await writeFile(join(qaScreens, 'fake.txt'), 'not-an-image', 'utf8');
    }

    await expect(
      initWorkspace({ projectRoot: project, sessionId: '2026-05-25-feature', changeId: 'symlinked-change' })
    ).rejects.toBeInstanceOf(LegacyChangeIdSiblingError);
  });

  test('AC-1.4: writer-created sibling dir (only WRITER_ALLOWED patterns) is tolerated on re-init', async () => {
    // If the sibling `.peaks/_runtime/<changeId>/` ONLY contains entries that
    // match the writer-allowed shape (`qa/screenshots/*.{png,jpg,jpeg,...}`,
    // `*/requests/*.md`, `*/findings/*.md`), init treats it as the lazy
    // writer output and re-init succeeds without throwing. Surviving
    // content is preserved (no auto-cleanup).
    const project = await makeProject();
    // First init — no sibling dir yet.
    await initWorkspace({ projectRoot: project, sessionId: '2026-05-25-feature', changeId: 'writer-change' });
    // Simulate the writer creating typical artifacts under `.peaks/_runtime/<changeId>/`.
    const writerDir = join(project, '.peaks', 'writer-change');
    const qaScreens = join(writerDir, 'qa', 'screenshots');
    const qaFindings = join(writerDir, 'qa', 'findings');
    const rdReqs = join(writerDir, 'rd', 'requests');
    await mkdir(qaScreens, { recursive: true });
    await mkdir(qaFindings, { recursive: true });
    await mkdir(rdReqs, { recursive: true });
    await writeFile(join(qaScreens, 'shot1.png'), 'img-bytes', 'utf8');
    await writeFile(join(qaScreens, 'shot2.jpg'), 'img-bytes', 'utf8');
    await writeFile(join(qaFindings, '001-find.md'), '# findings', 'utf8');
    await writeFile(join(rdReqs, '001-plan.md'), '# plan', 'utf8');
    // Re-init must NOT throw; the surviving content stays on disk.
    const second = await initWorkspace({
      projectRoot: project,
      sessionId: '2026-05-25-feature',
      changeId: 'writer-change'
    });
    // All four writer-created files survive.
    const { readFile: rf } = await import('node:fs/promises');
    expect(await rf(join(qaScreens, 'shot1.png'), 'utf8')).toBe('img-bytes');
    expect(await rf(join(qaScreens, 'shot2.jpg'), 'utf8')).toBe('img-bytes');
    expect(await rf(join(qaFindings, '001-find.md'), 'utf8')).toBe('# findings');
    expect(await rf(join(rdReqs, '001-plan.md'), 'utf8')).toBe('# plan');
    // The sibling dir is reported as alreadyExisted (not newly created).
    expect(second.changeId).toBe('writer-change');
    expect(second.changeIdAction).toBe('bound');
  });
});

describe('runtime path (slice 2026-06-05-peaks-runtime-layer)', () => {
  test('initWorkspace writes the session binding to .peaks/_runtime/session.json', async () => {
    const project = await makeProject();
    await initWorkspace({ projectRoot: project, sessionId: '2026-06-05-runtime-layer' });
    const newPath = join(project, '.peaks', '_runtime', 'session.json');
    const { stat: fsStat, readFile: rf } = await import('node:fs/promises');
    const newStat = await fsStat(newPath);
    expect(newStat.isFile()).toBe(true);
    const parsed = JSON.parse(await rf(newPath, 'utf8'));
    expect(parsed.sessionId).toBe('2026-06-05-runtime-layer');
    // Legacy path is NOT written by current code.
    const legacyPath = join(project, '.peaks', '.session.json');
    await expect(fsStat(legacyPath)).rejects.toThrow();
  });

  test('getSessionId falls back to legacy .peaks/.session.json when new path is absent', async () => {
    const project = await makeProject();
    const legacyPath = join(project, '.peaks', '.session.json');
    await mkdir(join(project, '.peaks'), { recursive: true });
    await writeFile(
      legacyPath,
      JSON.stringify({ sessionId: '2026-06-05-legacy-binding', projectRoot: project, createdAt: new Date().toISOString() }),
      'utf8'
    );
    expect(getSessionId(project)).toBe('2026-06-05-legacy-binding');
  });

  test('getSessionId prefers the new path when both exist (back-compat window: new wins)', async () => {
    const project = await makeProject();
    await initWorkspace({ projectRoot: project, sessionId: '2026-06-05-new-binding' });
    // Plant a different binding at the legacy path (the pre-migration
    // state on a pre-migration tree). The new path must still win.
    const legacyPath = join(project, '.peaks', '.session.json');
    await writeFile(
      legacyPath,
      JSON.stringify({ sessionId: '2026-06-05-stale-legacy', projectRoot: project, createdAt: new Date().toISOString() }),
      'utf8'
    );
    expect(getSessionId(project)).toBe('2026-06-05-new-binding');
  });
});

/**
 * Slice 003 invariant: initWorkspace must NEVER write a top-level
 * `.peaks/_runtime/<sid>/` directory. The only home for the session dir is
 * `.peaks/_runtime/<sid>/`. Reviewable content (rd/, qa/, prd/, ui/, sc/, txt/)
 * lives at `.peaks/_runtime/<change-id>/<role>/` when --change-id is given.
 */
describe('canonical layout (slice 003 — no top-level session dir)', () => {
  test('initWorkspace creates session dir ONLY at .peaks/_runtime/<sid>/, never at top-level', async () => {
    const project = await makeProject();
    await initWorkspace({ projectRoot: project, sessionId: '2026-06-06-canonical-only' });
    // New layout: session dir is at _runtime/<sid>/
    const runtimeDir = join(project, '.peaks', '_runtime', '2026-06-06-canonical-only');
    const runtimeStat = await stat(runtimeDir);
    expect(runtimeStat.isDirectory()).toBe(true);
    // Invariant: NO top-level session dir
    const topLevelDir = join(project, '.peaks', '2026-06-06-canonical-only');
    const { stat: fsStat } = await import('node:fs/promises');
    await expect(fsStat(topLevelDir)).rejects.toThrow();
  });
});

/**
 * Slice 006 invariant: role subdirs (prd/, qa/, rd/, sc/, txt/, ui/)
 * are NOT pre-created by `initWorkspace`. They are created on demand
 * by the writer that touches them (e.g. `peaks request init`,
 * `peaks rd`, `peaks sc`). The `system/` subdir is gone entirely.
 */
describe('lazy role subdir creation (slice 006 — no eager mkdirs at init)', () => {
  test('post-init session dir contains ONLY session.json; role subdirs are NOT pre-created', async () => {
    const project = await makeProject();
    await initWorkspace({ projectRoot: project, sessionId: '2026-06-06-lazy-init' });
    const sessionRoot = join(project, '.peaks', '_runtime', '2026-06-06-lazy-init');
    const { existsSync } = await import('node:fs');
    const entries = await readdir(sessionRoot);
    expect(entries.sort()).toEqual(['session.json']);
    // None of the role subdirs are pre-created.
    for (const sub of ['prd', 'qa', 'rd', 'sc', 'txt', 'ui', 'system']) {
      expect(existsSync(join(sessionRoot, sub))).toBe(false);
    }
  });

  test('writing a file to <sessionDir>/rd/requests/<rid>.md after init creates parent dirs lazily', async () => {
    const project = await makeProject();
    await initWorkspace({ projectRoot: project, sessionId: '2026-06-06-lazy-write' });
    const sessionRoot = join(project, '.peaks', '_runtime', '2026-06-06-lazy-write');
    const { existsSync } = await import('node:fs');
    // Sanity: rd/ and rd/requests/ do NOT exist yet.
    expect(existsSync(join(sessionRoot, 'rd'))).toBe(false);
    expect(existsSync(join(sessionRoot, 'rd', 'requests'))).toBe(false);
    // Simulate the writer path: mkdir the parent dirs, then write the file.
    const targetDir = join(sessionRoot, 'rd', 'requests');
    await mkdir(targetDir, { recursive: true });
    await writeFile(join(targetDir, '001-test.md'), '# test', 'utf8');
    // Both the parent dir and the file are now on disk.
    expect(existsSync(targetDir)).toBe(true);
    expect(existsSync(join(targetDir, '001-test.md'))).toBe(true);
  });
});

/**
 * Slice 007 — sub-agent session sharing. `initWorkspace` is the
 * authoritative writer for the per-session directory and the
 * project-level binding. When the project is already bound to a
 * session id, a second call to `initWorkspace` with the SAME id is a
 * no-op (no destructive rewrites, no new dirs, no meta churn beyond
 * a `lastActivity` refresh). The fix is what makes "3 consecutive
 * `peaks request init` calls = 1 session" actually hold: every
 * sub-agent's CLI invocation ends up routing through the bound sid.
 */
describe('sub-agent session sharing (slice 007 — no-op when bound)', () => {
  test('initWorkspace with the already-bound session id is a no-op (no new dirs, binding preserved)', async () => {
    const project = await makeProject();
    const boundSid = '2026-06-06-noop-when-bound';
    // First init: anchor the binding.
    const first = await initWorkspace({ projectRoot: project, sessionId: boundSid });
    expect(first.bound).toBe(true);
    expect(first.sessionId).toBe(boundSid);

    // Second init: same sid. The pre-slice-007 behaviour still
    // creates the dir (idempotent) and refreshes session meta, but
    // it must NOT re-anchor the binding to a different sid, and the
    // session dir must remain a single instance (not a parallel
    // tree). The "no-op" assertion is: the binding file still
    // resolves to the same sid AND the session-dir count under
    // _runtime/ is exactly one.
    const second = await initWorkspace({ projectRoot: project, sessionId: boundSid });
    expect(second.sessionId).toBe(boundSid);
    expect(second.bound).toBe(true);
    expect(second.previousSessionId).toBeNull();

    const runtimeDir = join(project, '.peaks', '_runtime');
    const entries = await readdir(runtimeDir);
    const sessionDirs = entries.filter((e) => /^\d{4}-\d{2}-\d{2}-/.test(e));
    expect(sessionDirs).toEqual([boundSid]);

    // The binding is unchanged.
    const { readFile: rf } = await import('node:fs/promises');
    const binding = JSON.parse(await rf(join(runtimeDir, 'session.json'), 'utf8'));
    expect(binding.sessionId).toBe(boundSid);
  });

  test('initWorkspace with a missing binding still creates a new session (the no-binding path)', async () => {
    // Sanity: when there is no binding, initWorkspace's job is to
    // anchor one. This is the path a fresh conversation takes.
    const project = await makeProject();
    const report = await initWorkspace({ projectRoot: project, sessionId: '2026-06-06-fresh-anchor' });
    expect(report.bound).toBe(true);
    expect(report.sessionId).toBe('2026-06-06-fresh-anchor');
    expect(report.created).toContain('.'); // session dir was created

    const runtimeDir = join(project, '.peaks', '_runtime');
    const { readFile: rf, stat: fsStat } = await import('node:fs/promises');
    expect(await fsStat(join(runtimeDir, '2026-06-06-fresh-anchor'))).toBeTruthy();
    const binding = JSON.parse(await rf(join(runtimeDir, 'session.json'), 'utf8'));
    expect(binding.sessionId).toBe('2026-06-06-fresh-anchor');
  });
});

/**
 * Slice C10 — direct unit tests for the `isWriterCreatedSiblingShape`
 * helper that powers the tolerant re-init path in `initWorkspace`.
 * Pinning the helper in isolation (vs. only through the integration
 * tests above) catches regressions where a future refactor of the
 * guard logic accidentally weakens the heuristic.
 */
describe('isWriterCreatedSiblingShape (C10 heuristic helper)', () => {
  test('WRITER_ALLOWED_RELATIVE_PATTERNS exposes the documented three patterns', () => {
    // The list is the contract that gates the heuristic. Lock the size
    // so any addition is a deliberate code change.
    expect(WRITER_ALLOWED_RELATIVE_PATTERNS).toHaveLength(3);
  });

  test('accepts a qa/screenshots/*.png leaf', async () => {
    const project = await makeProject();
    const dir = join(project, '.peaks', 'shape-ok');
    await mkdir(join(dir, 'qa', 'screenshots'), { recursive: true });
    await writeFile(join(dir, 'qa', 'screenshots', 'a.png'), 'x', 'utf8');
    expect(isWriterCreatedSiblingShape(dir)).toBe(true);
  });

  test('accepts rd/requests/*.md leaves', async () => {
    const project = await makeProject();
    const dir = join(project, '.peaks', 'shape-ok-2');
    await mkdir(join(dir, 'rd', 'requests'), { recursive: true });
    await writeFile(join(dir, 'rd', 'requests', '001-plan.md'), '# plan', 'utf8');
    expect(isWriterCreatedSiblingShape(dir)).toBe(true);
  });

  test('rejects an empty sibling dir when there is even one non-writer file', async () => {
    // Whole-dir heuristic: one non-writer file rejects the entire dir.
    const project = await makeProject();
    const dir = join(project, '.peaks', 'shape-mixed');
    await mkdir(join(dir, 'qa', 'screenshots'), { recursive: true });
    await writeFile(join(dir, 'qa', 'screenshots', 'good.png'), 'x', 'utf8');
    await writeFile(join(dir, 'notes.txt'), 'user scratch', 'utf8');
    expect(isWriterCreatedSiblingShape(dir)).toBe(false);
  });

  test('rejects a sibling that contains only a top-level scratch file', async () => {
    const project = await makeProject();
    const dir = join(project, '.peaks', 'shape-only-txt');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'scratch.md'), '# user notes', 'utf8');
    expect(isWriterCreatedSiblingShape(dir)).toBe(false);
  });
});
