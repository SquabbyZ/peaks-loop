/**
 * `peaks sub-agent heartbeat` command-level unit tests.
 *
 * Slice 2026-06-23-audit-p0-test-coverage — the heartbeat action handler
 * (heartbeat-commands.ts) shipped without direct unit-test coverage.
 * These tests pin the four exit-code paths:
 *
 *   - INVALID_RECORD_PATH — record does not exist on disk
 *   - INVALID_STATUS      — --status not in HEARTBEAT_STATUSES
 *   - INVALID_PROGRESS    -- --progress not an integer 0..100
 *   - NOTE_TOO_LONG       -- --note > 200 chars
 *   - happy path          -- record exists, valid args, heartbeat appended
 *
 * Strategy: run `peaks sub-agent dispatch` to create a real record (which
 * yields a real `dispatchRecordPath` in the envelope), then point
 * `peaks sub-agent heartbeat` at that path. This avoids mocking
 * `homedir()` / `process.cwd()`.
 */
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCommand, parseJsonOutput } from '../../cli-program-test-utils.js';

const RID = '002-2026-06-23-heartbeat-test';
const SID = '2026-06-23-session-heartbeat-test';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-heartbeat-cli-'));
});

afterEach(() => {
  // Release the cwd before removing — on Windows, leaving the temp dir
  // as the process CWD causes EPERM on the recursive rmSync. Best-effort
  // chdir to a stable path first, then remove.
  try {
    process.chdir(tmpdir());
  } catch {
    // ignore
  }
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
});

/** Run a real `peaks sub-agent dispatch` to materialize a record and
 *  return the absolute path. The dispatch envelope exposes it. */
async function bootstrapRecordPathViaDispatch(): Promise<string> {
  const { stdout } = await runCommand([
    'sub-agent', 'dispatch', 'rd',
    '--prompt', 'plan the slice',
    '--request-id', RID,
    '--session-id', SID,
    '--json'
  ], {});
  const parsed = parseJsonOutput<{ dispatchRecordPath: string }>(stdout);
  expect(parsed.ok).toBe(true);
  return parsed.data.dispatchRecordPath;
}

describe('peaks sub-agent heartbeat: validation paths', () => {
  it('INVALID_RECORD_PATH when --record points at a missing file', async () => {
    const { stdout, exitCode } = await runCommand([
      'sub-agent', 'heartbeat',
      '--record', join(root, 'does-not-exist.json'),
      '--status', 'running',
      '--progress', '50',
      '--json'
    ], {});
    const parsed = parseJsonOutput(stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('INVALID_RECORD_PATH');
    expect(exitCode).toBe(1);
  });

  it('INVALID_STATUS when --status is not in the documented closed set', async () => {
    const recordPath = await bootstrapRecordPathViaDispatch();
    const { stdout, exitCode } = await runCommand([
      'sub-agent', 'heartbeat',
      '--record', recordPath,
      '--status', 'flying',
      '--progress', '50',
      '--json'
    ], {});
    const parsed = parseJsonOutput(stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('INVALID_STATUS');
    expect(exitCode).toBe(1);
  });

  it('INVALID_PROGRESS when --progress is non-numeric', async () => {
    const recordPath = await bootstrapRecordPathViaDispatch();
    const { stdout, exitCode } = await runCommand([
      'sub-agent', 'heartbeat',
      '--record', recordPath,
      '--status', 'running',
      '--progress', 'abc',
      '--json'
    ], {});
    const parsed = parseJsonOutput(stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('INVALID_PROGRESS');
    expect(exitCode).toBe(1);
  });

  it('INVALID_PROGRESS when --progress is out of range (negative)', async () => {
    const recordPath = await bootstrapRecordPathViaDispatch();
    const { stdout } = await runCommand([
      'sub-agent', 'heartbeat',
      '--record', recordPath,
      '--status', 'running',
      '--progress', '-1',
      '--json'
    ], {});
    const parsed = parseJsonOutput(stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('INVALID_PROGRESS');
  });

  it('INVALID_PROGRESS when --progress exceeds 100', async () => {
    const recordPath = await bootstrapRecordPathViaDispatch();
    const { stdout } = await runCommand([
      'sub-agent', 'heartbeat',
      '--record', recordPath,
      '--status', 'running',
      '--progress', '101',
      '--json'
    ], {});
    const parsed = parseJsonOutput(stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('INVALID_PROGRESS');
  });

  it('NOTE_TOO_LONG when --note exceeds 200 chars', async () => {
    const recordPath = await bootstrapRecordPathViaDispatch();
    const longNote = 'x'.repeat(201);
    const { stdout } = await runCommand([
      'sub-agent', 'heartbeat',
      '--record', recordPath,
      '--status', 'running',
      '--progress', '50',
      '--note', longNote,
      '--json'
    ], {});
    const parsed = parseJsonOutput(stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('NOTE_TOO_LONG');
  });
});

describe('peaks sub-agent heartbeat: happy path', () => {
  it('appends a heartbeat to a freshly-written dispatch record', async () => {
    const recordPath = await bootstrapRecordPathViaDispatch();
    const { stdout, exitCode } = await runCommand([
      'sub-agent', 'heartbeat',
      '--record', recordPath,
      '--status', 'running',
      '--progress', '42',
      '--note', 'compiled module A',
      '--json'
    ], {});
    const parsed = parseJsonOutput<{
      recordPath: string;
      heartbeatCount: number;
      lastBeatAt: string;
      status: string;
      truncated: boolean;
    }>(stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.recordPath).toBe(recordPath);
    expect(parsed.data.heartbeatCount).toBe(1);
    expect(parsed.data.lastBeatAt).toMatch(/T.+Z$/);
    expect(parsed.data.status).toBe('running');
    expect(parsed.data.truncated).toBe(false);
    expect(exitCode === undefined || exitCode === 0).toBe(true);
  });

  it('multiple heartbeats accumulate in append-only order', async () => {
    const recordPath = await bootstrapRecordPathViaDispatch();
    const expectedCounts = [1, 2, 3];
    for (let i = 0; i < expectedCounts.length; i += 1) {
      const progress = (i + 1) * 25;
      const { stdout } = await runCommand([
        'sub-agent', 'heartbeat',
        '--record', recordPath,
        '--status', 'running',
        '--progress', String(progress),
        '--json'
      ], {});
      const parsed = parseJsonOutput<{ heartbeatCount: number }>(stdout);
      expect(parsed.ok).toBe(true);
      expect(parsed.data.heartbeatCount).toBe(expectedCounts[i]);
    }
  });

  it('accepts all 6 documented HeartbeatStatus values (closed-set regression)', async () => {
    const recordPath = await bootstrapRecordPathViaDispatch();
    const statuses = ['queued', 'running', 'finalizing', 'done', 'failed', 'stale'];
    for (const status of statuses) {
      const { stdout } = await runCommand([
        'sub-agent', 'heartbeat',
        '--record', recordPath,
        '--status', status,
        '--progress', '0',
        '--json'
      ], {});
      const parsed = parseJsonOutput<{ status: string }>(stdout);
      expect(parsed.ok).toBe(true);
      expect(parsed.data.status).toBe(status);
    }
  });
});