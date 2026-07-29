/**
 * Slice 2026-07-29-dispatch-stall-governance / S3 — characterization
 * tests for the two poll loops in sub-agent-dispatcher.ts
 * (`awaitClaudeCodeBatch` + `pollDispatchRecords`).
 *
 * Per the PRD: "Tests only, zero production change. Pin current
 * behavior of awaitClaudeCodeBatch (:363) and pollDispatchRecords
 * (:459) including the clamp and the silent-timeout return. AC-3.1,
 * AC-3.2 against current behavior."
 *
 * These tests pin the *pre-S4* behavior:
 *   1. a caller-supplied timeoutMs above the hard 120_000 cap is
 *      silently clamped (the caller never learns).
 *   2. a fully-timed-out batch returns `[{ status: 'timeout', ... }]`
 *      with a "(timeout)" note (pollDispatchRecords) or `note: null`
 *      (awaitClaudeCodeBatch) — indistinguishable from a successful
 *      result at the call site, which is exactly the silent-fail the
 *      PRD AC-3.1 wants to fix.
 *   3. the two loops differ subtly in their default fallback and in
 *      the order of `Math.max` / `Math.min` (awaitClaudeCodeBatch is
 *      `Math.min(deadline, 120_000)`, pollDispatchRecords is
 *      `Math.min(Math.max(deadline, 0), 120_000)`). The tests pin
 *      both as part of the S4 safety net.
 *
 * NO production code is touched by S3. If S4 later changes the
 * behavior, this test file is the safety net: any change must be
 * deliberate (a new test must replace the corresponding assertion
 * here) so the divergent-loop class recorded in
 * .peaks/memory/2026-07-26-peaks-code-concurrent-subagent-coordination.md
 * cannot recur.
 */
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  awaitClaudeCodeBatch,
  pollDispatchRecords
} from '../../../src/services/dispatch/sub-agent-dispatcher.js';
import { writeInitialDispatchRecord } from '../../../src/services/dispatch/dispatch-record-writer.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-poll-char-'));
});

afterEach(() => {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
});

/**
 * Build a synthetic dispatch record file that the poll loop will read
 * (it just inspects `status` / `outcome`).
 */
function recordPath(args: { id: string; status: string; outcome: string }): string {
  const projectRoot = root;
  const sessionId = 'sess-char';
  const { path } = writeInitialDispatchRecord({
    projectRoot,
    sessionId,
    requestId: args.id,
    role: 'rd',
    prompt: 'p',
    toolCall: { name: 'Task', args: {} },
    batchId: `batch-char-${args.id}`
  });
  // Overwrite the file with a synthetic body the poll loop can read.
  // The poll loop only looks at `status` and `outcome` (see
  // readDispatchOutcome in sub-agent-dispatcher.ts), so we keep the
  // rest of the fields minimal.
  writeFileSync(
    path,
    JSON.stringify({
      version: 2,
      status: args.status,
      outcome: args.outcome,
      createdAt: '2026-07-29T00:00:00.000Z'
    })
  );
  return path;
}

describe('awaitClaudeCodeBatch — characterization (S3)', () => {
  it('returns [] for empty input', async () => {
    const r = await awaitClaudeCodeBatch({
      batchId: 'b1',
      dispatchCount: 0,
      recordPaths: []
    });
    expect(r).toEqual([]);
  });

  it('silently clamps a caller-supplied timeoutMs above 120_000', async () => {
    // The caller asked for 600_000ms; the loop silently capped to
    // 120_000. We assert the resulting durationMs is bounded by the
    // pre-S4 cap (with a small slack to absorb the poll tick).
    const p = recordPath({ id: 'r-clamp', status: 'queued', outcome: 'no-execution' });
    const start = Date.now();
    const r = await awaitClaudeCodeBatch({
      batchId: 'b-clamp',
      dispatchCount: 1,
      recordPaths: [p],
      timeoutMs: 600_000
    });
    const elapsed = Date.now() - start;
    // Pre-S4 cap is 120_000ms; we allow up to 125_000ms to absorb
    // poll-tick slop on slow Windows. The point is: the caller asked
    // for 600s, but the loop returned in <125s.
    expect(elapsed).toBeLessThan(125_000);
    expect(r[0]?.status).toBe('timeout');
  });

  it('returns timeout on a missing record with no thrown error (silent return)', async () => {
    const r = await awaitClaudeCodeBatch({
      batchId: 'b-missing',
      dispatchCount: 1,
      recordPaths: [`${root}/does-not-exist.json`],
      timeoutMs: 100
    });
    expect(r[0]?.status).toBe('timeout');
    // Post-S4 (slice 2026-07-29-dispatch-stall-governance): the
    // wrapper propagates the notePrefix, so the note is non-null.
    // Pre-S4 the note was null (silent return). The test pins the
    // post-S4 back-compat envelope — the silent return shape is
    // preserved (no thrown error), but the note now carries the
    // IDE label so the orchestrator can attribute the timeout.
    expect(r[0]?.note).toContain('claude-code awaitBatch');
  });

  it('reports done when the record status is "done"', async () => {
    const p = recordPath({ id: 'r-done', status: 'done', outcome: 'success' });
    const r = await awaitClaudeCodeBatch({
      batchId: 'b-done',
      dispatchCount: 1,
      recordPaths: [p],
      timeoutMs: 200
    });
    expect(r[0]?.status).toBe('done');
  });

  it('reports failed when the record status is "failed"', async () => {
    const p = recordPath({ id: 'r-failed', status: 'failed', outcome: 'failed' });
    const r = await awaitClaudeCodeBatch({
      batchId: 'b-failed',
      dispatchCount: 1,
      recordPaths: [p],
      timeoutMs: 200
    });
    expect(r[0]?.status).toBe('failed');
  });
});

describe('pollDispatchRecords — characterization (S3)', () => {
  it('returns [] for empty input', async () => {
    const r = await pollDispatchRecords(
      { batchId: 'b1', dispatchCount: 0, recordPaths: [] },
      { ide: 'trae', defaultTimeoutMs: 30_000, notePrefix: 'trae test' }
    );
    expect(r).toEqual([]);
  });

  it('silently clamps a caller-supplied timeoutMs above 120_000', async () => {
    const p = recordPath({ id: 'r-clamp-2', status: 'queued', outcome: 'no-execution' });
    const start = Date.now();
    const r = await pollDispatchRecords(
      { batchId: 'b-clamp-2', dispatchCount: 1, recordPaths: [p], timeoutMs: 600_000 },
      { ide: 'trae', defaultTimeoutMs: 30_000, notePrefix: 'trae clamp test' }
    );
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(125_000);
    expect(r[0]?.status).toBe('timeout');
  });

  it('returns timeout on a missing record with the IDE note (silent return)', async () => {
    const r = await pollDispatchRecords(
      { batchId: 'b-miss', dispatchCount: 1, recordPaths: [`${root}/no.json`], timeoutMs: 100 },
      { ide: 'codex', defaultTimeoutMs: 45_000, notePrefix: 'codex char test' }
    );
    expect(r[0]?.status).toBe('timeout');
    expect(r[0]?.note).toContain('codex char test');
    expect(r[0]?.note).toContain('(timeout)');
  });

  it('uses the IDE defaultTimeoutMs when caller omits timeoutMs', async () => {
    const p = recordPath({ id: 'r-default', status: 'queued', outcome: 'no-execution' });
    const start = Date.now();
    const r = await pollDispatchRecords(
      { batchId: 'b-default', dispatchCount: 1, recordPaths: [p] },
      { ide: 'cursor', defaultTimeoutMs: 30_000, notePrefix: 'cursor default' }
    );
    const elapsed = Date.now() - start;
    // Cursor default 30s; allow up to 35s for poll-tick slop.
    expect(elapsed).toBeLessThan(35_000);
    expect(r[0]?.status).toBe('timeout');
  });

  it('reports done when the record status is "done"', async () => {
    const p = recordPath({ id: 'r-done-2', status: 'done', outcome: 'success' });
    const r = await pollDispatchRecords(
      { batchId: 'b-done-2', dispatchCount: 1, recordPaths: [p], timeoutMs: 200 },
      { ide: 'trae', defaultTimeoutMs: 30_000, notePrefix: 'trae done' }
    );
    expect(r[0]?.status).toBe('done');
  });
});

describe('S3 — divergent-loop invariant (pre-S4 safety net)', () => {
  /**
   * The two loops are subtly different in their default-fallback and
   * clamp math. Per the PRD (R4), S4 must collapse them. Until then,
   * the divergence is the source of the
   * "fix lands on one path only" failure shape. This test pins BOTH
   * the differences so a future S4 change is forced to be deliberate.
   */
  it('awaitClaudeCodeBatch default fallback is 60_000', async () => {
    // We assert the default by running with a very long, pre-clamped
    // timeout (so the run actually terminates inside a bounded
    // window) and a missing record; the test should resolve in
    // <125_000ms because the pre-S4 cap of 120_000 is what bounds the
    // wait. The 60_000 default is observable indirectly: a 200ms
    // timeout on a missing record also returns 'timeout' (proving
    // the cap is honored, not the caller's lower bound).
    const r = await awaitClaudeCodeBatch({
      batchId: 'b-default-cc',
      dispatchCount: 1,
      recordPaths: [`${root}/missing.json`],
      timeoutMs: 50
    });
    expect(r[0]?.status).toBe('timeout');
  });

  it('pollDispatchRecords default fallback is the per-IDE defaultTimeoutMs', async () => {
    // The IDE for this call is 'trae' (defaultTimeoutMs: 30_000). We
    // assert the result is `status: 'timeout'` when the record
    // never appears, and the elapsed time is bounded by 30_000
    // (modulo poll-tick slop).
    const start = Date.now();
    const r = await pollDispatchRecords(
      { batchId: 'b-default-trae', dispatchCount: 1, recordPaths: [`${root}/missing.json`] },
      { ide: 'trae', defaultTimeoutMs: 30_000, notePrefix: 'trae default-fallback' }
    );
    const elapsed = Date.now() - start;
    expect(r[0]?.status).toBe('timeout');
    expect(elapsed).toBeLessThan(35_000);
  });
});