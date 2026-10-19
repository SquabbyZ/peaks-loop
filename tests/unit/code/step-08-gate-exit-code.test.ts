// tests/unit/code/step-08-gate-exit-code.test.ts
//
// Backlog §17.1 fix (4): the Step 0.8 gate must name the exit code it used.
// The gate's contract is exit 0 = allow, exit 2 = block, but a harness that
// classifies a non-zero exit as "non-blocking" leaves the transcript saying
// only BLOCKED. Naming `exit 2` in the stderr line and `exitCode: 2` in the
// envelope makes that classification visible to whoever reads the transcript.
// The allow arms must stay exactly as they were — no `exitCode` field.
//
// Kept in its own file because `step-08-gate.test.ts` is at the 500-line tests
// cap.
//
// Dimensions covered: render (the block envelopes carry the code), a11y (the
// stderr line names it), behavior (the allow arms do not gain the field).
// Omitted: integration — the spawned-CLI seam is pinned in
// tests/integration/job-init-provisional-decision.test.ts.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { describe, expect, it } from 'vitest';

import { registerCodeGateStep08Command } from '../../../src/cli/commands/code-gate-step-08-command.js';
import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/code/step-08-gate-exit-code.test.ts',
  ['render', 'behavior', 'a11y'],
  [
    {
      dim: 'integration',
      reason:
        'the spawned CLI seam is pinned in tests/integration/job-init-provisional-decision.test.ts'
    }
  ]
);

const SESSION_ID = '2026-10-19-session-gate-exit-code';
const LEDGER_JOB_ID = 'exit-code-ledger-job';

interface GateRun {
  readonly envelope: {
    readonly ok: boolean;
    readonly code?: string;
    readonly data: Record<string, unknown>;
  };
  readonly stderr: string;
  readonly exitCode: typeof process.exitCode;
}

async function runGate(project: string, prompt: string): Promise<GateRun> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const program = new Command();
  registerCodeGateStep08Command(program, {
    stdout: (s: string) => stdout.push(s),
    stderr: (s: string) => stderr.push(s)
  });
  const before = process.exitCode;
  await program.parseAsync(
    [
      'gate-step-08',
      '--project',
      project,
      '--session-id',
      SESSION_ID,
      '--prompt',
      prompt,
      '--json'
    ],
    { from: 'user' }
  );
  const exitCode = process.exitCode;
  process.exitCode = before;
  // Typed explicitly: `JSON.parse` returns `any`, and assigning that straight
  // into the return value is `no-unsafe-assignment` debt.
  const envelope = JSON.parse(stdout.join('')) as {
    ok: boolean;
    code?: string;
    data: Record<string, unknown>;
  };
  return { envelope, stderr: stderr.join(''), exitCode };
}

/** `.peaks/_runtime/<sid>/job/<jid>/state.json` — a ledger with no decision. */
function ledgerProject(): string {
  const project = mkdtempSync(join(tmpdir(), 'peaks-step08-exitcode-'));
  const jobDir = join(project, '.peaks', '_runtime', SESSION_ID, 'job', LEDGER_JOB_ID);
  mkdirSync(jobDir, { recursive: true });
  writeFileSync(
    join(jobDir, 'state.json'),
    JSON.stringify({ jobId: LEDGER_JOB_ID, slices: [{ status: 'pending' }] }),
    'utf8'
  );
  return project;
}

describe('(render) both block envelopes carry the exit code they set', () => {
  it('when the ledger arm blocks, should carry exitCode 2 in the envelope data', async () => {
    // given: a session that owns a Job ledger and no job-shape.json
    const project = ledgerProject();

    // when: an unrelated Bash command is gated
    const run = await runGate(project, 'fix the auth bug');

    // then: the envelope states the code the process used
    expect(run.envelope.code).toBe('STEP_08_BLOCKED_WITH_LEDGER');
    expect(run.envelope.data.exitCode).toBe(2);
  });

  it('when the prompt-shape arm blocks, should carry exitCode 2 in the envelope data', async () => {
    // given: no decision, no ledger, and a prompt matching the backup regex
    const project = mkdtempSync(join(tmpdir(), 'peaks-step08-exitcode-regex-'));

    // when: the gate runs
    const run = await runGate(project, '继续执行下个 slice,直到全部添加完');

    // then: the envelope states the code the process used
    expect(run.envelope.code).toBe('STEP_08_BLOCKED');
    expect(run.envelope.data.exitCode).toBe(2);
  });
});

describe('(behavior) the allow arms do not gain the field', () => {
  it('when a normal session is allowed, should leave the envelope unchanged and exit 0', async () => {
    // given: a session with no decision and no ledger
    const project = mkdtempSync(join(tmpdir(), 'peaks-step08-exitcode-allow-'));

    // when: the gate runs
    const run = await runGate(project, 'fix the auth bug');

    // then: allow is still exit 0 and carries no exitCode field
    expect(run.exitCode ?? 0).toBe(0);
    expect(run.envelope.ok).toBe(true);
    expect(run.envelope.data).not.toHaveProperty('exitCode');
  });
});

describe('(a11y) the stderr line names the exit code', () => {
  it('when the ledger arm blocks, should name exit 2 on stderr', async () => {
    // given: a ledger with no decision
    const project = ledgerProject();

    // when: the gate blocks
    const run = await runGate(project, 'fix the auth bug');

    // then: a reader of the transcript sees the code, not just BLOCKED
    expect(run.stderr).toMatch(/^BLOCKED:/);
    expect(run.stderr).toMatch(/exit 2/);
  });

  it('when the prompt-shape arm blocks, should name exit 2 on stderr', async () => {
    // given: no decision and a prompt matching the backup regex
    const project = mkdtempSync(join(tmpdir(), 'peaks-step08-exitcode-regex-a11y-'));

    // when: the gate blocks
    const run = await runGate(project, '全部添加完');

    // then: a reader of the transcript sees the code, not just BLOCKED
    expect(run.stderr).toMatch(/^BLOCKED:/);
    expect(run.stderr).toMatch(/exit 2/);
  });
});
