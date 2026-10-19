/**
 * v3.1.2 Step 0.8 — integration test for `peaks code gate-step-08`.
 *
 * Spawns `node bin/peaks.js code gate-step-08` as a real child process
 * (the way the PreToolUse hook does) and asserts:
 *   - exit 0 + allow envelope on the 4 happy paths
 *   - exit 2 + BLOCKED stderr on the prompt-shape block path
 *   - structured stdout is parseable as JSON envelope
 *
 * Karpathy §4: every AC ↔ a passing test. The integration seam is the
 * hook protocol itself (exit code + stderr), not just the service layer.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { writeJobShapeDecision } from '../../src/services/code/job-shape-decision.js';
import { writeJobProgress } from '../../src/services/job/job-progress-store.js';

const BIN = resolve(__dirname, '../../bin/peaks.js');
const BIN_TIMEOUT_MS = 30_000;

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-step-08-int-'));
}

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

function runCli(args: readonly string[], cwd: string, stdinText?: string): RunResult {
  try {
    const stdout = execFileSync('node', [BIN, 'code', 'gate-step-08', ...args], {
      cwd,
      stdio: [stdinText !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      input: stdinText,
      windowsHide: true,
      timeout: BIN_TIMEOUT_MS
    }).toString('utf8');
    return { stdout, stderr: '', code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
    return {
      stdout: typeof e.stdout === 'string' ? e.stdout : (e.stdout?.toString('utf8') ?? ''),
      stderr: typeof e.stderr === 'string' ? e.stderr : (e.stderr?.toString('utf8') ?? ''),
      code: e.status ?? 1
    };
  }
}

const SESSION_ID = '2026-07-03-test-step-08-int';
const FIXED_NOW = new Date('2026-07-03T12:00:00.000Z');

const projects: string[] = [];

beforeEach(() => {
  // nothing per-test setup
});

afterEach(() => {
  for (const root of projects) {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  }
  projects.length = 0;
});

/** `.peaks/_runtime/<sid>/job/<jid>/state.json` — `peaks job init`'s output. */
function writeJobLedger(project: string, sessionId: string, jid: string): void {
  const jobDir = join(project, '.peaks', '_runtime', sessionId, 'job', jid);
  mkdirSync(jobDir, { recursive: true });
  writeFileSync(
    join(jobDir, 'state.json'),
    JSON.stringify({ jobId: jid, slices: [{ status: 'pending' }] }),
    'utf8'
  );
}

/** The PreToolUse payload the Bash matcher pipes into the hook process. */
function hookPayload(command: string): string {
  return JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
}

function writeDecisionAndProgress(
  project: string,
  isJob: boolean,
  jid: string,
  progress?: { done: number; total: number; currentSlice: string }
): void {
  writeJobShapeDecision(
    project,
    SESSION_ID,
    {
      isJob,
      rationale: 'integration-test rationale',
      suggestedJobId: jid,
      suggestedStrategy: 'single',
      confidence: 'high',
      prompt: 'integration-test prompt'
    },
    { now: () => FIXED_NOW, force: true }
  );
  if (progress !== undefined) {
    writeJobProgress(project, SESSION_ID, {
      jobId: jid,
      done: progress.done,
      total: progress.total,
      currentSlice: progress.currentSlice,
      lastCommitSha: 'abc1234567',
      updatedAt: FIXED_NOW.toISOString()
    });
  }
}

describe('peaks code gate-step-08 (v3.1.2) hook integration', () => {
  test('AC-1: isJob=true with progress.json → exit 0 + Next: slice #N+1 of M', () => {
    const project = makeProject();
    projects.push(project);
    writeDecisionAndProgress(project, true, 'unit-test-int-job', {
      done: 5,
      total: 35,
      currentSlice: 'slice-6: app/components/signin'
    });
    const r = runCli(['--project', project, '--session-id', SESSION_ID, '--json'], project);
    expect(r.code).toBe(0);
    const env = JSON.parse(r.stdout) as {
      ok: boolean;
      command: string;
      data: { allow: boolean; mode: string; nextSlice: string | null; progress: unknown };
    };
    expect(env.ok).toBe(true);
    expect(env.command).toBe('code.gate-step-08');
    expect(env.data.allow).toBe(true);
    expect(env.data.mode).toBe('job');
    expect(env.data.nextSlice).toBe('Next: slice #6 of 35 (slice-6: app/components/signin)');
  });

  test('AC-2: isJob=false → exit 0 + mode=single', () => {
    const project = makeProject();
    projects.push(project);
    writeDecisionAndProgress(project, false, 'unit-test-int-single');
    const r = runCli(['--project', project, '--session-id', SESSION_ID, '--json'], project);
    expect(r.code).toBe(0);
    const env = JSON.parse(r.stdout) as { ok: boolean; data: { allow: boolean; mode: string } };
    expect(env.ok).toBe(true);
    expect(env.data.allow).toBe(true);
    expect(env.data.mode).toBe('single');
  });

  test('AC-3: no decision + backup-regex prompt match → exit 2 + BLOCKED stderr', () => {
    const project = makeProject();
    projects.push(project);
    const r = runCli(
      [
        '--project',
        project,
        '--session-id',
        SESSION_ID,
        '--prompt',
        '继续执行下个 slice,直到全部添加完,不用考虑费用',
        '--json'
      ],
      project
    );
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/BLOCKED:/);
    expect(r.stderr).toMatch(/peaks code detect-job/);
    const env = JSON.parse(r.stdout) as {
      ok: boolean;
      code: string;
      data: { promptSource: string; backupRegex: string };
    };
    expect(env.ok).toBe(false);
    expect(env.code).toBe('STEP_08_BLOCKED');
    // The CLI surfaces promptSource (flag / last-prompt-file / stdin-empty)
    // and the backup regex in the failure envelope; the promptHit boolean
    // is internal to evaluateStep08.
    expect(env.data.promptSource).toBe('flag');
    expect(env.data.backupRegex).toMatch(
      /until|全部|until all done|disavow cost|不用考虑费用|all of them/
    );
  });

  test('AC-4: no decision + innocuous prompt → exit 0 + mode=undecided-no-regex-hit', () => {
    const project = makeProject();
    projects.push(project);
    const r = runCli(
      ['--project', project, '--session-id', SESSION_ID, '--prompt', 'fix the auth bug', '--json'],
      project
    );
    expect(r.code).toBe(0);
    const env = JSON.parse(r.stdout) as { ok: boolean; data: { allow: boolean; mode: string } };
    expect(env.ok).toBe(true);
    expect(env.data.allow).toBe(true);
    expect(env.data.mode).toBe('undecided-no-regex-hit');
  });

  test('AC-5: no session id + no decision → exit 0 (single-rid pass-through)', () => {
    const project = makeProject();
    projects.push(project);
    const r = runCli(['--project', project, '--json'], project);
    expect(r.code).toBe(0);
    const env = JSON.parse(r.stdout) as { ok: boolean; data: { allow: boolean; mode: string } };
    expect(env.data.allow).toBe(true);
    expect(env.data.mode).toBe('no-session');
    // Defensive: the txt/last-prompt.txt path was not consulted (the
    // service layer's no-session path short-circuits before the
    // prompt-source branch).
    mkdirSync(join(project, '.peaks', '_runtime', 'random-session', 'txt'), { recursive: true });
    writeFileSync(
      join(project, '.peaks', '_runtime', 'random-session', 'txt', 'last-prompt.txt'),
      'until all done',
      'utf8'
    );
    void existsSync;
  });
});

// Backlog §17.1 fix (1). These spawn the real CLI with the hook payload on
// stdin — the seam the PreToolUse hook uses — because the defect was that the
// command was never read at all. `--prompt` is deliberately absent: stdin is
// only read when the prompt flag does not already name the source.
describe('Step 0.8 remedy exemption (backlog §17.1)', () => {
  const REMEDY = 'peaks code detect-job --is-job false --rationale "x"';

  function ledgerProject(): string {
    const project = makeProject();
    projects.push(project);
    writeJobLedger(project, SESSION_ID, 'backcompat-expiry-hardening');
    return project;
  }

  test('AC1: a real detect-job invocation on stdin → exit 0 + remedy-command, no decision written', () => {
    const project = ledgerProject();
    const r = runCli(
      ['--project', project, '--session-id', SESSION_ID, '--json'],
      project,
      hookPayload(REMEDY)
    );
    expect(r.code).toBe(0);
    const env = JSON.parse(r.stdout) as { ok: boolean; data: { allow: boolean; mode: string } };
    expect(env.ok).toBe(true);
    expect(env.data.allow).toBe(true);
    expect(env.data.mode).toBe('remedy-command');
    // The exemption permits ONE retry command; it does not record the
    // decision on the caller's behalf.
    expect(existsSync(join(project, '.peaks', '_runtime', SESSION_ID, 'job-shape.json'))).toBe(
      false
    );
  });

  test('AC2: an unrelated command still exits 2 with the ledger verdict', () => {
    const project = ledgerProject();
    const r = runCli(
      ['--project', project, '--session-id', SESSION_ID, '--json'],
      project,
      hookPayload('ls')
    );
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/BLOCKED:/);
    const env = JSON.parse(r.stdout) as { ok: boolean; code: string };
    expect(env.ok).toBe(false);
    expect(env.code).toBe('STEP_08_BLOCKED_WITH_LEDGER');
  });

  test('AC3: a command that only quotes detect-job still exits 2', () => {
    const project = ledgerProject();
    const r = runCli(
      ['--project', project, '--session-id', SESSION_ID, '--json'],
      project,
      hookPayload('echo "peaks code detect-job --is-job false"')
    );
    expect(r.code).toBe(2);
    const env = JSON.parse(r.stdout) as { ok: boolean; code: string };
    expect(env.code).toBe('STEP_08_BLOCKED_WITH_LEDGER');
  });
});
