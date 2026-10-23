// tests/unit/services/dispatch/dispatch-ledger-reader.test.ts
//
// The reader half of the auto-compact deferral: it reads one session's dispatch
// ledger and reports FACTS, and the pure probe turns them into the answer.
// This file pins the four facts the deferral is decided on — no ledger, a
// terminal record, a fresh record, a stale record — and the direction every
// unknown answers in.
//
// Dimensions covered:
//   - behavior:    what each ledger state reports
//   - integration: a real session dir, real dispatch records, real index file
//   - render:      not applicable (returns structured data)
//   - a11y:        not applicable (no user-visible text or exit code)

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { activeDispatchIndexPath } from '../../../../src/services/dispatch/active-dispatch-index.js';
import { readDispatchLedgerFacts } from '../../../../src/services/dispatch/dispatch-ledger-reader.js';
import {
  appendHeartbeat,
  markCompleted,
  markDisposed,
  writeInitialDispatchRecord
} from '../../../../src/services/dispatch/dispatch-record-writer.js';
import { probeInFlightBatch } from '../../../../src/services/workflow/workflow-inflight-probe.js';
import type { SubAgentToolCall } from '../../../../src/services/dispatch/sub-agent-dispatcher.js';

declareDimensions(
  'tests/unit/services/dispatch/dispatch-ledger-reader.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'returns structured data, no text surface' },
    { dim: 'a11y', reason: 'no user-visible text or exit code' }
  ]
);

const SESSION_ID = '2026-10-22-session-b0e6e2';
const MINUTE_MS = 60_000;
const TOOL_CALL: SubAgentToolCall = { name: 'Task', args: {} };

const roots: string[] = [];

function makeWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-ledger-reader-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** Write a real dispatch record (and its index row) stamped at `now`. */
function writeRecordAt(root: string, requestId: string, now: Date): string {
  return writeInitialDispatchRecord({
    projectRoot: root,
    sessionId: SESSION_ID,
    requestId,
    role: 'rd',
    prompt: `do ${requestId}`,
    toolCall: TOOL_CALL,
    batchId: 'batch-11111111-2222-3333-4444-555555555555',
    now: () => now
  }).path;
}

/** The reader's facts, plus the pure probe's answer about them. */
function readAndProbe(
  root: string,
  now: Date
): {
  readonly facts: ReturnType<typeof readDispatchLedgerFacts>;
  readonly inFlight: boolean;
} {
  const facts = readDispatchLedgerFacts({ projectRoot: root, sessionId: SESSION_ID });
  const out = probeInFlightBatch({ now: now.toISOString(), ledger: facts });
  return { facts, inFlight: out.inFlightBatch === true };
}

/** Point the session's index at one record path, whatever that path holds. */
function writeIndexRow(root: string, recordPath: string): void {
  const indexPath = activeDispatchIndexPath(root, SESSION_ID);
  mkdirSync(join(root, '.peaks', '_sub_agents', SESSION_ID), { recursive: true });
  writeFileSync(
    indexPath,
    `${JSON.stringify(
      {
        [recordPath]: {
          recordPath,
          requestId: 'rid-1',
          role: 'rd',
          batchId: 'batch-11111111-2222-3333-4444-555555555555',
          createdAt: new Date().toISOString(),
          status: 'queued'
        }
      },
      null,
      2
    )}\n`,
    'utf8'
  );
}

describe('Scenario: behavior — the four ledger states the deferral is decided on', () => {
  it('when the session has no ledger, should report no dispatch in flight', () => {
    // given: a session that never registered a dispatch
    const root = makeWorkspace();
    // when:  the ledger is read and the probe decides
    const { facts, inFlight } = readAndProbe(root, new Date());
    // then:  there is nothing to defer for
    expect(facts.ledgerState).toBe('absent');
    expect(inFlight).toBe(false);
  });

  it('when the record is terminal, should report no dispatch in flight', () => {
    // given: a dispatch that finished, with its index row still present
    const root = makeWorkspace();
    const now = new Date();
    const recordPath = writeRecordAt(root, 'rid-done', now);
    markCompleted({ recordPath, outcome: 'success', status: 'done' });
    // when:  the ledger is read and the probe decides
    const { facts, inFlight } = readAndProbe(root, now);
    // then:  the terminal record is not in flight
    expect(facts.ledgerState).toBe('readable');
    expect(facts.dispatches[0]?.kind).toBe('record');
    expect(inFlight).toBe(false);
  });

  it('when the record is fresh, should report a dispatch in flight', () => {
    // given: a dispatch that beat a minute ago
    const root = makeWorkspace();
    const now = new Date();
    const recordPath = writeRecordAt(root, 'rid-live', now);
    appendHeartbeat({
      recordPath,
      status: 'running',
      progress: 10,
      now: () => new Date(now.getTime() - MINUTE_MS)
    });
    // when:  the ledger is read and the probe decides
    const { facts, inFlight } = readAndProbe(root, now);
    // then:  the fresh dispatch is in flight
    expect(facts.dispatches[0]?.kind).toBe('record');
    expect(inFlight).toBe(true);
  });

  it('when the record is stale, should report no dispatch in flight', () => {
    // given: a dispatch whose last beat is older than the freshness window
    const root = makeWorkspace();
    const now = new Date();
    const recordPath = writeRecordAt(root, 'rid-stale', now);
    appendHeartbeat({
      recordPath,
      status: 'running',
      progress: 10,
      now: () => new Date(now.getTime() - 31 * MINUTE_MS)
    });
    // when:  the ledger is read and the probe decides
    const { inFlight } = readAndProbe(root, now);
    // then:  the stale dispatch is not in flight
    expect(inFlight).toBe(false);
  });
});

describe('Scenario: behavior — an unknown defers', () => {
  it('when a record cannot be read, should defer the compaction', () => {
    // given: an index row whose record file holds bytes that are not a record
    const root = makeWorkspace();
    const recordPath = join(
      root,
      '.peaks',
      '_sub_agents',
      SESSION_ID,
      'dispatch-rid-broken-2026-10-22T00-00-00-000Z.json'
    );
    mkdirSync(join(root, '.peaks', '_sub_agents', SESSION_ID), { recursive: true });
    writeFileSync(recordPath, '{ not json', 'utf8');
    writeIndexRow(root, recordPath);
    // when:  the ledger is read and the probe decides
    const { facts, inFlight } = readAndProbe(root, new Date());
    // then:  the answer is unknown, so the compaction defers
    expect(facts.dispatches[0]?.kind).toBe('unreadable');
    expect(inFlight).toBe(true);
  });

  it('when a record carries a status the probe does not know, should defer the compaction', () => {
    // given: a record whose status is not one the writer produces
    const root = makeWorkspace();
    const now = new Date();
    const recordPath = writeRecordAt(root, 'rid-odd', now);
    const record = JSON.parse(readFileSync(recordPath, 'utf8')) as Record<string, unknown>;
    record.status = 'hibernating';
    writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    // when:  the ledger is read and the probe decides
    const { facts, inFlight } = readAndProbe(root, now);
    // then:  the status is reported verbatim, so the probe can say it is unknown
    expect(facts.dispatches[0]?.kind).toBe('record');
    expect((facts.dispatches[0] as { status: string }).status).toBe('hibernating');
    expect(inFlight).toBe(true);
  });

  it('when the ledger index cannot be enumerated, should defer the compaction', () => {
    // given: an index file that holds bytes that are not an index
    const root = makeWorkspace();
    const indexPath = activeDispatchIndexPath(root, SESSION_ID);
    mkdirSync(join(root, '.peaks', '_sub_agents', SESSION_ID), { recursive: true });
    writeFileSync(indexPath, '{ not json', 'utf8');
    // when:  the ledger is read and the probe decides
    const { facts, inFlight } = readAndProbe(root, new Date());
    // then:  the answer is unknown, so the compaction defers
    expect(facts.ledgerState).toBe('unreadable');
    expect(inFlight).toBe(true);
  });

  it('when a record was disposed, should report no dispatch in flight', () => {
    // given: a record the reducer disposed of, with its index row still present
    const root = makeWorkspace();
    const now = new Date();
    const recordPath = writeRecordAt(root, 'rid-disposed', now);
    markDisposed(recordPath, () => now);
    // when:  the ledger is read and the probe decides
    const { facts, inFlight } = readAndProbe(root, now);
    // then:  a disposed dispatch is over
    expect((facts.dispatches[0] as { disposed: boolean }).disposed).toBe(true);
    expect(inFlight).toBe(false);
  });

  it('when the record file is gone, should report no dispatch in flight', () => {
    // given: an index row whose record file no longer exists
    const root = makeWorkspace();
    const recordPath = join(
      root,
      '.peaks',
      '_sub_agents',
      SESSION_ID,
      'dispatch-rid-gone-2026-10-22T00-00-00-000Z.json'
    );
    mkdirSync(join(root, '.peaks', '_sub_agents', SESSION_ID), { recursive: true });
    writeIndexRow(root, recordPath);
    // when:  the ledger is read and the probe decides
    const { facts, inFlight } = readAndProbe(root, new Date());
    // then:  the record IS the proof that a dispatch is running, and it is gone
    expect(facts.dispatches[0]?.kind).toBe('absent');
    expect(inFlight).toBe(false);
  });

  it('when the session id is not one path segment, should refuse to read outside the project', () => {
    // given: a session id that would point the reader outside the project root
    const root = makeWorkspace();
    // when:  the ledger is read for that id
    const facts = readDispatchLedgerFacts({
      projectRoot: root,
      sessionId: `..${sep}..${sep}outside`
    });
    // then:  nothing is read, and the answer is an unknown
    expect(facts.ledgerState).toBe('unreadable');
    expect(facts.dispatches).toEqual([]);
  });
});
