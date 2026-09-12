// tests/unit/cli/commands/sub-agent-finalize-commands.test.ts
//
// Guards the `--request-id` scan in `peaks sub-agent finalize`
// (slice S1 of rid-2026-09-12-defect-remediation).
//
// The defect: the `--request-id` branch iterated EVERY `.json` in
// `.peaks/_sub_agents/<sid>/` and called `readRecord` on each. That
// directory also holds two non-record JSON files —
// `active-dispatches.json` (the index) and `batch-<uuid>.counter.json`
// (batch counters) — and neither carries a `version` field, so
// `upgradeDispatchRecord` threw
//   "Dispatch record version mismatch … got undefined"
// before the scan ever reached the real dispatch record. On untouched
// 4.0.43 `peaks sub-agent finalize --request-id <rid>` was therefore
// unconditionally broken.
//
// The `--batch` branch (a few lines below) has always filtered on
// `dispatch-`; this file pins that both branches now agree.
//
// Dimensions covered:
//   - behavior:    the finalize outcome (ok envelope, record transitioned)
//   - render:      the `--json` envelope the caller parses
//   - integration: real session dir + real dispatch record + real fs
//   - a11y:        the non-zero exit code the previous failure produced

import { Command } from 'commander';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { makeCapturedIo } from '../../_setup/io.js';
import { cleanupTmpWorkspace, useTmpWorkspace, type TmpWorkspace } from '../../_setup/tmp-workspace.js';
import {
  registerFinalizeCommand,
  selectFinalizeTarget,
  type FinalizeCandidate,
} from '../../../../src/cli/commands/share-commands.js';
import {
  markCompleted,
  writeInitialDispatchRecord,
} from '../../../../src/services/dispatch/dispatch-record-writer.js';
import type { SubAgentToolCall } from '../../../../src/services/dispatch/sub-agent-dispatcher.js';

declareDimensions('tests/unit/cli/commands/sub-agent-finalize-commands.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y',
]);

const SESSION_ID = '2026-09-12-session-e37ef0';
const TARGET_RID = '2026-09-12-defect-remediation';
const OTHER_RID = '2026-09-12-something-else';
const NOW = (): Date => new Date('2026-09-12T06:00:00.000Z');

type FinalizeEnvelope = {
  ok: boolean;
  data?: {
    finalized: Array<{ recordPath: string; requestId: string; status: string }>;
    skipped: Array<{ recordPath: string; reason: string }>;
    errors: Array<{ recordPath: string; error: string }>;
    selection: {
      requestId: string;
      rule: string;
      matched: number;
      chosen: string | null;
      rejected: Array<{ recordPath: string; status: string; reason: string }>;
    } | null;
  };
  code?: string;
  message?: string;
};

function subAgentDir(ws: TmpWorkspace): string {
  return join(ws.path, '.peaks', '_sub_agents', SESSION_ID);
}

function dispatchRecordFor(ws: TmpWorkspace, requestId: string, now: () => Date = NOW): string {
  const { path } = writeInitialDispatchRecord({
    projectRoot: ws.path,
    sessionId: SESSION_ID,
    requestId,
    role: 'rd',
    prompt: `do ${requestId}`,
    toolCall: { name: 'Task', args: {} } satisfies SubAgentToolCall,
    batchId: 'batch-11111111-2222-3333-4444-555555555555',
    now,
  });
  return path;
}

/**
 * A `dispatch-*.json` that `readRecord` cannot parse — the N2 fixture. It has
 * the right filename shape (so the directory scan does NOT skip it) and a
 * `version` the upgrader refuses, which is what a stale record from an older
 * peaks-loop looks like on disk.
 */
function seedUnreadableDispatchRecord(ws: TmpWorkspace): string {
  const dir = subAgentDir(ws);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'dispatch-2026-09-12-stale-foreign-2026-09-12T00-00-00-000Z.json');
  writeFileSync(path, `${JSON.stringify({ version: '0.0.1', role: 'rd' })}\n`, 'utf8');
  return path;
}

/**
 * The two JSON files that are NOT dispatch records but live in the same
 * directory. Both were read by the `--request-id` scan before the fix.
 */
function seedNonRecordJson(ws: TmpWorkspace): void {
  const dir = subAgentDir(ws);
  writeFileSync(
    join(dir, 'batch-11111111-2222-3333-4444-555555555555.counter.json'),
    `${JSON.stringify({ batchId: 'batch-11111111-2222-3333-4444-555555555555', counter: 1 }, null, 2)}\n`,
    'utf8'
  );
}

async function runFinalize(ws: TmpWorkspace, argv: readonly string[]): Promise<{ envelope: FinalizeEnvelope; stderr: string }> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  registerFinalizeCommand(program, io);

  await program.parseAsync(
    ['finalize', '--project', ws.path, '--session-id', SESSION_ID, '--json', ...argv],
    { from: 'user' }
  );
  // The action body is a detached `void (async () => …)()`, so
  // `parseAsync` resolves before the envelope is printed. Wait for the
  // output instead of racing it.
  await vi.waitFor(() => {
    if (captured.stdout.length === 0) {
      throw new Error('finalize printed no envelope yet');
    }
  });

  const text = captured.stdout.join('\n');
  const start = text.indexOf('{');
  if (start < 0) throw new Error(`no JSON envelope in stdout: ${text}`);
  return { envelope: JSON.parse(text.slice(start)) as FinalizeEnvelope, stderr: captured.stderrText() };
}

let ws: TmpWorkspace;
let savedExitCode: string | number | null | undefined;

beforeEach(() => {
  ws = useTmpWorkspace('peaks-finalize-');
  savedExitCode = process.exitCode;
  process.exitCode = 0;
});

afterEach(() => {
  process.exitCode = savedExitCode;
  cleanupTmpWorkspace();
});

describe('peaks sub-agent finalize --request-id — the scan reads records only', () => {
  it('should resolve the record when non-record JSON files sit in the same directory', async () => {
    const recordPath = dispatchRecordFor(ws, TARGET_RID);
    seedNonRecordJson(ws);
    // `active-dispatches.json` is written by writeInitialDispatchRecord;
    // assert it really is there, so the fixture cannot silently stop
    // covering the file that caused the failure.
    expect(existsSync(join(subAgentDir(ws), 'active-dispatches.json'))).toBe(true);

    const { envelope } = await runFinalize(ws, ['--request-id', TARGET_RID]);

    expect(envelope.ok).toBe(true);
    expect(envelope.data?.errors).toEqual([]);
    expect(envelope.data?.finalized).toEqual([
      { recordPath, requestId: TARGET_RID, status: 'done' },
    ]);
    expect(process.exitCode).toBe(0);

    // the record on disk really moved out of `queued`
    const record = JSON.parse(readFileSync(recordPath, 'utf8')) as { status: string; outcome: string };
    expect(record.status).toBe('done');
    expect(record.outcome).toBe('success');
  });

  it('should not finalize a different request when several records coexist', async () => {
    const targetPath = dispatchRecordFor(ws, TARGET_RID);
    const otherPath = dispatchRecordFor(ws, OTHER_RID);
    seedNonRecordJson(ws);

    const { envelope } = await runFinalize(ws, ['--request-id', TARGET_RID]);

    expect(envelope.data?.finalized.map((entry) => entry.recordPath)).toEqual([targetPath]);
    const other = JSON.parse(readFileSync(otherPath, 'utf8')) as { status: string };
    expect(other.status).toBe('queued');
  });

  it('should still report RECORD_NOT_FOUND (and exit non-zero) for an unknown request id', async () => {
    dispatchRecordFor(ws, OTHER_RID);
    seedNonRecordJson(ws);

    const { envelope } = await runFinalize(ws, ['--request-id', 'no-such-request-id']);

    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('RECORD_NOT_FOUND');
    expect(process.exitCode).toBe(1);
  });

  it('should keep the --batch branch working alongside the same non-record files', async () => {
    const recordPath = dispatchRecordFor(ws, TARGET_RID);
    seedNonRecordJson(ws);

    const { envelope } = await runFinalize(ws, ['--batch', 'batch-11111111-2222-3333-4444-555555555555']);

    expect(envelope.ok).toBe(true);
    expect(envelope.data?.errors).toEqual([]);
    expect(envelope.data?.finalized.map((entry) => entry.recordPath)).toEqual([recordPath]);
  });
});

// ---------------------------------------------------------------------------
// N2 — one unreadable record must not abort the sweep.
//
// Filtering the two known non-record files by NAME closed the case that
// happened to be on disk, not the failure CLASS: `readRecord` was still called
// outside any try/catch, so a single stale/foreign `dispatch-*.json` threw
// straight past the per-record loop into the action's outer handler. Both
// `--request-id` and `--batch` then died with FINALIZE_ERROR and exit 1 having
// finalized nothing — the healthy records in the same directory were never
// reached.
// ---------------------------------------------------------------------------
describe('peaks sub-agent finalize — an unreadable record is skipped, not fatal (N2)', () => {
  it('should still finalize the healthy record when a stale dispatch record sits beside it (--request-id)', async () => {
    const recordPath = dispatchRecordFor(ws, TARGET_RID);
    const corruptPath = seedUnreadableDispatchRecord(ws);

    const { envelope } = await runFinalize(ws, ['--request-id', TARGET_RID]);

    // The sweep completed: the good record moved, the bad one is reported.
    expect(envelope.ok).toBe(true);
    expect(envelope.data?.finalized.map((entry) => entry.recordPath)).toEqual([recordPath]);
    expect(envelope.data?.errors).toHaveLength(1);
    expect(envelope.data?.errors[0]?.recordPath).toBe(corruptPath);

    const record = JSON.parse(readFileSync(recordPath, 'utf8')) as { status: string };
    expect(record.status).toBe('done');
    // Errors are still surfaced, so a silently-skipped record cannot hide.
    expect(process.exitCode).toBe(1);
  });

  it('should still finalize the healthy record when a stale dispatch record sits beside it (--batch)', async () => {
    const recordPath = dispatchRecordFor(ws, TARGET_RID);
    const corruptPath = seedUnreadableDispatchRecord(ws);

    const { envelope } = await runFinalize(ws, ['--batch', 'batch-11111111-2222-3333-4444-555555555555']);

    expect(envelope.ok).toBe(true);
    expect(envelope.data?.finalized.map((entry) => entry.recordPath)).toEqual([recordPath]);
    expect(envelope.data?.errors.map((entry) => entry.recordPath)).toEqual([corruptPath]);
  });

  it('should report RECORD_NOT_FOUND rather than crash when EVERY record is unreadable', async () => {
    seedUnreadableDispatchRecord(ws);

    const { envelope } = await runFinalize(ws, ['--request-id', TARGET_RID]);

    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('RECORD_NOT_FOUND');
    expect(process.exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// N3 — `--request-id` was status-blind and first-match-wins.
//
// It `break`ed on the FIRST filename carrying the requestId, with no `status`
// filter, so a re-dispatched request (this session held six records for
// `2026-09-12-defect-remediation`) always resolved to the OLDEST record. It
// finalized the already-`done` RD record, left the newer `queued` QA record in
// place, and still reported "All targeted records transitioned out of queued."
// `--batch` never had the bug — it filters on `queued`.
// ---------------------------------------------------------------------------
const EARLIER = (): Date => new Date('2026-09-12T06:08:03.210Z');
const LATER = (): Date => new Date('2026-09-12T06:43:01.509Z');

describe('peaks sub-agent finalize --request-id — same selection rule as --batch (N3)', () => {
  it('should prefer the queued record over an older finished one with the same requestId', async () => {
    const olderPath = dispatchRecordFor(ws, TARGET_RID, EARLIER);
    markCompleted({
      recordPath: olderPath,
      now: () => new Date('2026-09-12T06:20:00.000Z'),
      status: 'done',
      outcome: 'success',
      projectRoot: ws.path,
    });
    const queuedPath = dispatchRecordFor(ws, TARGET_RID, LATER);

    const { envelope } = await runFinalize(ws, ['--request-id', TARGET_RID]);

    // The QUEUED record is the one that moves; the finished one is untouched.
    expect(envelope.data?.finalized.map((entry) => entry.recordPath)).toEqual([queuedPath]);
    expect(process.exitCode).toBe(0);

    const older = JSON.parse(readFileSync(olderPath, 'utf8')) as { status: string };
    const queued = JSON.parse(readFileSync(queuedPath, 'utf8')) as { status: string };
    expect(older.status).toBe('done');
    expect(queued.status).toBe('done');

    // ...and the envelope says which record it chose and why the other lost.
    const selection = envelope.data?.selection;
    expect(selection?.chosen).toBe(queuedPath);
    expect(selection?.matched).toBe(2);
    expect(selection?.rejected).toHaveLength(1);
    expect(selection?.rejected[0]?.recordPath).toBe(olderPath);
    expect(selection?.rejected[0]?.reason).toContain('status is done');
    expect(selection?.rule).toContain('prefer status=queued');
  });

  it('should pick the NEWEST queued record when several are queued for one requestId', async () => {
    const olderPath = dispatchRecordFor(ws, TARGET_RID, EARLIER);
    const newerPath = dispatchRecordFor(ws, TARGET_RID, LATER);

    const { envelope } = await runFinalize(ws, ['--request-id', TARGET_RID]);

    expect(envelope.data?.finalized.map((entry) => entry.recordPath)).toEqual([newerPath]);
    const older = JSON.parse(readFileSync(olderPath, 'utf8')) as { status: string };
    expect(older.status).toBe('queued');
    expect(envelope.data?.skipped.map((entry) => entry.recordPath)).toContain(olderPath);
  });

  it('should finalize nothing (and say so) when every matching record has left queued', async () => {
    const donePath = dispatchRecordFor(ws, TARGET_RID, EARLIER);
    markCompleted({
      recordPath: donePath,
      now: () => new Date('2026-09-12T06:20:00.000Z'),
      status: 'done',
      outcome: 'success',
      projectRoot: ws.path,
    });

    const { envelope } = await runFinalize(ws, ['--request-id', TARGET_RID]);

    // No record is re-finalized — a terminal record is exactly what must not
    // be touched again — and the envelope does not claim otherwise.
    expect(envelope.data?.finalized).toEqual([]);
    expect(envelope.data?.selection?.chosen).toBeNull();
    expect(envelope.data?.skipped.map((entry) => entry.recordPath)).toEqual([donePath]);
    expect(process.exitCode).toBe(0);
  });

  it('should apply the queue-before-recency rule in the pure selector', () => {
    const candidate = (o: Partial<FinalizeCandidate>): FinalizeCandidate => ({
      recordPath: 'p',
      requestId: TARGET_RID,
      status: 'queued',
      createdAt: EARLIER().toISOString(),
      ...o,
    });
    // A newer DONE record never beats an older queued one.
    expect(
      selectFinalizeTarget([
        candidate({ recordPath: 'done-new', status: 'done', createdAt: LATER().toISOString() }),
        candidate({ recordPath: 'queued-old', createdAt: EARLIER().toISOString() }),
      ])?.recordPath
    ).toBe('queued-old');
    // Among equals, newest createdAt wins.
    expect(
      selectFinalizeTarget([
        candidate({ recordPath: 'queued-new', createdAt: LATER().toISOString() }),
        candidate({ recordPath: 'queued-old', createdAt: EARLIER().toISOString() }),
      ])?.recordPath
    ).toBe('queued-new');
    // Identical createdAt: the filename embeds the dispatch timestamp, so the
    // lexicographically greater path is still the newer dispatch.
    expect(
      selectFinalizeTarget([
        candidate({ recordPath: 'dispatch-a-2026-09-12T06-08-03-210Z.json' }),
        candidate({ recordPath: 'dispatch-a-2026-09-12T06-43-01-509Z.json' }),
      ])?.recordPath
    ).toBe('dispatch-a-2026-09-12T06-43-01-509Z.json');
    // Nothing queued -> nothing to do.
    expect(selectFinalizeTarget([candidate({ status: 'done' })])).toBeNull();
    expect(selectFinalizeTarget([])).toBeNull();
  });
});
