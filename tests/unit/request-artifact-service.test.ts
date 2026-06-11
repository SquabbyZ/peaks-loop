import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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
      expect(result.path).toMatch(/001-2026-05-23-add-foo\.md$/);
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

    expect(result.sessionId).toMatch(/^\d{4}-\d{2}-\d{2}-session-/);
    // As of slice 2026-06-05-change-id-as-unit-of-work, the artifact
    // path is the change-id dir (which defaults to the requestId when
    // no binding is set), not the session dir.
    expect(result.path).toContain('2026-05-23-default-session');
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
    // As of slice 006, the target dir is the session dir
    // (`.peaks/_runtime/<sid>/<role>/requests/`), NOT the change-id dir.
    const dir = join(project, '.peaks', '_runtime', STABLE_SESSION, 'prd', 'requests');
    await mkdir(dir, { recursive: true });
    // Create file with the new numbered format
    await writeFile(join(dir, '001-2026-05-23-add-foo.md'), 'existing', 'utf8');

    await expect(
      createRequestArtifact({ ...commonOptions('prd', project), apply: true })
    ).rejects.toThrowError(/already exists/i);

    const preserved = await readFile(join(dir, '001-2026-05-23-add-foo.md'), 'utf8');
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

import { readdir } from 'node:fs/promises';
import { transitionRequestArtifact, LintGateError } from '../../src/services/artifacts/request-artifact-service.js';

describe('transitionRequestArtifact lint gate', () => {
  const STABLE_SESSION = '2026-05-23-stable-session';
  const STABLE_TIMESTAMP = '2026-05-23T12:00:00.000Z';

  test('throws LintGateError when artifact has placeholder text', async () => {
    const project = await makeProject();
    await createRequestArtifact({
      role: 'rd', requestId: 'lint-001', projectRoot: project,
      sessionId: STABLE_SESSION,
      clock: () => STABLE_TIMESTAMP,
      apply: true
    });
    // Overwrite with placeholder-ridden content
    // As of slice 006, the artifact lives under the session dir
    // (`.peaks/_runtime/<sid>/rd/requests/`).
    const rdDir = join(project, '.peaks', '_runtime', STABLE_SESSION, 'rd', 'requests');
    const files = await readdir(rdDir);
    const artifactPath = join(rdDir, files[0]!);
    await writeFile(artifactPath, '# RD Request\n- state: draft\n- type: feature\n\n## Red-line scope\n- ...\n\n## Implementation evidence\n- <placeholder>\n', 'utf8');
    // rd → spec-locked requires the tech-doc presence enforcer to pass.
    // Read the artifact to learn the actual sessionId it was stored
    // under (it may have been rebound), then place a non-empty
    // tech-doc at that path so the lint gate (not the prerequisite
    // gate) is the one that fires.
    const stored = await showRequestArtifact({ projectRoot: project, role: 'rd', requestId: 'lint-001' });
    const effectiveSessionId = stored?.sessionId ?? STABLE_SESSION;
    const techDocPath = join(project, '.peaks', '_runtime', effectiveSessionId, 'rd', 'tech-doc.md');
    await mkdir(dirname(techDocPath), { recursive: true });
    await writeFile(techDocPath, '# Tech doc\n\n## Red-line scope\n\n- none\n\n## Implementation evidence\n\n- the lint gate is the one we are testing, not the prereq gate\n', 'utf8');

    await expect(
      transitionRequestArtifact({
        role: 'rd', requestId: 'lint-001', projectRoot: project,
        sessionId: STABLE_SESSION,
        newState: 'spec-locked', confirmed: true
      })
    ).rejects.toThrow(LintGateError);
  });
});

describe('createRequestArtifact QA marker', () => {
  test('creates .initiated marker in qa directory when role is qa and apply=true', async () => {
    const project = await makeProject();
    await createRequestArtifact({
      ...commonOptions('qa', project),
      apply: true
    });
    const { existsSync } = await import('node:fs');
    // Slice 006: marker is under the session dir, not the change-id dir.
    const markerPath = join(project, '.peaks', '_runtime', STABLE_SESSION, 'qa', '.initiated');
    expect(existsSync(markerPath)).toBe(true);
  });

  test('does not create .initiated marker for non-qa roles', async () => {
    const project = await makeProject();
    await createRequestArtifact({
      ...commonOptions('prd', project),
      apply: true
    });
    const { existsSync } = await import('node:fs');
    const markerPath = join(project, '.peaks', '_runtime', STABLE_SESSION, 'qa', '.initiated');
    expect(existsSync(markerPath)).toBe(false);
  });
});

import { listRequestArtifacts, showRequestArtifact, allowedStatesForRole } from '../../src/services/artifacts/request-artifact-service.js';
import { PrerequisitesNotSatisfiedError } from '../../src/services/artifacts/request-artifact-service.js';

describe('listRequestArtifacts', () => {
  test('returns empty array when no .peaks directory', async () => {
    const project = await makeProject();
    const result = await listRequestArtifacts({ projectRoot: project });
    expect(result).toEqual([]);
  });

  test('lists created artifacts', async () => {
    const project = await makeProject();
    await createRequestArtifact({ ...commonOptions('prd', project, 'list-test'), apply: true });
    const result = await listRequestArtifacts({ projectRoot: project });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.some((r) => r.requestId === 'list-test')).toBe(true);
  });

  test('filters by role', async () => {
    const project = await makeProject();
    await createRequestArtifact({ ...commonOptions('prd', project, 'role-filter'), apply: true });
    await createRequestArtifact({ ...commonOptions('rd', project, 'role-filter-rd'), apply: true });
    const result = await listRequestArtifacts({ projectRoot: project, role: 'rd' });
    expect(result.every((r) => r.role === 'rd')).toBe(true);
  });

  test('filters by sessionId (scope dir)', async () => {
    // As of slice 006, `sessionId` is the scope dir name (canonical
    // post-F3 home). The file is at `.peaks/_runtime/<sid>/<role>/requests/`.
    // The summary's `sessionId` is read from the body (`- session: ${sessionId}` metadata), not the path.
    const project = await makeProject();
    await createRequestArtifact({ ...commonOptions('prd', project, 'session-filter'), apply: true });
    const result = await listRequestArtifacts({ projectRoot: project, sessionId: STABLE_SESSION });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every((r) => r.sessionId === STABLE_SESSION)).toBe(true);
  });
});

describe('showRequestArtifact', () => {
  test('returns null when artifact not found', async () => {
    const project = await makeProject();
    const result = await showRequestArtifact({
      projectRoot: project, role: 'prd', requestId: 'nonexistent'
    });
    expect(result).toBeNull();
  });

  test('returns artifact with content', async () => {
    const project = await makeProject();
    await createRequestArtifact({ ...commonOptions('prd', project, 'show-test'), apply: true });
    // Slice 006: pass the session id (the canonical scope dir), not
    // the request id. The show function reads from `_runtime/<sid>/`.
    const result = await showRequestArtifact({
      projectRoot: project, role: 'prd', requestId: 'show-test', sessionId: STABLE_SESSION
    });
    expect(result).not.toBeNull();
    expect(result!.requestId).toBe('show-test');
    expect(result!.content).toContain('show-test');
  });

  test('throws on invalid role', async () => {
    const project = await makeProject();
    await expect(
      showRequestArtifact({ projectRoot: project, role: 'unknown' as any, requestId: 'x' })
    ).rejects.toThrowError(/role/i);
  });

  test('throws on invalid requestId', async () => {
    const project = await makeProject();
    await expect(
      showRequestArtifact({ projectRoot: project, role: 'prd', requestId: '../escape' })
    ).rejects.toThrowError(/request id/i);
  });

  test('finds artifact without sessionId by scanning all sessions', async () => {
    const project = await makeProject();
    await createRequestArtifact({ ...commonOptions('prd', project, 'scan-all'), apply: true });
    const result = await showRequestArtifact({
      projectRoot: project, role: 'prd', requestId: 'scan-all'
    });
    expect(result).not.toBeNull();
    expect(result!.requestId).toBe('scan-all');
  });

  /**
   * Slice 003 repair cycle 1: showRequestArtifact must read from the
   * canonical post-F3 path `.peaks/_runtime/<sid>/<role>/requests/`
   * first, and fall back to the legacy pre-F3 path
   * `.peaks/<sid>/<role>/requests/` when the canonical path is absent.
   * The pre-F3 read silently pointed at the legacy path and missed
   * every in-flight session that was created after
   * `peaks workspace migrate --to-runtime`. After the fix, the
   * prerequisite gate's "request artifact present" check observes
   * the same path the rest of the canonical layout uses.
   */
  test('finds artifact at the canonical post-F3 path .peaks/_runtime/<sid>/<role>/requests/', async () => {
    const project = await makeProject();
    const sid = '2026-06-06-runtime-canonical';
    const rid = '2026-06-06-runtime-canonical-rid';
    // Write directly at the canonical post-F3 path.
    const canonicalDir = join(project, '.peaks', '_runtime', sid, 'rd', 'requests');
    await mkdir(canonicalDir, { recursive: true });
    const body = [
      '# RD Request ' + rid,
      '',
      '- session: ' + sid,
      '- change-id: ' + rid,
      '- type: refactor',
      '- state: draft',
      '',
      '## Red-line scope',
      '- in scope: ...',
      '',
      '## Status',
      '- created: 2026-06-06T00:00:00.000Z',
      '- last update: 2026-06-06T00:00:00.000Z',
      '- state: draft',
      ''
    ].join('\n');
    await writeFile(join(canonicalDir, `${rid}.md`), body, 'utf8');

    const result = await showRequestArtifact({
      projectRoot: project, role: 'rd', requestId: rid, sessionId: sid
    });
    expect(result).not.toBeNull();
    expect(result!.requestId).toBe(rid);
    expect(result!.content).toContain('## Red-line scope');
  });

  test('falls back to the legacy pre-F3 path .peaks/<sid>/<role>/requests/ when canonical path is absent', async () => {
    const project = await makeProject();
    const sid = '2026-06-06-legacy-fallback-sid';
    const rid = '2026-06-06-legacy-fallback-rid';
    // Write ONLY at the legacy pre-F3 path (the canonical _runtime/<sid>/
    // dir does NOT exist on disk).
    const legacyDir = join(project, '.peaks', sid, 'rd', 'requests');
    await mkdir(legacyDir, { recursive: true });
    const body = [
      '# RD Request ' + rid,
      '',
      '- session: ' + sid,
      '- change-id: ' + rid,
      '- type: refactor',
      '- state: draft',
      '',
      '## Red-line scope',
      '- in scope: ...',
      '',
      '## Status',
      '- created: 2026-06-06T00:00:00.000Z',
      '- last update: 2026-06-06T00:00:00.000Z',
      '- state: draft',
      ''
    ].join('\n');
    await writeFile(join(legacyDir, `${rid}.md`), body, 'utf8');

    const result = await showRequestArtifact({
      projectRoot: project, role: 'rd', requestId: rid, sessionId: sid
    });
    expect(result).not.toBeNull();
    expect(result!.requestId).toBe(rid);
    expect(result!.content).toContain('## Red-line scope');
  });

  test('prefers the canonical post-F3 path when both canonical and legacy exist', async () => {
    const project = await makeProject();
    const sid = '2026-06-06-canonical-wins';
    const ridCanonical = '2026-06-06-canonical-rid';
    const ridLegacy = '2026-06-06-legacy-rid';
    // Both paths exist with different content; the canonical read wins.
    const canonicalDir = join(project, '.peaks', '_runtime', sid, 'rd', 'requests');
    const legacyDir = join(project, '.peaks', sid, 'rd', 'requests');
    await mkdir(canonicalDir, { recursive: true });
    await mkdir(legacyDir, { recursive: true });
    const canonicalBody = '# RD Request CANONICAL\n- state: draft\n- type: refactor\n';
    const legacyBody = '# RD Request LEGACY\n- state: draft\n- type: refactor\n';
    await writeFile(join(canonicalDir, `${ridCanonical}.md`), canonicalBody, 'utf8');
    await writeFile(join(legacyDir, `${ridCanonical}.md`), legacyBody, 'utf8');
    // Sanity: the legacy-only rid should NOT be picked up when looking for ridCanonical.
    await writeFile(join(legacyDir, `${ridLegacy}.md`), legacyBody, 'utf8');

    const result = await showRequestArtifact({
      projectRoot: project, role: 'rd', requestId: ridCanonical, sessionId: sid
    });
    expect(result).not.toBeNull();
    expect(result!.content).toContain('CANONICAL');
    expect(result!.content).not.toContain('LEGACY');
  });
});

describe('allowedStatesForRole', () => {
  test('returns allowed states for each role', () => {
    expect(allowedStatesForRole('prd')).toContain('draft');
    expect(allowedStatesForRole('prd')).toContain('confirmed-by-user');
    expect(allowedStatesForRole('rd')).toContain('implemented');
    expect(allowedStatesForRole('rd')).toContain('qa-handoff');
    expect(allowedStatesForRole('qa')).toContain('verdict-issued');
    expect(allowedStatesForRole('sc')).toContain('impact-recorded');
  });
});

describe('transitionRequestArtifact validation', () => {
  test('rejects invalid role', async () => {
    const project = await makeProject();
    await expect(
      transitionRequestArtifact({
        role: 'unknown' as any, requestId: 'x', projectRoot: project, newState: 'draft'
      })
    ).rejects.toThrowError(/role/i);
  });

  test('rejects invalid requestId', async () => {
    const project = await makeProject();
    await expect(
      transitionRequestArtifact({
        role: 'prd', requestId: '../escape', projectRoot: project, newState: 'draft'
      })
    ).rejects.toThrowError(/request id/i);
  });

  test('rejects invalid state for role', async () => {
    const project = await makeProject();
    await expect(
      transitionRequestArtifact({
        role: 'prd', requestId: 'test-x', projectRoot: project, newState: 'implemented' as any
      })
    ).rejects.toThrowError(/state for role/i);
  });

  test('returns null when artifact not found', async () => {
    const project = await makeProject();
    const result = await transitionRequestArtifact({
      role: 'prd', requestId: 'no-such', projectRoot: project, newState: 'confirmed-by-user',
      confirmed: true
    });
    expect(result).toBeNull();
  });

  test('successfully transitions prd from draft to confirmed-by-user with allowIncomplete', async () => {
    const project = await makeProject();
    await createRequestArtifact({ ...commonOptions('prd', project, 'trans-prd-ok'), apply: true });
    const result = await transitionRequestArtifact({
      role: 'prd', requestId: 'trans-prd-ok', projectRoot: project,
      newState: 'confirmed-by-user',
      confirmed: true, allowIncomplete: true
    });
    expect(result).not.toBeNull();
    expect(result!.state).toBe('confirmed-by-user');
    expect(result!.previousState).toBe('draft');
  });

  test('throws prerequisites error when missing artifacts and no allowIncomplete', async () => {
    const project = await makeProject();
    await createRequestArtifact({ ...commonOptions('qa', project, 'prereq-test'), apply: true });
    await expect(
      transitionRequestArtifact({
        role: 'qa', requestId: 'prereq-test', projectRoot: project,
        newState: 'running', confirmed: true
      })
    ).rejects.toThrow(PrerequisitesNotSatisfiedError);
  });

  test('transitions rd from draft to spec-locked with allowIncomplete (prereqs ok)', async () => {
    const project = await makeProject();
    await createRequestArtifact({ ...commonOptions('rd', project, 'trans-rd-inc'), apply: true });
    const result = await transitionRequestArtifact({
      role: 'rd', requestId: 'trans-rd-inc', projectRoot: project,
      newState: 'spec-locked',
      confirmed: true, allowIncomplete: true
    });
    expect(result).not.toBeNull();
    expect(result!.state).toBe('spec-locked');
  });

  test('transitions qa from draft to running with allowIncomplete and bypassed prerequisites', async () => {
    const project = await makeProject();
    await createRequestArtifact({ ...commonOptions('qa', project, 'qa-bypass'), apply: true });
    const result = await transitionRequestArtifact({
      role: 'qa', requestId: 'qa-bypass', projectRoot: project,
      newState: 'running',
      confirmed: true, allowIncomplete: true
    });
    expect(result).not.toBeNull();
    expect(result!.state).toBe('running');
    expect(result!.bypassedPrerequisites).toBeDefined();
  });
});

