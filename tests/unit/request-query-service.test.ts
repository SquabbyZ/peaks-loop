import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  createRequestArtifact,
  listRequestArtifacts,
  showRequestArtifact,
  type RequestArtifactRole
} from '../../src/services/artifacts/request-artifact-service.js';

async function makeProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'peaks-request-query-'));
}

async function seedArtifact(
  project: string,
  role: RequestArtifactRole,
  sessionId: string,
  requestId: string,
  state = 'draft'
): Promise<void> {
  const dir = join(project, '.peaks', sessionId, role, 'requests');
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${requestId}.md`),
    `# ${role.toUpperCase()} Request ${requestId}\n\n- session: ${sessionId}\n\n## Status\n\n- created: 2026-05-23T12:00:00.000Z\n- last update: 2026-05-23T12:00:00.000Z\n- state: ${state}\n`,
    'utf8'
  );
}

const ROLES: RequestArtifactRole[] = ['prd', 'ui', 'rd', 'qa'];

describe('listRequestArtifacts', () => {
  test('returns an empty list when the .peaks directory does not exist', async () => {
    const project = await makeProject();

    const result = await listRequestArtifacts({ projectRoot: project });

    expect(result).toEqual([]);
  });

  test('lists every per-request artifact under every session and role', async () => {
    const project = await makeProject();
    await seedArtifact(project, 'prd', 'session-a', '2026-05-23-add-foo');
    await seedArtifact(project, 'rd', 'session-a', '2026-05-23-add-foo', 'spec-locked');
    await seedArtifact(project, 'prd', 'session-b', '2026-05-23-add-bar');

    const result = await listRequestArtifacts({ projectRoot: project });

    expect(result).toHaveLength(3);
    expect(result.map((entry) => `${entry.sessionId}/${entry.role}/${entry.requestId}`).sort()).toEqual([
      'session-a/prd/2026-05-23-add-foo',
      'session-a/rd/2026-05-23-add-foo',
      'session-b/prd/2026-05-23-add-bar'
    ]);
    const rd = result.find((entry) => entry.role === 'rd');
    expect(rd?.state).toBe('spec-locked');
    expect(rd?.createdAt).toBe('2026-05-23T12:00:00.000Z');
  });

  test('filters by session id when provided', async () => {
    const project = await makeProject();
    await seedArtifact(project, 'prd', 'session-a', '2026-05-23-add-foo');
    await seedArtifact(project, 'prd', 'session-b', '2026-05-23-add-bar');

    const result = await listRequestArtifacts({ projectRoot: project, sessionId: 'session-a' });

    expect(result).toHaveLength(1);
    expect(result[0]?.sessionId).toBe('session-a');
  });

  test('filters by role when provided', async () => {
    const project = await makeProject();
    for (const role of ROLES) {
      await seedArtifact(project, role, 'session-a', '2026-05-23-add-foo');
    }

    const result = await listRequestArtifacts({ projectRoot: project, role: 'qa' });

    expect(result).toHaveLength(1);
    expect(result[0]?.role).toBe('qa');
  });

  test('ignores non-markdown files in the requests directory', async () => {
    const project = await makeProject();
    const dir = join(project, '.peaks', 'session-a', 'prd', 'requests');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'not-a-request.txt'), 'noise', 'utf8');
    await seedArtifact(project, 'prd', 'session-a', '2026-05-23-real');

    const result = await listRequestArtifacts({ projectRoot: project });

    expect(result.map((entry) => entry.requestId)).toEqual(['2026-05-23-real']);
  });

  test('skips sessions that have no per-role requests directory', async () => {
    const project = await makeProject();
    await mkdir(join(project, '.peaks', 'empty-session', 'prd'), { recursive: true });
    await seedArtifact(project, 'prd', 'real-session', '2026-05-23-real');

    const result = await listRequestArtifacts({ projectRoot: project });

    expect(result.map((entry) => entry.sessionId)).toEqual(['real-session']);
  });

  test('returns state=unknown when the markdown is missing a state line', async () => {
    const project = await makeProject();
    const dir = join(project, '.peaks', 'session-a', 'prd', 'requests');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, '2026-05-23-headless.md'), `# PRD Request 2026-05-23-headless\n\nNo status block.\n`, 'utf8');

    const result = await listRequestArtifacts({ projectRoot: project });

    expect(result[0]?.state).toBe('unknown');
    expect(result[0]?.createdAt).toBeUndefined();
  });
});

describe('showRequestArtifact', () => {
  test('returns null when the request does not exist', async () => {
    const project = await makeProject();

    const result = await showRequestArtifact({
      projectRoot: project,
      role: 'prd',
      requestId: '2026-05-23-missing'
    });

    expect(result).toBeNull();
  });

  test('returns null when sessionId is provided but the file is missing', async () => {
    const project = await makeProject();
    await seedArtifact(project, 'prd', 'session-a', '2026-05-23-existing');

    const result = await showRequestArtifact({
      projectRoot: project,
      role: 'prd',
      requestId: '2026-05-23-missing',
      sessionId: 'session-a'
    });

    expect(result).toBeNull();
  });

  test('returns null when scanning all sessions and none contains the request', async () => {
    const project = await makeProject();
    await seedArtifact(project, 'prd', 'session-a', '2026-05-23-other');
    await seedArtifact(project, 'prd', 'session-b', '2026-05-23-different');

    const result = await showRequestArtifact({
      projectRoot: project,
      role: 'prd',
      requestId: '2026-05-23-missing'
    });

    expect(result).toBeNull();
  });

  test('returns the artifact when sessionId is provided', async () => {
    const project = await makeProject();
    await seedArtifact(project, 'rd', 'session-a', '2026-05-23-add-foo', 'spec-locked');

    const result = await showRequestArtifact({
      projectRoot: project,
      role: 'rd',
      requestId: '2026-05-23-add-foo',
      sessionId: 'session-a'
    });

    expect(result).not.toBeNull();
    expect(result?.role).toBe('rd');
    expect(result?.sessionId).toBe('session-a');
    expect(result?.state).toBe('spec-locked');
    expect(result?.content).toMatch(/^# RD Request 2026-05-23-add-foo/m);
  });

  test('finds the artifact across sessions when sessionId is omitted', async () => {
    const project = await makeProject();
    await seedArtifact(project, 'qa', 'session-b', '2026-05-23-add-foo', 'verdict-issued');

    const result = await showRequestArtifact({
      projectRoot: project,
      role: 'qa',
      requestId: '2026-05-23-add-foo'
    });

    expect(result?.sessionId).toBe('session-b');
    expect(result?.state).toBe('verdict-issued');
  });

  test('rejects an invalid role before scanning the filesystem', async () => {
    const project = await makeProject();

    await expect(
      showRequestArtifact({ projectRoot: project, role: 'unknown' as RequestArtifactRole, requestId: '2026-05-23-x' })
    ).rejects.toThrowError(/role/i);
  });

  test('rejects an invalid request id before scanning the filesystem', async () => {
    const project = await makeProject();

    await expect(
      showRequestArtifact({ projectRoot: project, role: 'prd', requestId: '../escape' })
    ).rejects.toThrowError(/request id/i);
  });
});

describe('list + show round-trip with createRequestArtifact', () => {
  test('what create writes can be found by list and read back by show', async () => {
    const project = await makeProject();

    const created = await createRequestArtifact({
      role: 'prd',
      requestId: '2026-05-23-round-trip',
      projectRoot: project,
      sessionId: 'rt-session',
      apply: true,
      clock: () => '2026-05-23T12:00:00.000Z'
    });

    const listed = await listRequestArtifacts({ projectRoot: project });
    const shown = await showRequestArtifact({
      projectRoot: project,
      role: 'prd',
      requestId: '2026-05-23-round-trip'
    });

    expect(listed).toHaveLength(1);
    expect(listed[0]?.path).toBe(created.path);
    expect(shown?.content).toBe(created.content);
  });
});
