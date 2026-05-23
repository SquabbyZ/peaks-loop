import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  createRequestArtifact,
  transitionRequestArtifact,
  type RequestArtifactRole,
  type RequestArtifactState
} from '../../src/services/artifacts/request-artifact-service.js';

async function makeProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'peaks-request-transition-'));
}

const STABLE_SESSION = '2026-05-24-transition';
const STABLE_TIMESTAMP = '2026-05-24T08:00:00.000Z';
const LATER_TIMESTAMP = '2026-05-24T09:30:00.000Z';

async function seed(project: string, role: RequestArtifactRole, requestId: string): Promise<void> {
  await createRequestArtifact({
    role,
    requestId,
    projectRoot: project,
    sessionId: STABLE_SESSION,
    apply: true,
    clock: () => STABLE_TIMESTAMP
  });
}

describe('transitionRequestArtifact (valid state per role)', () => {
  test('moves a PRD artifact from draft to confirmed-by-user and updates last update', async () => {
    const project = await makeProject();
    await seed(project, 'prd', '2026-05-24-feature');

    const result = await transitionRequestArtifact({
      role: 'prd',
      requestId: '2026-05-24-feature',
      projectRoot: project,
      newState: 'confirmed-by-user',
      sessionId: STABLE_SESSION,
      clock: () => LATER_TIMESTAMP
    });

    expect(result?.previousState).toBe('draft');
    expect(result?.state).toBe('confirmed-by-user');
    const body = await readFile(result?.path ?? '', 'utf8');
    expect(body).toContain('- state: confirmed-by-user');
    expect(body).toContain(`- last update: ${LATER_TIMESTAMP}`);
    expect(body).not.toContain('- state: draft');
  });

  test('moves a UI artifact through direction-locked → handed-off', async () => {
    const project = await makeProject();
    await seed(project, 'ui', '2026-05-24-ux');

    const first = await transitionRequestArtifact({
      role: 'ui', requestId: '2026-05-24-ux', projectRoot: project,
      newState: 'direction-locked', sessionId: STABLE_SESSION,
      clock: () => LATER_TIMESTAMP
    });
    expect(first?.state).toBe('direction-locked');

    const second = await transitionRequestArtifact({
      role: 'ui', requestId: '2026-05-24-ux', projectRoot: project,
      newState: 'handed-off', sessionId: STABLE_SESSION,
      clock: () => LATER_TIMESTAMP
    });
    expect(second?.previousState).toBe('direction-locked');
    expect(second?.state).toBe('handed-off');
  });

  test('accepts every documented RD state', async () => {
    const project = await makeProject();
    await seed(project, 'rd', '2026-05-24-rd');
    const states: RequestArtifactState[] = ['spec-locked', 'implemented', 'qa-handoff', 'blocked'];

    for (const newState of states) {
      const result = await transitionRequestArtifact({
        role: 'rd', requestId: '2026-05-24-rd', projectRoot: project,
        newState, sessionId: STABLE_SESSION,
        clock: () => LATER_TIMESTAMP
      });
      expect.soft(result?.state, `RD should accept ${newState}`).toBe(newState);
    }
  });

  test('accepts every documented QA state', async () => {
    const project = await makeProject();
    await seed(project, 'qa', '2026-05-24-qa');
    const states: RequestArtifactState[] = ['running', 'verdict-issued', 'blocked'];

    for (const newState of states) {
      const result = await transitionRequestArtifact({
        role: 'qa', requestId: '2026-05-24-qa', projectRoot: project,
        newState, sessionId: STABLE_SESSION,
        clock: () => LATER_TIMESTAMP
      });
      expect.soft(result?.state, `QA should accept ${newState}`).toBe(newState);
    }
  });

  test('appends a transition note when reason is provided', async () => {
    const project = await makeProject();
    await seed(project, 'prd', '2026-05-24-with-reason');

    const result = await transitionRequestArtifact({
      role: 'prd', requestId: '2026-05-24-with-reason', projectRoot: project,
      newState: 'blocked', sessionId: STABLE_SESSION,
      reason: 'waiting on stakeholder confirmation',
      clock: () => LATER_TIMESTAMP
    });

    const body = await readFile(result?.path ?? '', 'utf8');
    expect(body).toContain('- transition note');
    expect(body).toContain('waiting on stakeholder confirmation');
  });
});

describe('transitionRequestArtifact (validation)', () => {
  test('rejects an unknown role', async () => {
    const project = await makeProject();

    await expect(
      transitionRequestArtifact({
        role: 'unknown' as RequestArtifactRole,
        requestId: '2026-05-24-x', projectRoot: project,
        newState: 'draft' as RequestArtifactState, sessionId: STABLE_SESSION
      })
    ).rejects.toThrowError(/role/i);
  });

  test('rejects an invalid request id', async () => {
    const project = await makeProject();

    await expect(
      transitionRequestArtifact({
        role: 'prd', requestId: '../escape', projectRoot: project,
        newState: 'draft', sessionId: STABLE_SESSION
      })
    ).rejects.toThrowError(/request id/i);
  });

  test('rejects a state that is not allowed for the role', async () => {
    const project = await makeProject();
    await seed(project, 'prd', '2026-05-24-wrong-state');

    await expect(
      transitionRequestArtifact({
        role: 'prd', requestId: '2026-05-24-wrong-state', projectRoot: project,
        newState: 'verdict-issued' as RequestArtifactState, sessionId: STABLE_SESSION
      })
    ).rejects.toThrowError(/state/i);
  });

  test('returns null when the artifact does not exist (sessionId provided)', async () => {
    const project = await makeProject();

    const result = await transitionRequestArtifact({
      role: 'prd', requestId: '2026-05-24-never', projectRoot: project,
      newState: 'confirmed-by-user', sessionId: STABLE_SESSION
    });

    expect(result).toBeNull();
  });

  test('returns null when the artifact does not exist (no sessionId)', async () => {
    const project = await makeProject();

    const result = await transitionRequestArtifact({
      role: 'prd', requestId: '2026-05-24-never', projectRoot: project,
      newState: 'confirmed-by-user'
    });

    expect(result).toBeNull();
  });

  test('finds the artifact across sessions when sessionId is omitted', async () => {
    const project = await makeProject();
    await seed(project, 'rd', '2026-05-24-cross-session');

    const result = await transitionRequestArtifact({
      role: 'rd', requestId: '2026-05-24-cross-session', projectRoot: project,
      newState: 'spec-locked',
      clock: () => LATER_TIMESTAMP
    });

    expect(result?.sessionId).toBe(STABLE_SESSION);
    expect(result?.state).toBe('spec-locked');
  });

  test('preserves the rest of the artifact body when updating state', async () => {
    const project = await makeProject();
    await seed(project, 'prd', '2026-05-24-preserve');
    // edit the body to add a custom line outside the Status block
    const path = join(project, '.peaks', STABLE_SESSION, 'prd', 'requests', '2026-05-24-preserve.md');
    const before = await readFile(path, 'utf8');
    await writeFile(path, before.replace('## Goals', '## Goals\n\n- custom goal line\n'), 'utf8');

    await transitionRequestArtifact({
      role: 'prd', requestId: '2026-05-24-preserve', projectRoot: project,
      newState: 'confirmed-by-user', sessionId: STABLE_SESSION,
      clock: () => LATER_TIMESTAMP
    });

    const after = await readFile(path, 'utf8');
    expect(after).toContain('- custom goal line');
  });

  test('handles artifacts that already have transition notes by appending a new one', async () => {
    const project = await makeProject();
    await seed(project, 'prd', '2026-05-24-multi-reason');

    await transitionRequestArtifact({
      role: 'prd', requestId: '2026-05-24-multi-reason', projectRoot: project,
      newState: 'blocked', sessionId: STABLE_SESSION,
      reason: 'first block', clock: () => LATER_TIMESTAMP
    });
    await transitionRequestArtifact({
      role: 'prd', requestId: '2026-05-24-multi-reason', projectRoot: project,
      newState: 'confirmed-by-user', sessionId: STABLE_SESSION,
      reason: 'unblocked', clock: () => LATER_TIMESTAMP
    });

    const path = join(project, '.peaks', STABLE_SESSION, 'prd', 'requests', '2026-05-24-multi-reason.md');
    const body = await readFile(path, 'utf8');
    expect(body).toContain('first block');
    expect(body).toContain('unblocked');
  });

  test('returns previousState=unknown when the artifact has no state line', async () => {
    const project = await makeProject();
    const dir = join(project, '.peaks', STABLE_SESSION, 'prd', 'requests');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, '2026-05-24-no-state.md'), `# PRD Request 2026-05-24-no-state\n\nNo status block.\n`, 'utf8');

    const result = await transitionRequestArtifact({
      role: 'prd', requestId: '2026-05-24-no-state', projectRoot: project,
      newState: 'confirmed-by-user', sessionId: STABLE_SESSION,
      clock: () => LATER_TIMESTAMP
    });

    expect(result?.previousState).toBe('unknown');
    expect(result?.state).toBe('confirmed-by-user');
    const body = await readFile(result?.path ?? '', 'utf8');
    expect(body).toContain('- state: confirmed-by-user');
  });

  test('inserts a last update line when the artifact has state but no last update line', async () => {
    const project = await makeProject();
    const dir = join(project, '.peaks', STABLE_SESSION, 'prd', 'requests');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, '2026-05-24-state-only.md'), `# PRD Request 2026-05-24-state-only\n\n## Status\n\n- state: draft\n`, 'utf8');

    const result = await transitionRequestArtifact({
      role: 'prd', requestId: '2026-05-24-state-only', projectRoot: project,
      newState: 'confirmed-by-user', sessionId: STABLE_SESSION,
      clock: () => LATER_TIMESTAMP
    });

    const body = await readFile(result?.path ?? '', 'utf8');
    expect(body).toContain(`- last update: ${LATER_TIMESTAMP}`);
    expect(body).toContain('- state: confirmed-by-user');
  });

  test('defaults the clock to the wall clock when not provided', async () => {
    const project = await makeProject();
    await seed(project, 'rd', '2026-05-24-default-clock');

    const result = await transitionRequestArtifact({
      role: 'rd', requestId: '2026-05-24-default-clock', projectRoot: project,
      newState: 'spec-locked', sessionId: STABLE_SESSION
    });

    expect(result?.state).toBe('spec-locked');
    expect(result?.createdAt).toBeDefined();
  });
});
