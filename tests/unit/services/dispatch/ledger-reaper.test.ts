// tests/unit/services/dispatch/ledger-reaper.test.ts
//
// The dispatch ledger had no reaper. Measured 2026-10-12 across four sessions,
// `queued`/total was 39/39, 2/2, 9/9, 23/23 — not one record in any session had
// been finalized, and the recovery verb built for exactly this (`peaks
// sub-agent finalize --all-stale`) was never called. This file pins the bound
// the tooling now applies at the next dispatch write, and the two directions
// that bound has to tell apart: an abandoned record is reaped, a live one is
// not.
//
// Dimensions covered:
//   - behavior:    reap vs keep, decided by age and by status
//   - integration: real session dir, real dispatch records, real index file
//   - render:      not applicable (returns structured data)
//   - a11y:        not applicable (no user-visible text or exit code)

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import {
  activeDispatchIndexPath,
  readActiveDispatchIndex
} from '../../../../src/services/dispatch/active-dispatch-index.js';
import {
  LEDGER_REAP_BOUND_MS,
  reapStaleQueuedEntries
} from '../../../../src/services/dispatch/ledger-reaper.js';
import {
  appendHeartbeat,
  markCompleted,
  readRecordStatus,
  writeInitialDispatchRecord
} from '../../../../src/services/dispatch/dispatch-record-writer.js';
import { readActiveLeaf } from '../../../../src/services/skills/skill-statusline-model.js';
import type { SubAgentToolCall } from '../../../../src/services/dispatch/sub-agent-dispatcher.js';

declareDimensions(
  'tests/unit/services/dispatch/ledger-reaper.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'returns structured data, no text surface' },
    { dim: 'a11y', reason: 'no user-visible text or exit code' }
  ]
);

const SESSION_ID = '2026-10-12-session-74bd69';
const HOUR_MS = 3_600_000;
const TOOL_CALL: SubAgentToolCall = { name: 'Task', args: {} };

const roots: string[] = [];

function makeWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-ledger-reaper-'));
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

/** Overwrite one index row's status, to model a row a terminal writer touched. */
function patchIndexStatus(root: string, recordPath: string, status: string): void {
  const indexPath = activeDispatchIndexPath(root, SESSION_ID);
  const index = JSON.parse(readFileSync(indexPath, 'utf8')) as Record<string, { status: string }>;
  const existing = index[recordPath];
  expect(existing, 'the fixture row must exist before it is patched').toBeDefined();
  index[recordPath] = { ...existing, status };
  writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
}

function readStatus(recordPath: string): string {
  return (JSON.parse(readFileSync(recordPath, 'utf8')) as { status: string }).status;
}

/** The production wiring: the writer's own terminal transition and its reader. */
function reapNow(root: string, now?: Date): readonly string[] {
  return reapStaleQueuedEntries({
    projectRoot: root,
    sessionId: SESSION_ID,
    ...(now !== undefined ? { now: () => now } : {}),
    readStatus: readRecordStatus,
    finalize: (recordPath) =>
      markCompleted({
        recordPath,
        outcome: 'no-execution',
        status: 'no-execution',
        projectRoot: root
      })
  }).reaped;
}

describe('Scenario: behavior — an abandoned record is reaped', () => {
  it('when a queued entry is older than the bound, should finalize its record and drop its index row', () => {
    // given: a record left `queued` for longer than the bound — the input this
    //        check exists to reject
    const root = makeWorkspace();
    const stalePath = writeRecordAt(root, 'rid-stale', new Date(Date.now() - 7 * HOUR_MS));
    expect(readStatus(stalePath)).toBe('queued');
    expect(readActiveDispatchIndex(root, SESSION_ID)[stalePath]).toBeDefined();
    // when:  the reaper runs
    const reaped = reapNow(root);
    // then:  the record itself reached a terminal state and the row is gone
    expect(reaped).toContain(stalePath);
    expect(readStatus(stalePath)).toBe('no-execution');
    expect(readActiveDispatchIndex(root, SESSION_ID)[stalePath]).toBeUndefined();
  });

  it('when the index names a record that is gone, should drop the row without throwing', () => {
    // given: an index row whose record file is absent from disk
    const root = makeWorkspace();
    const missingPath = join(
      root,
      '.peaks',
      '_sub_agents',
      SESSION_ID,
      'dispatch-rid-gone-2026-10-12T00-00-00-000Z.json'
    );
    mkdirSync(join(root, '.peaks', '_sub_agents', SESSION_ID), { recursive: true });
    writeFileSync(
      activeDispatchIndexPath(root, SESSION_ID),
      `${JSON.stringify(
        {
          [missingPath]: {
            recordPath: missingPath,
            requestId: 'rid-gone',
            role: 'rd',
            batchId: 'batch-1',
            createdAt: new Date(Date.now() - 7 * HOUR_MS).toISOString(),
            status: 'queued'
          }
        },
        null,
        2
      )}\n`,
      'utf8'
    );
    // when:  the reaper runs
    const reaped = reapNow(root);
    // then:  the dangling row is removed rather than left to accumulate
    expect(reaped).toEqual([missingPath]);
    expect(existsSync(activeDispatchIndexPath(root, SESSION_ID))).toBe(true);
    expect(readActiveDispatchIndex(root, SESSION_ID)).toEqual({});
  });

  it('when an index row names a path outside the sub-agents directory, should drop the row and not write there', () => {
    // given: a row pointing at a real JSON file that is NOT a dispatch record
    //        and does not live in the ledger — the input this guard exists to
    //        reject, since the reaper writes to whatever path the row names
    const root = makeWorkspace();
    const victim = join(root, 'important.json');
    writeFileSync(victim, JSON.stringify({ keep: 'me' }), 'utf8');
    const dir = join(root, '.peaks', '_sub_agents', SESSION_ID);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      activeDispatchIndexPath(root, SESSION_ID),
      `${JSON.stringify(
        {
          [victim]: {
            recordPath: victim,
            requestId: 'rid-escape',
            role: 'rd',
            batchId: 'batch-1',
            createdAt: new Date(Date.now() - 7 * HOUR_MS).toISOString(),
            status: 'queued'
          }
        },
        null,
        2
      )}\n`,
      'utf8'
    );
    // when:  the reaper runs
    const reaped = reapNow(root);
    // then:  the row is gone and the file it named is byte-identical
    expect(reaped).toEqual([victim]);
    expect(readFileSync(victim, 'utf8')).toBe(JSON.stringify({ keep: 'me' }));
    expect(readActiveDispatchIndex(root, SESSION_ID)).toEqual({});
  });
});

describe('Scenario: behavior — a live record is not reaped', () => {
  it('when a queued entry is younger than the bound, should leave it alone', () => {
    // given: a dispatch issued five minutes ago — still in flight
    const root = makeWorkspace();
    const freshPath = writeRecordAt(root, 'rid-fresh', new Date(Date.now() - 5 * 60_000));
    // when:  the reaper runs
    const reaped = reapNow(root);
    // then:  it is untouched, in the record and in the index
    expect(reaped).toEqual([]);
    expect(readStatus(freshPath)).toBe('queued');
    expect(readActiveDispatchIndex(root, SESSION_ID)[freshPath]).toBeDefined();
  });

  it('when an entry is not queued, should leave it alone however old it is', () => {
    // given: an old row whose status says the dispatch is under way
    const root = makeWorkspace();
    const runningPath = writeRecordAt(root, 'rid-running', new Date(Date.now() - 7 * HOUR_MS));
    patchIndexStatus(root, runningPath, 'running');
    // when:  the reaper runs
    const reaped = reapNow(root);
    // then:  age alone does not reap a dispatch that is not queued, and the
    //        status line still resolves it as the live leaf
    expect(reaped).toEqual([]);
    expect(readActiveDispatchIndex(root, SESSION_ID)[runningPath]?.status).toBe('running');
    expect(readActiveLeaf(root, SESSION_ID)?.role).toBe('rd');
  });

  it('when the RECORD is running and its index row still reads queued, should not reap the live dispatch', () => {
    // given: the shape production actually produces — a sub-agent that has
    //        heartbeated, so the RECORD is `running`, while its index row still
    //        reads `queued` (nothing writes a mid-flight status into a row).
    //        This is the input a row-keyed guard cannot see.
    const root = makeWorkspace();
    const livePath = writeRecordAt(root, 'rid-live', new Date(Date.now() - 7 * HOUR_MS));
    appendHeartbeat({ recordPath: livePath, status: 'running', progress: 20 });
    appendHeartbeat({ recordPath: livePath, status: 'running', progress: 40 });
    expect(readStatus(livePath)).toBe('running');
    expect(readActiveDispatchIndex(root, SESSION_ID)[livePath]?.status).toBe('queued');
    // when:  the reaper runs
    const reaped = reapNow(root);
    // then:  the live dispatch is untouched: not reaped, no terminal status, and
    //        its row survives
    expect(reaped).toEqual([]);
    expect(readStatus(livePath)).toBe('running');
    expect(readActiveDispatchIndex(root, SESSION_ID)[livePath]).toBeDefined();
  });

  it('when the RECORD is still queued and stale, should reap it (the control for the live arm)', () => {
    // given: the same 7-hour age, the same `queued` row, but a record that has
    //        never heartbeated — the only shape the reaper may act on
    const root = makeWorkspace();
    const stalePath = writeRecordAt(root, 'rid-stale', new Date(Date.now() - 7 * HOUR_MS));
    expect(readStatus(stalePath)).toBe('queued');
    // when:  the reaper runs
    const reaped = reapNow(root);
    // then:  it is finalized, so the age bound still bites
    expect(reaped).toEqual([stalePath]);
    expect(readStatus(stalePath)).toBe('no-execution');
    expect(readActiveDispatchIndex(root, SESSION_ID)[stalePath]).toBeUndefined();
  });

  it('when a stale row is reaped, should drop the index row it came from', () => {
    // given: a session whose only index row is abandoned. NOTE what this arm
    //        does and does not prove: `readActiveLeaf` already treats `queued`
    //        as terminal, so the row was not a leaf BEFORE the reap either —
    //        this asserts the row is gone, not that a phantom disappeared.
    const root = makeWorkspace();
    const stalePath = writeRecordAt(root, 'rid-stale', new Date(Date.now() - 7 * HOUR_MS));
    expect(readActiveLeaf(root, SESSION_ID)).toBeNull();
    // when:  the reaper runs
    const reaped = reapNow(root);
    // then:  the row is gone from the index the status line reads
    expect(reaped).toEqual([stalePath]);
    expect(readActiveDispatchIndex(root, SESSION_ID)[stalePath]).toBeUndefined();
    expect(readActiveLeaf(root, SESSION_ID)).toBeNull();
  });
});

describe('Scenario: integration — the bound is applied at the next dispatch write', () => {
  it('when a dispatch is written after the bound, should reap the stale rows as it registers', () => {
    // given: one abandoned record already in the ledger
    const root = makeWorkspace();
    const stalePath = writeRecordAt(root, 'rid-stale', new Date(Date.now() - 7 * HOUR_MS));
    // when:  the next dispatch is written — no caller asked for a sweep
    const freshPath = writeRecordAt(root, 'rid-fresh', new Date());
    // then:  the abandoned row was finalized by the tooling, and the new
    //        dispatch registered normally
    expect(readStatus(stalePath)).toBe('no-execution');
    const index = readActiveDispatchIndex(root, SESSION_ID);
    expect(index[stalePath]).toBeUndefined();
    expect(index[freshPath]?.status).toBe('queued');
  });

  it('when the ledger is younger than the bound, should change nothing', () => {
    // given: two dispatches from the same five minutes
    const root = makeWorkspace();
    const first = writeRecordAt(root, 'rid-a', new Date(Date.now() - 5 * 60_000));
    const second = writeRecordAt(root, 'rid-b', new Date());
    // when:  the second write triggered the reap
    // then:  the ledger is exactly the two rows it registered
    expect(readStatus(first)).toBe('queued');
    expect(Object.keys(readActiveDispatchIndex(root, SESSION_ID)).sort()).toEqual(
      [first, second].sort()
    );
  });

  it('when the bound is measured, should be the documented six hours', () => {
    // given: the exported bound
    // when:  it is compared with its stated derivation
    // then:  the number the gate would reap on is the number the code states
    expect(LEDGER_REAP_BOUND_MS).toBe(6 * HOUR_MS);
  });
});
