// tests/unit/cli/job-session-addressing.test.ts
//
// D6 (findings-job-loop-defects.md): `peaks job` was addressable only while the
// single per-project `.peaks/_runtime/session.json` binding happened to point at
// the session that owns the job. Two sessions sharing one repo fight over that
// slot, and a job in the other session became unreadable.
//
// Fix under test: every job subcommand declares `--session-id`, and
// `resolveJobStateRoot` honours flag → PEAKS_SESSION_ID → binding → error (the
// same precedence `peaks sub-agent dispatch` / `peaks web *` already use). A job
// missing from the resolved session is reported by name of the session that
// holds it instead of a bare "no state for <job> at <other-sid>".
//
// Dimensions covered:
//   - render:      the option surface (every subcommand declares --session-id)
//                  and the ok-envelope shape of a status read
//   - behavior:    resolution precedence (flag > PEAKS_SESSION_ID > binding)
//   - integration: real-fs reads AND writes land in the --session-id session
//                  while the project binding points elsewhere
//   - a11y:        structured error envelopes when the job/session cannot be
//                  resolved (JOB_NOT_IN_SESSION names both sessions;
//                  NO_ACTIVE_SESSION instead of a guessed session)
//
// Run with: pnpm vitest run tests/unit/cli/job-session-addressing.test.ts

import { Command } from 'commander';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo, withEnv } from '../_setup/io.js';
import {
  cleanupTmpWorkspace,
  useTmpWorkspace,
  type TmpWorkspace,
} from '../_setup/tmp-workspace.js';

declareDimensions('tests/unit/cli/job-session-addressing.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y',
]);

import { registerJobCommands } from '../../../src/cli/commands/job-commands.js';

const JOB_SID = '2026-09-10-session-d6-job';
const OTHER_SID = '2026-09-10-session-d6-other';

const SUBCOMMANDS_THAT_RESOLVE_A_JOB_ROOT = [
  'init',
  'status',
  'rotate-now',
  'subagent-cleanup',
  'checkpoint',
  'block',
  'continue',
  'resume',
  'progress',
  'handoff',
  'karpathy-cost-check',
];

type CapturedIo = ReturnType<typeof makeCapturedIo>['captured'];

function jobCommand(): Command {
  const { io } = makeCapturedIo();
  const program = new Command();
  registerJobCommands(program, io);
  return program.commands.find((c) => c.name() === 'job')!;
}

async function runJob(args: string[], wsPath: string): Promise<CapturedIo> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  registerJobCommands(program, io);
  await program.parseAsync(['job', ...args, '--project', wsPath, '--json'], { from: 'user' });
  return captured;
}

function parseJson(captured: CapturedIo): { ok: boolean; code?: string; message?: string; data: any } {
  return JSON.parse(captured.stdout.join('\n')) as { ok: boolean; code?: string; message?: string; data: any };
}

/** Point the single per-project session binding at `sessionId`. */
function bindSession(wsPath: string, sessionId: string): void {
  const runtimeDir = join(wsPath, '.peaks', '_runtime');
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(
    join(runtimeDir, 'session.json'),
    JSON.stringify({ sessionId, projectRoot: wsPath }) + '\n',
    'utf8',
  );
}

function readJobState(wsPath: string, sid: string, jobId: string): { slices: Array<{ sliceId: string; label: string; status: string }> } {
  const p = join(wsPath, '.peaks', '_runtime', sid, 'job', jobId, 'state.json');
  return JSON.parse(readFileSync(p, 'utf8')) as { slices: Array<{ sliceId: string; label: string; status: string }> };
}

async function seedJob(wsPath: string, sid: string, jobId: string, sliceList: string): Promise<void> {
  await runJob(['init', '--job-id', jobId, '--slice-list', sliceList, '--session-id', sid], wsPath);
}

describe('Scenario: render — every job subcommand declares --session-id', () => {
  it('when the job command tree is registered, should declare --session-id on every subcommand that resolves a job root', () => {
    // given: the registered `peaks job` command tree
    const job = jobCommand();
    const names = job.commands.map((c) => c.name()).sort();
    // when: each subcommand's help text is rendered
    const help = new Map(job.commands.map((c) => [c.name(), c.helpInformation()]));
    // then: every subcommand that resolves a job root advertises the override flag
    expect(names).toEqual([...SUBCOMMANDS_THAT_RESOLVE_A_JOB_ROOT].sort());
    for (const name of SUBCOMMANDS_THAT_RESOLVE_A_JOB_ROOT) {
      expect(help.get(name), `${name} is missing --session-id`).toContain('--session-id <sid>');
    }
  });

  it('when a job is read via --session-id, should return the ok status envelope shape', async () => {
    // given: a bound session holding a 2-slice job
    const ws = useTmpWorkspace('peaks-job-sid-render-');
    try {
      bindSession(ws.path, JOB_SID);
      await seedJob(ws.path, JOB_SID, 'render-job', 'S1,S2');
      // when: job status is read
      const captured = await runJob(['status', '--job-id', 'render-job'], ws.path);
      // then: the envelope is ok and carries the job summary
      const envelope = parseJson(captured);
      expect(envelope.ok).toBe(true);
      expect(envelope.data.total).toBe(2);
      expect(envelope.data.done).toBe(0);
      expect(envelope.data.currentSlice).toBe('S1');
    } finally {
      cleanupTmpWorkspace();
    }
  });
});

describe('Scenario: behavior — session resolution precedence is flag > env > binding', () => {
  let ws: TmpWorkspace;

  beforeEach(() => {
    ws = useTmpWorkspace('peaks-job-sid-behavior-');
    withEnv('PEAKS_SESSION_ID', undefined);
  });
  afterEach(() => { cleanupTmpWorkspace(); });

  it('when both --session-id and PEAKS_SESSION_ID are set, should read the flag session', async () => {
    // given: job "alpha" exists in two sessions with different slice counts
    await seedJob(ws.path, JOB_SID, 'alpha', 'S1,S2');
    await seedJob(ws.path, OTHER_SID, 'alpha', 'S1,S2,S3,S4,S5');
    withEnv('PEAKS_SESSION_ID', OTHER_SID);
    // when: status is read with an explicit --session-id
    const captured = await runJob(['status', '--job-id', 'alpha', '--session-id', JOB_SID], ws.path);
    // then: the flag wins over the env var
    const envelope = parseJson(captured);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.total).toBe(2);
  });

  it('when --session-id is absent but PEAKS_SESSION_ID is set, should read the env session', async () => {
    // given: the job lives in ENV_SID while the project binding points elsewhere
    bindSession(ws.path, OTHER_SID);
    await seedJob(ws.path, JOB_SID, 'beta', 'S1,S2,S3');
    withEnv('PEAKS_SESSION_ID', JOB_SID);
    // when: status is read without --session-id
    const captured = await runJob(['status', '--job-id', 'beta'], ws.path);
    // then: the env tier is consulted before the binding
    const envelope = parseJson(captured);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.total).toBe(3);
  });

  it('when only the binding is set, should still read the bound session', async () => {
    // given: a bound session holding a 4-slice job
    bindSession(ws.path, JOB_SID);
    await seedJob(ws.path, JOB_SID, 'gamma', 'S1,S2,S3,S4');
    // when: status is read without any override
    const captured = await runJob(['status', '--job-id', 'gamma'], ws.path);
    // then: the binding tier still works (no regression for the single-session case)
    const envelope = parseJson(captured);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.total).toBe(4);
  });
});

describe('Scenario: integration — a job stays addressable while the binding points elsewhere', () => {
  let ws: TmpWorkspace;

  beforeEach(() => {
    ws = useTmpWorkspace('peaks-job-sid-integration-');
    withEnv('PEAKS_SESSION_ID', undefined);
  });
  afterEach(() => { cleanupTmpWorkspace(); });

  it('when the binding points at another session, should read the job via --session-id', async () => {
    // given: job "peaks-web" in JOB_SID and a binding pointing at OTHER_SID
    bindSession(ws.path, OTHER_SID);
    await seedJob(ws.path, JOB_SID, 'peaks-web', 'S1,S2,S3,S4');
    // when: status is read with --session-id
    const captured = await runJob(['status', '--job-id', 'peaks-web', '--session-id', JOB_SID], ws.path);
    // then: the read succeeds against the job's own session
    const envelope = parseJson(captured);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.total).toBe(4);
  });

  it('when the binding points at another session, should write the slice mutation via --session-id', async () => {
    // given: job "peaks-web" in JOB_SID and a binding pointing at OTHER_SID
    bindSession(ws.path, OTHER_SID);
    await seedJob(ws.path, JOB_SID, 'peaks-web', 'S1,S2');
    // when: a slice mutation runs with --session-id
    const captured = await runJob(
      ['block', '--job-id', 'peaks-web', '--slice-id', 'S1', '--reason', 'waiting on review', '--session-id', JOB_SID],
      ws.path,
    );
    // then: the envelope is ok and the write landed in JOB_SID, not the bound session
    expect(parseJson(captured).ok).toBe(true);
    expect(readJobState(ws.path, JOB_SID, 'peaks-web').slices[0]!.status).toBe('blocked');
  });
});

describe('Scenario: a11y — an unresolvable job/session fails with a readable envelope', () => {
  let ws: TmpWorkspace;

  beforeEach(() => {
    ws = useTmpWorkspace('peaks-job-sid-a11y-');
    withEnv('PEAKS_SESSION_ID', undefined);
  });
  afterEach(() => { cleanupTmpWorkspace(); });

  it('when the job lives in another session, should name that session so the caller can re-run with --session-id', async () => {
    // given: job "delta" in JOB_SID while the binding points at OTHER_SID
    bindSession(ws.path, OTHER_SID);
    await seedJob(ws.path, JOB_SID, 'delta', 'S1');
    // when: status is read without --session-id
    const attempt = runJob(['status', '--job-id', 'delta'], ws.path);
    // then: the failure names both the bound session and the session that holds the job
    await expect(attempt).rejects.toThrow(/JOB_NOT_IN_SESSION/);
    await expect(attempt).rejects.toThrow(new RegExp(OTHER_SID));
    await expect(attempt).rejects.toThrow(new RegExp(`--session-id ${JOB_SID}`));
  });

  it('when no session can be resolved at all, should fail with NO_ACTIVE_SESSION instead of guessing one', async () => {
    // given: no binding file and no PEAKS_SESSION_ID
    // when: status is read
    const attempt = runJob(['status', '--job-id', 'nowhere'], ws.path);
    // then: the failure is the explicit NO_ACTIVE_SESSION, never a fabricated session
    await expect(attempt).rejects.toThrow(/NO_ACTIVE_SESSION/);
  });
});
