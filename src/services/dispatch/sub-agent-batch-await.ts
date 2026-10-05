/**
 * Slice `b1-filesplit-campaign` (wave 3) — verbatim extraction of the two
 * back-compat `awaitBatch` wrappers from `./sub-agent-dispatcher.ts`, so that
 * module clears the 300 raw-line cap. Both are thin wrappers around the unified
 * service in `./await-batch.ts`; neither body, default timeout, note prefix or
 * doc comment changed, and the dispatch-record file layout they read is the one
 * `./await-batch.ts#defaultReadOutcome` parses. `sub-agent-dispatcher.ts`
 * imports and re-exports both, so the per-IDE dispatchers keep calling them
 * through the same path and
 * `tests/unit/services/dispatch/sub-agent-dispatcher-timeouts.test.ts` keeps
 * observing the same per-IDE configuration through the same `vi.mock` seam.
 */

// Slice 2026-07-29-dispatch-stall-governance / S4 — the two near-
// identical poll loops in this file are now thin wrappers around
// `awaitBatch` (the unified implementation in ./await-batch.ts). The
// back-compat envelopes are preserved so the pre-S4 S3 character-
// ization tests + the existing call sites do not have to migrate in
// the same slice.
import { awaitBatch as awaitBatchUnified } from './await-batch.js';
import type { SubAgentAwaitBatchInput, SubAgentBatchResult } from './sub-agent-dispatcher-types.js';

/* ──────────────────────────────────────────────────────────────────────────
 * 2.7.0 slice-dag-dispatcher MVP (slice 1.2.a) — awaitBatch implementation
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Real awaitBatch for claude-code (MVP). In 1.2, dispatch + await are
 * both in the same process; we record the batch size and resolve after
 * `dispatchCount` heartbeats land for the given `recordPaths`, or after
 * `timeoutMs` elapses (per-dispatch `timeout` status).
 *
 * Implementation contract (MVP):
 *  - We poll each `recordPaths[i]` for an `outcome: success | failed` or
 *    `status: done | failed` field; if absent after `timeoutMs`, that
 *    dispatch is reported as `timeout`.
 *  - The poll interval is 50ms (fast enough for unit tests, cheap enough
 *    for the MVP; the real cross-process version uses heartbeat polling).
 */
export async function awaitClaudeCodeBatch(
  input: SubAgentAwaitBatchInput
): Promise<readonly SubAgentBatchResult[]> {
  // function is now a thin wrapper around the unified `awaitBatch`
  // service. The back-compat envelope shape is preserved (one
  // `SubAgentBatchResult` per record path) so the S3 characterization
  // test stays green; the underlying loop is identical to the trae /
  // codex / cursor wrappers below. The new typed outcome
  // lives on the unified service; the S4 fail-fast test pins it.
  //
  // per-IDE note prefix. The 1.4 dogfood contract says the done
  // note is `null` (raw outcome) and the failed note is the raw
  // `outcome` string with no prefix. The 3 non-Claude IDEs
  // (trae / codex / cursor) prefix the note with their
  // per-IDE label so cross-IDE attribution is visible to the LLM.
  // Passing no `notePrefix` here keeps the legacy contract.
  const unified = await awaitBatchUnified(input.dispatchCount, input.recordPaths, input.timeoutMs, {
    defaultTimeoutMs: 60_000
  });
  // Touch batchId so the parameter remains in scope for any future
  // in-process queue wiring.
  void input.batchId;
  return unified.results;
}

/**
 * Slice 1.3 — shared per-IDE polling core for trae / codex / cursor.
 * Same polling loop shape as `awaitClaudeCodeBatch`, with per-IDE
 * default timeout + note prefix. The 3 IDEs differ only in
 * (a) `defaultTimeoutMs` (Trae / Cursor = 30s, Codex = 45s per slice
 * #13 R-3) and (b) the `note` label surfaced when an IDE times out
 * (so 1.4 dogfood can attribute a timeout to the right IDE).
 *
 * MVP rationale (per Karpathy §2 Simplicity First): the 3 IDEs
 * currently share the same file-based polling transport. The only
 * per-IDE distinction is the timeout + label. Future per-IDE
 * divergence (real IPC / shell hooks) is a 1.4 dogfood concern —
 * here we keep the dispatcher interface uniform while each IDE's
 * `awaitBatch` is a real implementation.
 */
export interface PollDispatchRecordsOptions {
  readonly defaultTimeoutMs: number;
  readonly notePrefix: string;
}

export async function pollDispatchRecords(
  input: SubAgentAwaitBatchInput,
  opts: PollDispatchRecordsOptions
): Promise<readonly SubAgentBatchResult[]> {
  // function is now a thin wrapper around the unified `awaitBatch`
  // service. Pre-S4 it diverged from `awaitClaudeCodeBatch` in
  // (a) the default-fallback source and (b) the `Math.max(deadline, 0)`
  // step; the divergence is gone. The back-compat envelope (one
  // `SubAgentBatchResult` per record path, with the IDE-prefixed
  // note) is preserved.
  const unified = await awaitBatchUnified(input.dispatchCount, input.recordPaths, input.timeoutMs, {
    defaultTimeoutMs: opts.defaultTimeoutMs,
    notePrefix: opts.notePrefix
  });
  return unified.results;
}
