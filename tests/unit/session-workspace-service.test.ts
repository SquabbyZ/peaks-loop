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
  test('creates the full directory tree under .peaks/<session-id>/', async () => {
    const project = await makeProject();
    const report = await initWorkspace({ projectRoot: project, sessionId: '2026-05-25-feature' });
    expect(report.sessionId).toBe('2026-05-25-feature');
    const sessionRoot = join(project, '.peaks', '2026-05-25-feature');
    const entries = await readdir(sessionRoot);
    expect(entries.sort()).toEqual(['prd', 'qa', 'rd', 'sc', 'system', 'txt', 'ui']);
    const prdSubs = await readdir(join(sessionRoot, 'prd'));
    expect(prdSubs.sort()).toEqual(['requests', 'source']);
    const qaSubs = await readdir(join(sessionRoot, 'qa'));
    expect(qaSubs.sort()).toEqual(['requests', 'screenshots', 'test-cases', 'test-reports']);
    const systemStat = await stat(join(sessionRoot, 'system'));
    expect(systemStat.isDirectory()).toBe(true);
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

    const firstDir = join(project, '.peaks', '2026-05-25-first-feature');
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

  test('pre-creates .peaks/<sid>/qa/screenshots/ so QA browser evidence has a stable home from the start', async () => {
    // The qa/screenshots subdir is the home for browser_take_screenshot
    // evidence (the hard contract in peaks-qa / peaks-rd / peaks-ui
    // requires every screenshot to land there). Pre-creating the dir
    // means the first QA call has a target; the LLM never has to
    // mkdir under skill pressure.
    const project = await makeProject();
    await initWorkspace({ projectRoot: project, sessionId: '2026-05-25-feature' });
    const screenshotsDir = join(project, '.peaks', '2026-05-25-feature', 'qa', 'screenshots');
    const stat = await import('node:fs/promises').then((m) => m.stat(screenshotsDir));
    expect(stat.isDirectory()).toBe(true);
  });

  test('qa/screenshots/ creation is idempotent on re-init', async () => {
    const project = await makeProject();
    await initWorkspace({ projectRoot: project, sessionId: '2026-05-25-feature' });
    // Pre-seed a file the QA flow is expected to write later.
    const { writeFile: wf } = await import('node:fs/promises');
    const screenshotsDir = join(project, '.peaks', '2026-05-25-feature', 'qa', 'screenshots');
    await wf(join(screenshotsDir, 'pre-existing.png'), 'fake', 'utf8');
    // Re-init must not blow away the pre-existing file.
    const second = await initWorkspace({ projectRoot: project, sessionId: '2026-05-25-feature' });
    const { readFile: rf } = await import('node:fs/promises');
    const preExisting = await rf(join(screenshotsDir, 'pre-existing.png'), 'utf8');
    expect(preExisting).toBe('fake');
    // The subdir appears in alreadyExisted on the second run, never in created.
    expect(second.created).not.toContain('qa/screenshots');
  });
});
