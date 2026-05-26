import { mkdtemp, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { initWorkspace, validateSessionId, InvalidSessionIdError } from '../../src/services/workspace/workspace-service.js';

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
    expect(qaSubs.sort()).toEqual(['requests', 'test-cases', 'test-reports']);
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
});
