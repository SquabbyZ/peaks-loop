import { mkdtemp, readdir, stat, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { initWorkspace, validateSessionId, InvalidSessionIdError, ConflictingSessionError } from '../../src/services/workspace/workspace-service.js';
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
    // under `.peaks/<change-id>/<role>/` when --change-id is passed.
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

  test('rebind path leaves the .peaks/<first>/ directory on disk (not deleted)', async () => {
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
    // Simulate: a .peaks/<Y>/ exists but is empty (true leftover, e.g. previous
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

  test('does NOT pre-create .peaks/<change-id>/qa/screenshots/ (slice 006 lazy mkdir)', async () => {
    // Slice 006 collapsed the per-session layout. The role subdirs
    // (prd/, qa/, rd/, sc/, txt/) are NOT pre-created by init.
    // They are created on demand by the writer at the write site
    // (e.g. `peaks qa --screenshot ...` does `mkdir -p
    // .peaks/<change-id>/qa/screenshots/` before writing the file).
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
 * `.peaks/<sid>/` directory. The only home for the session dir is
 * `.peaks/_runtime/<sid>/`. Reviewable content (rd/, qa/, prd/, ui/, sc/, txt/)
 * lives at `.peaks/<change-id>/<role>/` when --change-id is given.
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
