// tests/unit/skills/presence-set-fail-closed.test.ts
//
// CONTRACT TEST — `peaks skill presence:set` FAILS CLOSED when the canonical
// presence write cannot land.
//
// THE DEFECT (QA-015 F1, MAJOR / blocking). The canonical lease write ran
// inside a non-awaited `void (async () => { ... catch {} })()` in
// `skill-presence-service.ts`. A graph that could not be built was swallowed
// by that empty catch, the command reported `ok: true` with exit 0, and
// NOTHING was written — 0 leases, 0 graphs, 0 stray tmp/lock files. The
// operator was told the skill was active when no lease existed.
//
// THE FIX. The write is awaited and its failure ESCAPES; the CLI turns it
// into a fail-closed envelope carrying a named error code and a non-zero
// exit code.
//
// Dimensions covered:
//   - behavior:    the write failure REJECTS (it is not swallowed) and leaves
//                  no half lease / half graph behind
//   - integration: a real temp project, a real filesystem, the real command
//   - render:      the JSON envelope the command prints on stdout
//   - a11y:        the operator-facing surface — the error code, the readable
//                  message, and the exit code

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';
import { setSkillPresence } from '../../../src/services/skills/skill-presence-service.js';
import { runSkillPresenceSet } from '../../../src/cli/commands/core/skill-presence-set-command.js';

declareDimensions('tests/unit/skills/presence-set-fail-closed.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

const SESSION_ID = 'session-presence-fail-closed';
const CALLER_ID = 'caller-presence-fail-closed';
const SKILL = 'peaks-code';
const WORKFLOW_ID = `wf-${CALLER_ID}-compat`;

const projects: string[] = [];

afterEach(() => {
  for (const project of projects.splice(0)) rmSync(project, { recursive: true, force: true });
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-presence-fail-closed-'));
  projects.push(root);
  return root;
}

/** Write the project-global binding the way `peaks workspace init` does. */
function bindSession(root: string): void {
  const runtimeDir = join(root, '.peaks', '_runtime');
  mkdirSync(join(runtimeDir, SESSION_ID), { recursive: true });
  writeFileSync(
    join(runtimeDir, 'session.json'),
    JSON.stringify(
      { sessionId: SESSION_ID, createdAt: '2026-10-24T00:00:00.000Z', projectRoot: root },
      null,
      2
    ),
    'utf8'
  );
}

/**
 * Block the graph path with a REGULAR FILE, so the graph cannot be created.
 * This is the fixture QA-015 used: the graph write fails, and the failure is
 * the thing under test.
 */
function blockGraphPath(root: string): void {
  const sessionDir = join(root, '.peaks', '_runtime', SESSION_ID);
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, 'graphs'), 'not-a-directory', 'utf8');
}

/** Every file under `.peaks/_runtime`, as project-relative paths. */
function runtimeFiles(root: string): string[] {
  const runtime = join(root, '.peaks', '_runtime');
  if (!existsSync(runtime)) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(full.slice(root.length + 1));
    }
  };
  walk(runtime);
  return out;
}

function segments(path: string): string[] {
  return path.split(/[\\/]/);
}

function leaseFiles(root: string): string[] {
  return runtimeFiles(root).filter(
    (file) => segments(file).includes('leases') && file.endsWith('.json')
  );
}

function graphFiles(root: string): string[] {
  return runtimeFiles(root).filter(
    (file) => segments(file).includes('graphs') && file.endsWith('.json')
  );
}

function strayWriteArtifacts(root: string): string[] {
  return runtimeFiles(root).filter((file) => file.includes('.tmp-') || file.endsWith('.lock'));
}

/** Drive the registered command's action and capture what it printed. */
async function runPresenceSet(
  root: string,
  options: Record<string, unknown> = {}
): Promise<{ stdout: string; exitCode: number }> {
  const { io, captured } = makeCapturedIo();
  const previousExitCode = process.exitCode;
  process.exitCode = 0;
  try {
    await runSkillPresenceSet(
      SKILL,
      { project: root, json: true, callerId: CALLER_ID, ...options },
      io
    );
    return {
      stdout: captured.text(),
      exitCode: typeof process.exitCode === 'number' ? process.exitCode : 0
    };
  } finally {
    process.exitCode = previousExitCode;
  }
}

describe('Scenario: behavior — the canonical write failure is not swallowed', () => {
  it('when invoked, should TC-PSF-01: a graph that cannot be built REJECTS the write instead of being swallowed. Pass criterion: the awaited call rejects, the message names the graph path, and no lease, no graph and no stray tmp/lock file is left behind.', async () => {
    // given: a temp project with a bound session and a regular-file `graphs` path
    // when: the canonical presence write for the skill is awaited
    // then: the call rejects, the message names the graphs path, nothing is left behind
    const root = project();
    bindSession(root);
    blockGraphPath(root);

    let rejected = false;
    let message = '';
    try {
      await setSkillPresence(SKILL, '24h', 'D', {
        projectRootOverride: root,
        callerIdOverride: CALLER_ID
      });
    } catch (error: unknown) {
      rejected = true;
      message = error instanceof Error ? error.message : String(error);
    }

    expect(rejected).toBe(true);
    expect(message).toContain('graphs');
    expect(leaseFiles(root)).toHaveLength(0);
    expect(graphFiles(root)).toHaveLength(0);
    expect(strayWriteArtifacts(root)).toHaveLength(0);
  });
});

describe('Scenario: render — the envelope the command prints', () => {
  it('when invoked, should TC-PSF-02: the failed write prints a FAIL envelope with a named code. Pass criterion: envelope.ok === false and envelope.code === "PEAKS_GRAPH_WRITE_FAILED".', async () => {
    // given: a temp project with a bound session and a regular-file `graphs` path
    // when: the `skill.presence:set` command runs against that project
    // then: the envelope reports ok === false and the code PEAKS_GRAPH_WRITE_FAILED
    const root = project();
    bindSession(root);
    blockGraphPath(root);

    const result = await runPresenceSet(root);

    const envelope = JSON.parse(result.stdout) as {
      ok: boolean;
      command: string;
      code: string;
      message: string;
    };
    expect(envelope.ok).toBe(false);
    expect(envelope.command).toBe('skill.presence:set');
    expect(envelope.code).toBe('PEAKS_GRAPH_WRITE_FAILED');
  });
});

describe('Scenario: a11y — the operator can tell the failures apart', () => {
  it('when invoked, should TC-PSF-03: the write failure exits non-zero with a message that says the graph/lease write failed. Pass criterion: the exit code is 1 and the message names the canonical presence lease write.', async () => {
    // given: a temp project with a bound session and a regular-file `graphs` path
    // when: the `skill.presence:set` command runs against that project
    // then: the exit code is 1 and the message names the presence lease and the graph
    const root = project();
    bindSession(root);
    blockGraphPath(root);

    const result = await runPresenceSet(root);

    const envelope = JSON.parse(result.stdout) as { message: string };
    expect(result.exitCode).toBe(1);
    expect(envelope.message).toContain('presence lease');
    expect(envelope.message).toContain('graph');
  });

  it('when invoked, should TC-PSF-04: the write failure is distinguishable from the "no bound session" refusal. Pass criterion: the write failure carries PEAKS_GRAPH_WRITE_FAILED and the unbound project carries PEAKS_SESSION_NOT_BOUND.', async () => {
    // given: two temp projects, one bound with a regular-file `graphs` path, one unbound
    // when: the `skill.presence:set` command runs against both projects
    // then: the refusals differ, PEAKS_GRAPH_WRITE_FAILED against PEAKS_SESSION_NOT_BOUND
    const writeFailureRoot = project();
    bindSession(writeFailureRoot);
    blockGraphPath(writeFailureRoot);
    const unboundRoot = project();

    const writeFailure = await runPresenceSet(writeFailureRoot);
    const unbound = await runPresenceSet(unboundRoot);

    const writeCode = (JSON.parse(writeFailure.stdout) as { code: string }).code;
    const unboundCode = (JSON.parse(unbound.stdout) as { code: string }).code;
    expect(writeCode).toBe('PEAKS_GRAPH_WRITE_FAILED');
    expect(unboundCode).toBe('PEAKS_SESSION_NOT_BOUND');
    expect(writeCode).not.toBe(unboundCode);
  });
});

describe('Scenario: integration — the success path is unchanged', () => {
  it('when invoked, should TC-PSF-05: a clean project still gets exactly one lease and one graph, and the command reports success. Pass criterion: envelope.ok === true, the exit code is 0, one lease file and one graph file are on disk.', async () => {
    // given: a temp project with a bound session and an unblocked `graphs` path
    // when: the `skill.presence:set` command runs against that project
    // then: the envelope reports ok === true, the exit code is 0, one lease and one graph exist
    const root = project();
    bindSession(root);

    const result = await runPresenceSet(root);

    const envelope = JSON.parse(result.stdout) as { ok: boolean };
    expect(envelope.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(leaseFiles(root)).toHaveLength(1);
    expect(graphFiles(root)).toHaveLength(1);
    expect(strayWriteArtifacts(root)).toHaveLength(0);
    const graphPath = join(root, '.peaks', '_runtime', SESSION_ID, 'graphs', `${WORKFLOW_ID}.json`);
    expect(existsSync(graphPath)).toBe(true);
  });
});
