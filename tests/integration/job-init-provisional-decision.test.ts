// tests/integration/job-init-provisional-decision.test.ts
//
// Backlog §17.1 fixes (3) and (4), end-to-end through the built CLI.
//
//   3. `peaks job init` leaves a provisional `job-shape.json` behind, so a
//      session that creates a ledger and nothing else is not refused by the
//      Step 0.8 gate on every Bash call.
//   4. Both block arms of `peaks code gate-step-08` name the exit code they
//      used, in the JSON envelope and on stderr.
//
// Spawns `dist/cli/index.js` (the path tsconfig.build.json emits) so the seam
// is the real process boundary the PreToolUse hook crosses. Build before
// running: `pnpm build`.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CLI = join(process.cwd(), 'dist/cli/index.js');
const SESSION_ID = '2026-10-19-session-ledger-provisional-int';
const JOB_ID = 'provisional-int-job';

interface RunResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface Envelope {
  readonly ok: boolean;
  readonly code?: string;
  readonly data: Record<string, unknown>;
  readonly warnings: readonly string[];
  readonly nextActions: readonly string[];
}

function peaks(args: readonly string[], cwd: string): RunResult {
  const r = spawnSync('node', [CLI, ...args, '--json'], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, PEAKS_SESSION_ID: SESSION_ID },
    windowsHide: true
  });
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

function envelopeOf(run: RunResult): Envelope {
  return JSON.parse(run.stdout) as Envelope;
}

function initJob(workdir: string, jobId: string, strategy = 'single'): RunResult {
  return peaks(
    [
      'job',
      'init',
      '--job-id',
      jobId,
      '--slice-list',
      'a,b',
      '--main-loop-strategy',
      strategy,
      '--session-id',
      SESSION_ID,
      '--project',
      workdir
    ],
    workdir
  );
}

function decisionPath(workdir: string): string {
  return join(workdir, '.peaks', '_runtime', SESSION_ID, 'job-shape.json');
}

function ledgerPath(workdir: string, jobId: string): string {
  return join(workdir, '.peaks', '_runtime', SESSION_ID, 'job', jobId, 'state.json');
}

/** A ledger with no decision, for the gate arm `job init` can no longer reach. */
function writeBareLedger(workdir: string, jobId: string): void {
  const jobDir = join(workdir, '.peaks', '_runtime', SESSION_ID, 'job', jobId);
  mkdirSync(jobDir, { recursive: true });
  writeFileSync(
    join(jobDir, 'state.json'),
    JSON.stringify({ jobId, slices: [{ status: 'pending' }] }),
    'utf8'
  );
}

describe('§17.1 fix (3) — peaks job init leaves a provisional decision', () => {
  let workdir: string;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'peaks-provisional-int-'));
  });
  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  it('when the session has no decision, should write the ledger and a provisional decision the gate accepts', () => {
    // given: an empty project and no job-shape.json
    expect(existsSync(decisionPath(workdir))).toBe(false);

    // when: `peaks job init` creates the ledger
    const init = initJob(workdir, JOB_ID);

    // then: both files exist, and the decision says what the ledger implies
    expect(init.status, `init failed: ${init.stderr}`).toBe(0);
    expect(existsSync(ledgerPath(workdir, JOB_ID))).toBe(true);
    const record = JSON.parse(readFileSync(decisionPath(workdir), 'utf8')) as {
      decision: {
        isJob: boolean;
        suggestedJobId: string;
        suggestedStrategy: string;
        confidence: string;
        rationale: string;
      };
    };
    expect(record.decision).toMatchObject({
      isJob: true,
      suggestedJobId: JOB_ID,
      suggestedStrategy: 'single',
      confidence: 'medium'
    });
    expect(record.decision.rationale).toMatch(/provisional/i);

    // and the gate now allows an unrelated Bash command instead of blocking it
    const gate = peaks(
      [
        'code',
        'gate-step-08',
        '--project',
        workdir,
        '--session-id',
        SESSION_ID,
        '--prompt',
        'fix the auth bug'
      ],
      workdir
    );
    expect(gate.status, `gate blocked: ${gate.stderr}`).toBe(0);
    const gateEnvelope = envelopeOf(gate);
    expect(gateEnvelope.ok).toBe(true);
    expect(gateEnvelope.data.mode).toBe('job');
  });

  it('when the rationale remedy is run as printed, should re-record the decision instead of refusing', () => {
    // given: a provisional decision written by `peaks job init`
    expect(initJob(workdir, JOB_ID).status).toBe(0);
    const provisional = JSON.parse(readFileSync(decisionPath(workdir), 'utf8')) as {
      decision: { suggestedJobId: string; rationale: string };
    };
    const jid = provisional.decision.suggestedJobId;

    // when: the command the rationale prints is run verbatim
    expect(provisional.decision.rationale).toContain(
      `peaks code detect-job --is-job true --suggested-job-id ${jid} --force`
    );
    const rerun = peaks(
      [
        'code',
        'detect-job',
        '--is-job',
        'true',
        '--rationale',
        'deliberate re-record',
        '--suggested-job-id',
        jid,
        '--force',
        '--session-id',
        SESSION_ID,
        '--project',
        workdir
      ],
      workdir
    );

    // then: the printed remedy works — exit 0 and the provisional text is gone
    expect(rerun.status, `printed remedy failed: ${rerun.stderr}`).toBe(0);
    const after = JSON.parse(readFileSync(decisionPath(workdir), 'utf8')) as {
      decision: { rationale: string };
    };
    expect(after.decision.rationale).toBe('deliberate re-record');
  });

  it('when a deliberate decision exists, should leave it byte-identical', () => {
    // given: a decision recorded by `peaks code detect-job` before any ledger
    const detect = peaks(
      [
        'code',
        'detect-job',
        '--is-job',
        'false',
        '--rationale',
        'deliberate single-rid verdict',
        '--session-id',
        SESSION_ID,
        '--project',
        workdir
      ],
      workdir
    );
    expect(detect.status, `detect-job failed: ${detect.stderr}`).toBe(0);
    const before = readFileSync(decisionPath(workdir), 'utf8');

    // when: `peaks job init` creates a ledger in the same session
    const init = initJob(workdir, JOB_ID);

    // then: the deliberate decision wins untouched
    expect(init.status, `init failed: ${init.stderr}`).toBe(0);
    expect(readFileSync(decisionPath(workdir), 'utf8')).toBe(before);
  });

  it('when an isJob=true decision exists, should leave it byte-identical', () => {
    // given: a deliberate Job decision recorded before the ledger
    const detect = peaks(
      [
        'code',
        'detect-job',
        '--is-job',
        'true',
        '--rationale',
        'deliberate Job verdict',
        '--suggested-job-id',
        'deliberate-job',
        '--session-id',
        SESSION_ID,
        '--project',
        workdir
      ],
      workdir
    );
    expect(detect.status, `detect-job failed: ${detect.stderr}`).toBe(0);
    const before = readFileSync(decisionPath(workdir), 'utf8');

    // when: `peaks job init` creates a ledger in the same session
    const init = initJob(workdir, JOB_ID);

    // then: the deliberate Job decision wins untouched
    expect(init.status, `init failed: ${init.stderr}`).toBe(0);
    expect(readFileSync(decisionPath(workdir), 'utf8')).toBe(before);
  });

  it('when job init runs twice for the same job, should not corrupt the decision', () => {
    // given: a first init that wrote the provisional decision
    expect(initJob(workdir, JOB_ID).status).toBe(0);
    const first = readFileSync(decisionPath(workdir), 'utf8');

    // when: the same job is initialised again
    const second = initJob(workdir, JOB_ID);

    // then: the second run succeeds and writes no new decision
    expect(second.status, `second init failed: ${second.stderr}`).toBe(0);
    expect(readFileSync(decisionPath(workdir), 'utf8')).toBe(first);
  });

  it('when the provisional decision cannot be written, should surface the failure and the remedy', () => {
    // given: a job id the decision schema refuses (uppercase is not accepted)
    const refusedJobId = 'BadJob';

    // when: `peaks job init` creates the ledger anyway
    const init = initJob(workdir, refusedJobId);

    // then: the ledger is reported accurately, and the failure is not swallowed
    expect(init.status, `init failed: ${init.stderr}`).toBe(0);
    const env = envelopeOf(init);
    expect(env.ok).toBe(true);
    expect(env.data.statePath).toContain('state.json');
    expect(existsSync(ledgerPath(workdir, refusedJobId))).toBe(true);
    expect(env.warnings.join(' ')).toMatch(/Could not write the provisional Job-shape decision/);
    expect(env.nextActions.join(' ')).toContain(
      `peaks code detect-job --is-job true --suggested-job-id ${refusedJobId}`
    );
    expect(existsSync(decisionPath(workdir))).toBe(false);
  });

  it('when an unreadable decision exists, should keep it and surface the --force remedy', () => {
    // given: a `job-shape.json` that no longer parses
    mkdirSync(join(workdir, '.peaks', '_runtime', SESSION_ID), { recursive: true });
    writeFileSync(decisionPath(workdir), '{ not json', 'utf8');

    // when: `peaks job init` creates the ledger
    const init = initJob(workdir, JOB_ID);

    // then: the file is untouched, and the envelope names both the corruption and --force
    expect(init.status, `init failed: ${init.stderr}`).toBe(0);
    const env = envelopeOf(init);
    expect(env.warnings.join(' ')).toMatch(/unreadable/);
    expect(env.nextActions.join(' ')).toContain(
      `peaks code detect-job --is-job true --suggested-job-id ${JOB_ID} --force`
    );
    expect(readFileSync(decisionPath(workdir), 'utf8')).toBe('{ not json');
  });
});

describe('§17.1 fix (4) — peaks code gate-step-08 names its exit code', () => {
  let workdir: string;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'peaks-gate-exitcode-int-'));
  });
  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  it('when the ledger arm blocks, should exit 2, carry exitCode 2, and name exit 2 on stderr', () => {
    // given: a ledger with no decision — the state `job init` used to leave behind
    writeBareLedger(workdir, 'bare-ledger-job');

    // when: an unrelated Bash command is gated
    const gate = peaks(
      [
        'code',
        'gate-step-08',
        '--project',
        workdir,
        '--session-id',
        SESSION_ID,
        '--prompt',
        'fix the auth bug'
      ],
      workdir
    );

    // then: the code is named in both channels a harness reads
    expect(gate.status).toBe(2);
    const env = envelopeOf(gate);
    expect(env.code).toBe('STEP_08_BLOCKED_WITH_LEDGER');
    expect(env.data.exitCode).toBe(2);
    // Not anchored: the spawned node process prefixes its ExperimentalWarning.
    expect(gate.stderr).toMatch(/BLOCKED:/);
    expect(gate.stderr).toMatch(/exit 2/);
  });

  it('when the prompt-shape arm blocks, should exit 2, carry exitCode 2, and name exit 2 on stderr', () => {
    // given: no decision, no ledger, and a prompt matching the backup regex
    // when: the gate runs
    const gate = peaks(
      [
        'code',
        'gate-step-08',
        '--project',
        workdir,
        '--session-id',
        SESSION_ID,
        '--prompt',
        '直到全部添加完'
      ],
      workdir
    );

    // then: the code is named in both channels a harness reads
    expect(gate.status).toBe(2);
    const env = envelopeOf(gate);
    expect(env.code).toBe('STEP_08_BLOCKED');
    expect(env.data.exitCode).toBe(2);
    expect(gate.stderr).toMatch(/BLOCKED:/);
    expect(gate.stderr).toMatch(/exit 2/);
  });

  it('when a normal session is allowed, should stay exit 0 with no exitCode field', () => {
    // given: no decision and no ledger
    // when: the gate runs
    const gate = peaks(
      [
        'code',
        'gate-step-08',
        '--project',
        workdir,
        '--session-id',
        SESSION_ID,
        '--prompt',
        'fix the auth bug'
      ],
      workdir
    );

    // then: the allow arm is unchanged
    expect(gate.status).toBe(0);
    const env = envelopeOf(gate);
    expect(env.data.mode).toBe('undecided-no-regex-hit');
    expect(env.data).not.toHaveProperty('exitCode');
  });
});
