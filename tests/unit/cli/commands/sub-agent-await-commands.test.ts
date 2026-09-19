// tests/unit/cli/commands/sub-agent-await-commands.test.ts
//
// Guards `peaks sub-agent await` (slice 2026-09-16-n1-await-reports).
//
// The defect: the command handed the dispatcher a hardcoded
// `recordPaths: []`. `awaitBatch` short-circuits on an empty list
// (src/services/dispatch/await-batch.ts:134) and returns zero slots with
// `outcome: 'completed'` — so `await` printed `ok: true, results: []` and
// exited 0 for every batch, present or not, forever.
//
// The fix resolves the batch's records from the session dispatch directory
// (`.peaks/_sub_agents/<sid>/dispatch-*.json`, matched on the record's own
// `batchId`) — the resolution the `--batch` branch of `sub-agent finalize`
// and `findBatchRecords` in heartbeat-watch-command.ts already use — and
// fails with NO_DISPATCH_RECORDS when it finds none, instead of returning an
// indistinguishable empty success.
//
// Dimensions covered: behavior / render / integration / a11y.

import { Command } from 'commander';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { makeCapturedIo } from '../../_setup/io.js';
import {
  cleanupTmpWorkspace,
  useTmpWorkspace,
  type TmpWorkspace
} from '../../_setup/tmp-workspace.js';
import { registerAwaitCommand } from '../../../../src/cli/commands/share-commands.js';
import {
  markCompleted,
  writeInitialDispatchRecord
} from '../../../../src/services/dispatch/dispatch-record-writer.js';
import type { SubAgentToolCall } from '../../../../src/services/dispatch/sub-agent-dispatcher.js';

declareDimensions('tests/unit/cli/commands/sub-agent-await-commands.test.ts', [
  'behavior',
  'render',
  'integration',
  'a11y'
]);

const SESSION_ID = '2026-09-16-session-n1await';
const BATCH = 'batch-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const OTHER_BATCH = 'batch-99999999-8888-7777-6666-555555555555';
const NOW = (): Date => new Date('2026-09-16T06:00:00.000Z');

type AwaitEnvelope = {
  ok: boolean;
  data?: {
    batchId?: string;
    ide?: string;
    results?: Array<{
      dispatchIndex: number;
      recordPath: string;
      status: string;
      durationMs: number;
      note: string | null;
    }>;
    summary?: { total: number; done: number; failed: number; cancelled: number; timeout: number };
    unreadableRecords?: string[];
  };
  code?: string;
  message?: string;
  warnings?: string[];
  nextActions?: string[];
};

function sessionDir(ws: TmpWorkspace): string {
  return join(ws.path, '.peaks', '_sub_agents', SESSION_ID);
}

/** Write a real dispatch record into the session directory. Returns its path. */
function seedRecord(ws: TmpWorkspace, requestId: string, batchId: string): string {
  const { path } = writeInitialDispatchRecord({
    projectRoot: ws.path,
    sessionId: SESSION_ID,
    requestId,
    role: 'rd',
    prompt: `do ${requestId}`,
    toolCall: { name: 'Task', args: {} } satisfies SubAgentToolCall,
    batchId,
    now: NOW
  });
  return path;
}

/**
 * A `dispatch-*.json` whose `batchId` cannot be read: the upgrader rejects its
 * `version`, so `readRecord` throws. Its filename has the record shape, so the
 * directory scan does not skip it — which is the point: it must not be
 * mistaken for "this batch has no records".
 */
function seedUnreadableRecord(ws: TmpWorkspace): string {
  const dir = sessionDir(ws);
  mkdirSync(dir, { recursive: true });
  const raw = join(dir, 'dispatch-2026-09-16-stale-foreign-2026-09-16T00-00-00-000Z.json');
  writeFileSync(raw, `${JSON.stringify({ version: '0.0.1', role: 'rd' })}\n`, 'utf8');
  // Canonicalize so the assertion compares the same form the CLI's scan
  // reports (macOS exposes os.tmpdir() as a symlink).
  return realpathSync(raw);
}

async function runAwait(ws: TmpWorkspace, argv: readonly string[]): Promise<AwaitEnvelope> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  registerAwaitCommand(program, io);

  await program.parseAsync(
    ['await', '--project', ws.path, '--session-id', SESSION_ID, '--json', ...argv],
    { from: 'user' }
  );
  // The `await` action is an async handler, so `parseAsync` has already awaited
  // it — unlike `finalize`, whose action detaches with `void (async …)()`. No
  // output poll is needed here.
  if (captured.stdout.length === 0) {
    throw new Error('await printed no envelope');
  }

  const text = captured.stdout.join('\n');
  const start = text.indexOf('{');
  if (start < 0) throw new Error(`no JSON envelope in stdout: ${text}`);
  return JSON.parse(text.slice(start)) as AwaitEnvelope;
}

let ws: TmpWorkspace;
let savedExitCode: string | number | null | undefined;

beforeEach(() => {
  ws = useTmpWorkspace('peaks-await-');
  savedExitCode = process.exitCode;
  process.exitCode = 0;
});

afterEach(() => {
  process.exitCode = savedExitCode;
  cleanupTmpWorkspace();
});

describe('behavior — a batch await reports what its records say', () => {
  it('should report a done dispatch instead of an empty result', async () => {
    const recordPath = seedRecord(ws, '2026-09-16-n1-done', BATCH);
    markCompleted({ recordPath, status: 'done', outcome: 'success', projectRoot: ws.path });

    const envelope = await runAwait(ws, ['--batch', BATCH, '--timeout', '5000']);

    expect(envelope.ok).toBe(true);
    expect(envelope.data?.results).toHaveLength(1);
    expect(envelope.data?.results?.[0]?.status).toBe('done');
    expect(envelope.data?.results?.[0]?.recordPath).toBe(recordPath);
    expect(envelope.data?.summary).toEqual({
      total: 1,
      done: 1,
      failed: 0,
      cancelled: 0,
      timeout: 0
    });
    expect(process.exitCode).toBe(0);
  });

  it('should carry a failed dispatch failure reason into the note', async () => {
    const recordPath = seedRecord(ws, '2026-09-16-n1-failed', BATCH);
    markCompleted({ recordPath, status: 'failed', outcome: 'failed', projectRoot: ws.path });
    // The record's `outcome` is the human reason a failing sub-agent leaves
    // behind. The schema's enum is narrower than what a real one may report, so
    // write the reason the way a real dispatch would leave it — same shape the
    // dispatcher-level tests use.
    const record = JSON.parse(readFileSync(recordPath, 'utf8')) as { outcome: string };
    record.outcome = 'leaf-2 died';
    writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

    const envelope = await runAwait(ws, ['--batch', BATCH, '--timeout', '5000']);

    expect(envelope.data?.results?.[0]?.status).toBe('failed');
    expect(envelope.data?.results?.[0]?.note).toBe('leaf-2 died');
  });

  it('should refuse the batch when only a different batch has records', async () => {
    seedRecord(ws, '2026-09-16-n1-other', OTHER_BATCH);

    const envelope = await runAwait(ws, ['--batch', BATCH, '--timeout', '5000']);

    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('NO_DISPATCH_RECORDS');
  });
});

describe('render — the envelope names the records it waited on', () => {
  it('should report the batches own record path and list the unreadable ones separately', async () => {
    const recordPath = seedRecord(ws, '2026-09-16-n1-mixed', BATCH);
    markCompleted({ recordPath, status: 'done', outcome: 'success', projectRoot: ws.path });
    const corruptPath = seedUnreadableRecord(ws);

    const envelope = await runAwait(ws, ['--batch', BATCH, '--timeout', '5000']);

    expect(envelope.ok).toBe(true);
    expect(envelope.data?.results?.map((r) => r.recordPath)).toEqual([recordPath]);
    expect(envelope.data?.unreadableRecords).toEqual([corruptPath]);
    expect(envelope.warnings?.join(' ')).toContain(corruptPath);
  });
});

describe('integration — the batch is resolved from the session directory on disk', () => {
  it('should find the batch record among the non-record files the session dir also holds', async () => {
    const recordPath = seedRecord(ws, '2026-09-16-n1-scan', BATCH);
    markCompleted({ recordPath, status: 'done', outcome: 'success', projectRoot: ws.path });

    // The directory also holds `active-dispatches.json` (index) and a
    // `batch-<uuid>.counter.json` (counter); neither is a dispatch record and
    // neither may be fed to the reader.
    expect(existsSync(join(sessionDir(ws), 'active-dispatches.json'))).toBe(true);
    writeFileSync(
      join(sessionDir(ws), `batch-${BATCH}.counter.json`),
      `${JSON.stringify({ batchId: BATCH, counter: 1 }, null, 2)}\n`,
      'utf8'
    );

    const envelope = await runAwait(ws, ['--batch', BATCH, '--timeout', '5000']);

    expect(envelope.ok).toBe(true);
    expect(envelope.data?.results?.map((r) => r.recordPath)).toEqual([recordPath]);
    expect(envelope.data?.unreadableRecords).toEqual([]);
  });
});

describe('a11y — a batch that cannot be located fails loudly', () => {
  it('should name the batch and the directory it searched, and exit non-zero', async () => {
    const envelope = await runAwait(ws, ['--batch', BATCH, '--timeout', '5000']);

    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('NO_DISPATCH_RECORDS');
    expect(envelope.message).toContain(BATCH);
    expect(envelope.message).toContain(sessionDir(ws));
    expect(envelope.nextActions?.join(' ')).toContain('--session-id');
    expect(process.exitCode).toBe(1);
  });

  it('should fail rather than report an empty batch when the only record is unreadable', async () => {
    const corruptPath = seedUnreadableRecord(ws);

    const envelope = await runAwait(ws, ['--batch', BATCH, '--timeout', '5000']);

    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('NO_DISPATCH_RECORDS');
    expect(envelope.message).toContain(corruptPath);
    expect(process.exitCode).toBe(1);
  });
});
