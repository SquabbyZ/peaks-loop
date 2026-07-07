/**
 * v3.1.1 Step 0.8 — `peaks code detect-job` / `peaks code read-job-shape`
 * CLI integration tests.
 *
 * Strategy: spawn `node bin/peaks.js code detect-job ... --json` against
 * a tmp project root, parse the JSON envelope, assert shape. Cover:
 *   - happy path: writes the file, prints ok envelope, second call
 *     without --force fails with JOB_SHAPE_ALREADY_DECIDED.
 *   - bad --is-job: `yes` → INVALID_FLAG.
 *   - bad --suggested-job-id: `Job With Spaces` → INVALID_FLAG.
 *   - read-job-shape after a successful detect: returns the same record.
 *
 * No keyword regex anywhere — the LLM is the source of truth; the CLI
 * is the recorder and gate.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

const BIN = resolve(__dirname, '../../bin/peaks.js');
const BIN_TIMEOUT_MS = 30_000;

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-detectjob-cli-'));
}

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

function runCli(args: readonly string[], cwd: string): RunResult {
  try {
    const stdout = execFileSync('node', [BIN, 'code', 'detect-job', ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: BIN_TIMEOUT_MS
    }).toString('utf8');
    return { stdout, stderr: '', code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
    return {
      stdout: (typeof e.stdout === 'string' ? e.stdout : e.stdout?.toString('utf8') ?? ''),
      stderr: (typeof e.stderr === 'string' ? e.stderr : e.stderr?.toString('utf8') ?? ''),
      code: e.status ?? 1
    };
  }
}

function runCliRead(args: readonly string[], cwd: string): RunResult {
  try {
    const stdout = execFileSync('node', [BIN, 'code', 'read-job-shape', ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: BIN_TIMEOUT_MS
    }).toString('utf8');
    return { stdout, stderr: '', code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
    return {
      stdout: (typeof e.stdout === 'string' ? e.stdout : e.stdout?.toString('utf8') ?? ''),
      stderr: (typeof e.stderr === 'string' ? e.stderr : e.stderr?.toString('utf8') ?? ''),
      code: e.status ?? 1
    };
  }
}

const projects: string[] = [];

beforeEach(() => {
  // nothing — each test creates its own project
});

afterEach(() => {
  for (const root of projects) {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  }
  projects.length = 0;
});

describe('peaks code detect-job / read-job-shape (v3.1.1 Step 0.8)', () => {
  test('happy path: writes the file, prints ok envelope, second call without --force fails with JOB_SHAPE_ALREADY_DECIDED', () => {
    const project = makeProject();
    projects.push(project);
    const sessionId = '2026-07-03-cli-jobshape-happy';
    const r1 = runCli([
      '--is-job', 'true',
      '--rationale', 'multi-dir batch with 25 leaf slices — clearly Job-shaped',
      '--suggested-job-id', 'cli-test-job-001',
      '--suggested-strategy', 'single',
      '--confidence', 'high',
      '--session-id', sessionId,
      '--project', project,
      '--json'
    ], project);
    expect(r1.code).toBe(0);
    const env1 = JSON.parse(r1.stdout) as {
      ok: boolean;
      command: string;
      data: { sessionId: string; promptHash: string; decision: { isJob: boolean; suggestedJobId: string } };
    };
    expect(env1.ok).toBe(true);
    expect(env1.command).toBe('code.detect-job');
    expect(env1.data.sessionId).toBe(sessionId);
    expect(env1.data.decision.isJob).toBe(true);
    expect(env1.data.decision.suggestedJobId).toBe('cli-test-job-001');
    expect(env1.data.promptHash).toMatch(/^[a-f0-9]{16}$/);
    const filePath = join(project, '.peaks', '_runtime', sessionId, 'job-shape.json');
    expect(existsSync(filePath)).toBe(true);
    const written = JSON.parse(readFileSync(filePath, 'utf8')) as { schemaVersion: number; sessionId: string };
    expect(written.schemaVersion).toBe(1);
    expect(written.sessionId).toBe(sessionId);

    const r2 = runCli([
      '--is-job', 'true',
      '--rationale', 'second call should fail',
      '--suggested-job-id', 'cli-test-job-002',
      '--session-id', sessionId,
      '--project', project,
      '--json'
    ], project);
    expect(r2.code).toBe(1);
    const env2 = JSON.parse(r2.stdout) as { ok: boolean; code: string; message: string };
    expect(env2.ok).toBe(false);
    expect(env2.code).toBe('JOB_SHAPE_ALREADY_DECIDED');
  });

  test('bad --is-job: yes → INVALID_FLAG', () => {
    const project = makeProject();
    projects.push(project);
    const r = runCli([
      '--is-job', 'yes',
      '--rationale', 'bad flag',
      '--suggested-job-id', 'cli-test-job-003',
      '--session-id', '2026-07-03-cli-bad-isjob',
      '--project', project,
      '--json'
    ], project);
    expect(r.code).toBe(1);
    const env = JSON.parse(r.stdout) as { ok: boolean; code: string };
    expect(env.ok).toBe(false);
    expect(env.code).toBe('INVALID_FLAG');
  });

  test('bad --suggested-job-id: spaces → INVALID_FLAG', () => {
    const project = makeProject();
    projects.push(project);
    const r = runCli([
      '--is-job', 'true',
      '--rationale', 'bad slug',
      '--suggested-job-id', 'Job With Spaces',
      '--session-id', '2026-07-03-cli-bad-jid',
      '--project', project,
      '--json'
    ], project);
    expect(r.code).toBe(1);
    const env = JSON.parse(r.stdout) as { ok: boolean; code: string };
    expect(env.ok).toBe(false);
    expect(env.code).toBe('INVALID_FLAG');
  });

  test('read-job-shape after a successful detect returns the same record', () => {
    const project = makeProject();
    projects.push(project);
    const sessionId = '2026-07-03-cli-readback';
    const detectRes = runCli([
      '--is-job', 'false',
      '--rationale', 'not Job-shaped: one-off Q&A',
      '--suggested-job-id', 'cli-test-readback-01',
      '--confidence', 'medium',
      '--session-id', sessionId,
      '--project', project,
      '--json'
    ], project);
    expect(detectRes.code).toBe(0);
    const written = JSON.parse(detectRes.stdout) as { data: { decision: { isJob: boolean; suggestedJobId: string } } };

    const readRes = runCliRead([
      '--session-id', sessionId,
      '--project', project,
      '--json'
    ], project);
    expect(readRes.code).toBe(0);
    const read = JSON.parse(readRes.stdout) as { ok: boolean; command: string; data: { sessionId: string; decision: { isJob: boolean; suggestedJobId: string } } };
    expect(read.ok).toBe(true);
    expect(read.command).toBe('code.read-job-shape');
    expect(read.data.sessionId).toBe(sessionId);
    expect(read.data.decision.isJob).toBe(written.data.decision.isJob);
    expect(read.data.decision.suggestedJobId).toBe(written.data.decision.suggestedJobId);
  });

  test('read-job-shape on a fresh project returns JOB_SHAPE_NOT_DECIDED', () => {
    const project = makeProject();
    projects.push(project);
    const r = runCliRead([
      '--session-id', '2026-07-03-cli-fresh',
      '--project', project,
      '--json'
    ], project);
    expect(r.code).toBe(1);
    const env = JSON.parse(r.stdout) as { ok: boolean; code: string };
    expect(env.ok).toBe(false);
    expect(env.code).toBe('JOB_SHAPE_NOT_DECIDED');
  });

  test('idempotency: --force overwrites an existing decision', () => {
    const project = makeProject();
    projects.push(project);
    const sessionId = '2026-07-03-cli-force';
    const r1 = runCli([
      '--is-job', 'true',
      '--rationale', 'first call',
      '--suggested-job-id', 'cli-test-force-001',
      '--session-id', sessionId,
      '--project', project,
      '--json'
    ], project);
    expect(r1.code).toBe(0);
    const r2 = runCli([
      '--is-job', 'false',
      '--rationale', 'overwrite with --force',
      '--suggested-job-id', 'cli-test-force-002',
      '--session-id', sessionId,
      '--project', project,
      '--force',
      '--json'
    ], project);
    expect(r2.code).toBe(0);
    const env = JSON.parse(r2.stdout) as { ok: boolean; data: { decision: { isJob: boolean; suggestedJobId: string } } };
    expect(env.ok).toBe(true);
    expect(env.data.decision.isJob).toBe(false);
    expect(env.data.decision.suggestedJobId).toBe('cli-test-force-002');
  });
});
