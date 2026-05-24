import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { pathExists } from '../../src/shared/fs.js';
import { createRequestArtifact, type RequestArtifactRole } from '../../src/services/artifacts/request-artifact-service.js';

async function makeProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'peaks-request-artifact-'));
}

const STABLE_SESSION = '2026-05-23-stable-session';
const STABLE_TIMESTAMP = '2026-05-23T12:00:00.000Z';

function commonOptions(role: RequestArtifactRole, projectRoot: string, requestId = '2026-05-23-add-foo') {
  return {
    role,
    requestId,
    projectRoot,
    sessionId: STABLE_SESSION,
    clock: () => STABLE_TIMESTAMP
  };
}

const ROLES: RequestArtifactRole[] = ['prd', 'ui', 'rd', 'qa', 'sc'];

describe('createRequestArtifact (preview)', () => {
  test('returns preview content without writing for every role', async () => {
    const project = await makeProject();

    for (const role of ROLES) {
      const result = await createRequestArtifact(commonOptions(role, project));

      expect(result.role).toBe(role);
      expect(result.applied).toBe(false);
      expect(result.path).toBe(join(project, '.peaks', STABLE_SESSION, role, 'requests', '2026-05-23-add-foo.md'));
      expect(result.content).toMatch(new RegExp(`^# ${role.toUpperCase()} Request 2026-05-23-add-foo`, 'm'));
      expect(result.content).toMatch(/## Status/);
      expect(await pathExists(result.path)).toBe(false);
    }
  });

  test('rejects an invalid request id before touching the filesystem', async () => {
    const project = await makeProject();

    await expect(
      createRequestArtifact({ ...commonOptions('prd', project), requestId: '../escape' })
    ).rejects.toThrowError(/request id/i);
  });

  test('rejects an unknown role', async () => {
    const project = await makeProject();

    await expect(
      createRequestArtifact({ ...commonOptions('prd', project), role: 'unknown' as RequestArtifactRole })
    ).rejects.toThrowError(/role/i);
  });

  test('defaults the session id to a date-stamped value when omitted', async () => {
    const project = await makeProject();

    const result = await createRequestArtifact({
      role: 'prd',
      requestId: '2026-05-23-default-session',
      projectRoot: project,
      clock: () => STABLE_TIMESTAMP
    });

    expect(result.sessionId).toMatch(/^2026-05-23/);
    expect(result.path).toContain(result.sessionId);
  });

  test('writes a real ISO timestamp into the artifact body when no clock is injected', async () => {
    const project = await makeProject();

    const result = await createRequestArtifact({
      role: 'prd',
      requestId: '2026-05-23-default-clock',
      projectRoot: project
    });

    expect(result.content).toMatch(/created: \d{4}-\d{2}-\d{2}T/);
  });
});

describe('createRequestArtifact (apply)', () => {
  test('writes the artifact for every role when apply is true', async () => {
    const project = await makeProject();

    for (const role of ROLES) {
      const result = await createRequestArtifact({ ...commonOptions(role, project), apply: true });

      expect(result.applied).toBe(true);
      const written = await readFile(result.path, 'utf8');
      expect(written).toBe(result.content);
    }
  });

  test('refuses to overwrite an existing artifact at the target path', async () => {
    const project = await makeProject();
    const dir = join(project, '.peaks', STABLE_SESSION, 'prd', 'requests');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, '2026-05-23-add-foo.md'), 'existing', 'utf8');

    await expect(
      createRequestArtifact({ ...commonOptions('prd', project), apply: true })
    ).rejects.toThrowError(/exists/i);

    const preserved = await readFile(join(dir, '2026-05-23-add-foo.md'), 'utf8');
    expect(preserved).toBe('existing');
  });

  test('embeds the user-provided session id and clock timestamp in the artifact body', async () => {
    const project = await makeProject();

    const result = await createRequestArtifact({ ...commonOptions('rd', project), apply: true });

    expect(result.content).toContain(STABLE_TIMESTAMP);
    expect(result.content).toContain(STABLE_SESSION);
  });
});

describe('role-specific template content', () => {
  test('prd template documents acceptance criteria and frontend delta hints', async () => {
    const project = await makeProject();
    const result = await createRequestArtifact(commonOptions('prd', project));

    expect(result.content).toMatch(/## Goals/);
    expect(result.content).toMatch(/## Non-goals/);
    expect(result.content).toMatch(/## Acceptance criteria/);
    expect(result.content).toMatch(/## Frontend delta/);
  });

  test('ui template documents affected surfaces and visual constraints', async () => {
    const project = await makeProject();
    const result = await createRequestArtifact(commonOptions('ui', project));

    expect(result.content).toMatch(/## Affected surfaces/);
    expect(result.content).toMatch(/## Visual constraints/);
    expect(result.content).toMatch(/## UI regression seeds/);
  });

  test('rd template documents red-line scope and coverage status', async () => {
    const project = await makeProject();
    const result = await createRequestArtifact(commonOptions('rd', project));

    expect(result.content).toMatch(/## Red-line scope/);
    expect(result.content).toMatch(/## Coverage status/);
    expect(result.content).toMatch(/## Slice contract/);
  });

  test('qa template documents acceptance results and validation gates', async () => {
    const project = await makeProject();
    const result = await createRequestArtifact(commonOptions('qa', project));

    expect(result.content).toMatch(/## Red-line boundary check/);
    expect(result.content).toMatch(/## Acceptance checks/);
    expect(result.content).toMatch(/## Mandatory validation gates/);
    expect(result.content).toMatch(/## Verdict/);
  });

  test('sc template documents commit boundaries, artifact retention, and sync authorization', async () => {
    const project = await makeProject();
    const result = await createRequestArtifact(commonOptions('sc', project));

    expect(result.content).toMatch(/## Change impact/);
    expect(result.content).toMatch(/## Commit boundaries/);
    expect(result.content).toMatch(/## Artifact retention/);
    expect(result.content).toMatch(/## Sync \/ authorization/);
    expect(result.content).toMatch(/## Rollback points/);
  });
});
