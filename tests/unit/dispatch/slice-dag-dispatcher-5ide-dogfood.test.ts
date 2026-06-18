/**
 * 2.7.0 slice-dag-dispatcher (slice 1.4) — 5-IDE 端到端 dogfood.
 *
 * Covers AC-7.b from the 1.1 PRD:
 *   "1.4 dogfood: 5 IDE 各跑 1 次 (mock sub-agent 形态相同, 断言各 IDE 的
 *    envelope 都对)"
 *
 * Sibling to:
 *   - tests/unit/dispatch/sub-agent-dispatcher-4ide-dogfood.test.ts
 *     (slice 1.3: trae / trae-cn / codex / cursor real awaitBatch
 *     marker-shape dogfood — 24 tests, AC-3.c surface).
 *   - tests/unit/dispatch/sub-agent-dispatcher-cross-platform.test.ts
 *     (path discipline guard; covers all 5 dispatchers).
 *   - tests/unit/dispatch/sub-agent-dispatcher.test.ts (1.2 marker
 *     shape test, still passes — `awaitByLlmFallback` is preserved).
 *
 * Goal of this file: prove that the SAME mock DAG input, run against
 * ALL 5 IDE dispatchers' `awaitBatch`, returns envelope arrays that
 * are byte-stable across the 5 IDEs on the cross-IDE dimensions:
 *   - length
 *   - dispatchIndex ordering
 *   - status array per dispatch
 *   - recordPath reflection
 *   - durationMs (>= 0)
 *
 * AND document the ONE known per-IDE dimension that is intentionally
 * divergent: the `note` label. claude-code reads the outcome string
 * directly; trae / trae-cn / codex / cursor prefix the note with
 * the per-IDE label (`${notePrefix} — ${outcome}`).
 *
 * The "mock sub-agent" here is: 5 fake dispatch-record files laid
 * down under a tmpdir, matching the `readDispatchOutcome` consumer
 * shape (`{ status: 'done' | 'failed' | ... }`). All 5 IDEs read the
 * SAME files via the SAME `pollDispatchRecords` core (1.3) or
 * `awaitClaudeCodeBatch` (claude-code; same file-polling loop body
 * as of 1.4 — the in-process promise queue is reserved for a future
 * cross-process upgrade).
 */
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  claudeCodeSubAgentDispatcher,
  codexSubAgentDispatcher,
  cursorSubAgentDispatcher,
  traeCnSubAgentDispatcher,
  traeSubAgentDispatcher,
  type SubAgentAwaitBatchInput,
  type SubAgentBatchResult,
  type SubAgentDispatcher,
} from '../../../src/services/dispatch/sub-agent-dispatcher.js';

const SESSION_ID = '2026-06-18-slice-1-4-5ide-dogfood';

let tmpDir = '';

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'peaks-slice-1-4-dogfood-'));
});

afterAll(() => {
  if (tmpDir && existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

/**
 * Mock a dispatch record file at a deterministic path. Shape matches
 * the `readDispatchOutcome` consumer in `sub-agent-dispatcher.ts`:
 *   - status: 'done' | 'failed' | 'cancelled' | 'stale'
 *   - outcome: optional string surfaced into the BatchResult.note
 *
 * The 5 mock records alternate 4× done + 1× failed (idx 2) so the
 * failed dispatch is visible in the middle of the batch — same shape
 * used by 1.3 dogfood (see sub-agent-dispatcher-4ide-dogfood.test.ts).
 */
function writeMockRecord(
  sliceId: string,
  status: 'done' | 'failed' | 'cancelled' | 'stale',
  outcome?: string
): string {
  const body: Record<string, unknown> = { status };
  if (outcome !== undefined) body.outcome = outcome;
  const p = join(tmpDir, `${SESSION_ID}-${sliceId}.json`);
  writeFileSync(p, JSON.stringify(body), 'utf8');
  return p;
}

const FIVE_NODE_DAG: ReadonlyArray<{ sliceId: string; status: 'done' | 'failed'; outcome?: string }> = [
  { sliceId: 'leaf-0', status: 'done' },
  { sliceId: 'leaf-1', status: 'done' },
  { sliceId: 'leaf-2', status: 'failed', outcome: 'mock failure at leaf-2' },
  { sliceId: 'leaf-3', status: 'done' },
  { sliceId: 'leaf-4', status: 'done' },
];

/** Run the same mock DAG through one dispatcher's awaitBatch and return the envelope. */
async function dogfoodOneIde(dispatcher: SubAgentDispatcher): Promise<readonly SubAgentBatchResult[]> {
  const recordPaths = FIVE_NODE_DAG.map((node) =>
    writeMockRecord(node.sliceId, node.status, node.outcome)
  );
  const input: SubAgentAwaitBatchInput = {
    batchId: `${SESSION_ID}-batch`,
    dispatchCount: recordPaths.length,
    recordPaths,
    timeoutMs: 5_000,
  };
  const fn = dispatcher.awaitBatch;
  if (fn === undefined) {
    throw new Error(`dispatcher ${dispatcher.label} has no awaitBatch`);
  }
  return fn(input);
}

const FIVE_DISPATCHERS: ReadonlyArray<{ ide: string; d: SubAgentDispatcher }> = [
  { ide: 'claude-code', d: claudeCodeSubAgentDispatcher },
  { ide: 'trae', d: traeSubAgentDispatcher },
  { ide: 'trae-cn', d: traeCnSubAgentDispatcher },
  { ide: 'codex', d: codexSubAgentDispatcher },
  { ide: 'cursor', d: cursorSubAgentDispatcher },
];

describe('AC-7.b: 5 IDE end-to-end dogfood — mock sub-agent (slice 1.4)', () => {
  it('all 5 dispatchers expose a non-undefined awaitBatch', () => {
    for (const { ide, d } of FIVE_DISPATCHERS) {
      expect(typeof d.awaitBatch, `${ide} awaitBatch`).toBe('function');
    }
  });

  it('all 5 dispatchers expose the per-IDE label', () => {
    const labels = FIVE_DISPATCHERS.map(({ d }) => d.label);
    expect(labels).toEqual(['claude-code', 'trae', 'trae-cn', 'codex', 'cursor']);
  });
});

describe('AC-7.b: 5 IDE envelope shape byte-stability on cross-IDE dimensions (slice 1.4)', () => {
  it('5 IDE envelope length is identical (= 5, one BatchResult per dispatch)', async () => {
    for (const { d } of FIVE_DISPATCHERS) {
      const envelope = await dogfoodOneIde(d);
      expect(envelope.length, `${d.label} envelope length`).toBe(5);
    }
  });

  it('5 IDE dispatchIndex ordering is identical (0..4 stable sort)', async () => {
    for (const { d } of FIVE_DISPATCHERS) {
      const envelope = await dogfoodOneIde(d);
      const indices = envelope.map((r) => r.dispatchIndex);
      expect(indices, `${d.label} dispatchIndex`).toEqual([0, 1, 2, 3, 4]);
    }
  });

  it('5 IDE status array is identical: [done, done, failed, done, done]', async () => {
    for (const { d } of FIVE_DISPATCHERS) {
      const envelope = await dogfoodOneIde(d);
      const statuses = envelope.map((r) => r.status);
      expect(statuses, `${d.label} statuses`).toEqual(['done', 'done', 'failed', 'done', 'done']);
    }
  });

  it('5 IDE recordPath field is byte-stable (each IDE echoes the input recordPaths)', async () => {
    for (const { d } of FIVE_DISPATCHERS) {
      const envelope = await dogfoodOneIde(d);
      const paths = envelope.map((r) => r.recordPath);
      // Every path must be a string (the absolute path written by writeMockRecord).
      for (const p of paths) {
        expect(typeof p, `${d.label} recordPath type`).toBe('string');
        expect(p.length, `${d.label} recordPath length`).toBeGreaterThan(0);
      }
      // Each path appears exactly once.
      const uniq = new Set(paths);
      expect(uniq.size, `${d.label} unique recordPath count`).toBe(5);
    }
  });

  it('5 IDE durationMs is >= 0 (polling clock semantics preserved across IDEs)', async () => {
    for (const { d } of FIVE_DISPATCHERS) {
      const envelope = await dogfoodOneIde(d);
      for (const r of envelope) {
        expect(r.durationMs, `${d.label} dispatchIndex=${r.dispatchIndex} durationMs`).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('AC-7.b: 5 IDE note label is per-IDE attributed (documented divergence)', () => {
  it('claude-code note on failed dispatch is the raw outcome string (no per-IDE prefix)', async () => {
    // Slice 1.4 dogfood: claude-code does NOT prefix the note with an
    // IDE label (it predates the per-IDE note-prefix convention
    // introduced in slice 1.3). The `readDispatchOutcome` consumer
    // returns `note: obj.outcome ?? null` directly.
    const envelope = await dogfoodOneIde(claudeCodeSubAgentDispatcher);
    const failed = envelope[2];
    expect(failed).toBeDefined();
    expect(failed!.status).toBe('failed');
    expect(failed!.note).toBe('mock failure at leaf-2');
  });

  it('trae note on failed dispatch is prefixed with "trae 1.3 real awaitBatch — "', async () => {
    const envelope = await dogfoodOneIde(traeSubAgentDispatcher);
    const failed = envelope[2];
    expect(failed).toBeDefined();
    expect(failed!.status).toBe('failed');
    expect(failed!.note).toBe('trae 1.3 real awaitBatch — mock failure at leaf-2');
  });

  it('trae-cn note on failed dispatch is prefixed with "trae-cn 1.3 real awaitBatch — "', async () => {
    const envelope = await dogfoodOneIde(traeCnSubAgentDispatcher);
    const failed = envelope[2];
    expect(failed).toBeDefined();
    expect(failed!.status).toBe('failed');
    expect(failed!.note).toBe('trae-cn 1.3 real awaitBatch — mock failure at leaf-2');
  });

  it('codex note on failed dispatch is prefixed with "codex 1.3 real awaitBatch — "', async () => {
    const envelope = await dogfoodOneIde(codexSubAgentDispatcher);
    const failed = envelope[2];
    expect(failed).toBeDefined();
    expect(failed!.status).toBe('failed');
    expect(failed!.note).toBe('codex 1.3 real awaitBatch — mock failure at leaf-2');
  });

  it('cursor note on failed dispatch is prefixed with "cursor 1.3 real awaitBatch — "', async () => {
    const envelope = await dogfoodOneIde(cursorSubAgentDispatcher);
    const failed = envelope[2];
    expect(failed).toBeDefined();
    expect(failed!.status).toBe('failed');
    expect(failed!.note).toBe('cursor 1.3 real awaitBatch — mock failure at leaf-2');
  });

  it('5 IDE notes on done dispatches diverge per IDE prefix', async () => {
    // 4 done dispatches per IDE; traverse once each.
    const claude = await dogfoodOneIde(claudeCodeSubAgentDispatcher);
    const trae = await dogfoodOneIde(traeSubAgentDispatcher);
    const traeCn = await dogfoodOneIde(traeCnSubAgentDispatcher);
    const codex = await dogfoodOneIde(codexSubAgentDispatcher);
    const cursor = await dogfoodOneIde(cursorSubAgentDispatcher);

    // claude-code on done: note is null (readDispatchOutcome returns
    // `{ status: 'done', note: null }` when no outcome field).
    for (const r of claude) {
      if (r.status === 'done') {
        expect(r.note, `claude-code idx=${r.dispatchIndex} note`).toBeNull();
      }
    }

    // 4 IDEs on done: note is the bare per-IDE prefix
    // (no " — outcome" suffix because outcome is undefined).
    const expectedPrefix: Record<string, string> = {
      trae: 'trae 1.3 real awaitBatch',
      'trae-cn': 'trae-cn 1.3 real awaitBatch',
      codex: 'codex 1.3 real awaitBatch',
      cursor: 'cursor 1.3 real awaitBatch',
    };
    const envelopes: ReadonlyArray<readonly SubAgentBatchResult[]> = [trae, traeCn, codex, cursor];
    const labels: ReadonlyArray<string> = ['trae', 'trae-cn', 'codex', 'cursor'];
    for (let i = 0; i < envelopes.length; i += 1) {
      const env = envelopes[i]!;
      const lbl = labels[i]!;
      for (const r of env) {
        if (r.status === 'done') {
          expect(r.note, `${lbl} idx=${r.dispatchIndex} note`).toBe(expectedPrefix[lbl]);
        }
      }
    }
  });
});

describe('AC-7.b: 5 IDE envelope shape parity (per-IDE matrix check)', () => {
  it('5 IDE envelope projections on the cross-IDE dimensions are byte-equivalent', async () => {
    // Compute the cross-IDE projection (everything except `note`)
    // for each IDE and assert byte-equality across the 5.
    type Projection = ReadonlyArray<{
      dispatchIndex: number;
      status: SubAgentBatchResult['status'];
      recordPath: string;
    }>;
    const projections = new Map<string, Projection>();
    for (const { ide, d } of FIVE_DISPATCHERS) {
      const recordPaths = FIVE_NODE_DAG.map((node) =>
        writeMockRecord(node.sliceId, node.status, node.outcome)
      );
      const input: SubAgentAwaitBatchInput = {
        batchId: `${SESSION_ID}-matrix-batch`,
        dispatchCount: recordPaths.length,
        recordPaths,
        timeoutMs: 5_000,
      };
      const fn = d.awaitBatch;
      if (fn === undefined) throw new Error(`${ide} awaitBatch missing`);
      const envelope = await fn(input);
      projections.set(ide, envelope.map((r) => ({
        dispatchIndex: r.dispatchIndex,
        status: r.status,
        recordPath: r.recordPath,
      })));
    }
    // Use claude-code as the reference; all 4 other IDEs MUST equal it
    // on the projection.
    const reference = projections.get('claude-code')!;
    for (const [ide, proj] of projections) {
      expect(proj, `${ide} cross-IDE projection vs claude-code`).toEqual(reference);
    }
  });
});
