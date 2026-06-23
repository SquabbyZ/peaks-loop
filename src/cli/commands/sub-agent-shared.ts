/**
 * Shared types, constants, and helpers for the `peaks sub-agent` command group.
 *
 * Slice 2026-06-23-audit-p0-split — pulled out of `sub-agent-commands.ts` (968
 * lines) to honor the 800-line file cap (Karpathy #2 Simplicity First).
 *
 * Public exports:
 *   - `validateRole(role)` — exported because `sub-agent-commands.test.ts`
 *     and the integration suite rely on it as the source of truth for
 *     role-string validation.
 *
 * Everything else is internal to the `peaks sub-agent` group.
 */
import type { SubAgentBatchResult } from '../../services/dispatch/sub-agent-dispatcher.js';
import type { HeadroomMode } from '../../services/context/headroom-client.js';
import type { HeartbeatStatus } from '../../services/dispatch/dispatch-record-writer.js';

export const RECOMMENDED_ROLES = 'rd | qa | ui | txt | qa-business | qa-perf | qa-security | qa-business-<*> | general-purpose';

export const HEARTBEAT_STATUSES: readonly HeartbeatStatus[] = [
  'queued', 'running', 'finalizing', 'done', 'failed', 'stale'
];

export const HEADROOM_MODES: readonly HeadroomMode[] = ['balanced', 'aggressive', 'conservative'];

export const PROMPT_LIMIT_BYTES = 256 * 1024;

export type DispatchOptions = {
  prompt?: string;
  promptLength?: string;
  requestId?: string;
  sessionId?: string;
  project?: string;
  batchId?: string;
  writeArtifact?: string;
  useHeadroom?: boolean;
  headroomMode?: string;
  force?: boolean;
  fromDag?: string;
  json?: boolean;
};

export type HeartbeatOptions = {
  record?: string;
  status?: string;
  progress?: string;
  note?: string;
  project?: string;
  json?: boolean;
};

export type ShareOptions = {
  batch?: string;
  key?: string;
  value?: string;
  from?: string;
  requestId?: string;
  sessionId?: string;
  project?: string;
  json?: boolean;
};

export type SharedReadOptions = {
  batch?: string;
  since?: string;
  key?: string;
  requestId?: string;
  sessionId?: string;
  project?: string;
  json?: boolean;
};

export type AwaitOptions = {
  batch?: string;
  timeout?: string;
  project?: string;
  sessionId?: string;
  json?: boolean;
};

/**
 * Lazy-loaded module types — only resolved inside `runDispatchFromDag`
 * to keep the warm-path dispatch CLI cold-start fast (slice 9).
 */
export type SliceDagModule = typeof import('../../services/dispatch/slice-dag.js');
export type DagOrchestratorModule = typeof import('../../services/solo/dag-orchestrator.js');
export type ContractStoreModule = typeof import('../../services/dispatch/contract-store.js');

/**
 * Validate a role string. Returns `null` when valid, otherwise the
 * rejection reason (mirrors commander.js option-validation shape so
 * the action handler can pass it straight to `fail()`).
 *
 * Rules (per dispatch CLI spec):
 *   - Non-empty
 *   - ≤ 256 chars
 *   - No whitespace, no control characters, no DEL (0x7F)
 */
export function validateRole(role: string): string | null {
  if (typeof role !== 'string' || role.length === 0) {
    return 'role must be a non-empty string';
  }
  if (role.length > 256) {
    return 'role must be ≤ 256 chars';
  }
  for (let i = 0; i < role.length; i += 1) {
    const code = role.charCodeAt(i);
    if (code <= 0x20 || code === 0x7F) {
      return 'role must not contain whitespace or control characters';
    }
  }
  return null;
}

/**
 * Roll up a batch result array into the summary the CLI envelope exposes
 * for `peaks sub-agent await`. Counts per status; the orchestrator
 * surface (`SubAgentBatchResult.status`) is a closed set so a single
 * `for` loop with `if/else if` is faster and clearer than a reduce.
 */
export function summarizeBatchResults(results: readonly SubAgentBatchResult[]): {
  readonly total: number;
  readonly done: number;
  readonly failed: number;
  readonly cancelled: number;
  readonly timeout: number;
} {
  let done = 0;
  let failed = 0;
  let cancelled = 0;
  let timeout = 0;
  for (const r of results) {
    if (r.status === 'done') done += 1;
    else if (r.status === 'failed') failed += 1;
    else if (r.status === 'cancelled') cancelled += 1;
    else timeout += 1;
  }
  return { total: results.length, done, failed, cancelled, timeout };
}

// Note: `isHeadroomMode` and `RegisterSubCommand` used to live here as
// duplicate exports. Removed in slice 2026-06-23-audit-p0-cleanup:
//   - `isHeadroomMode` is exported by `src/services/context/headroom-prefs.ts`
//     and that is the canonical source — dispatch consumer imports from
//     there directly.
//   - `RegisterSubCommand` was never used as a type anywhere; the entry
//     point (`sub-agent-commands.ts`) calls each register function with
//     `(program, io)` directly.
//   - `deriveProjectRoot` (audit-p0-reaudit) was removed in slice
//     2026-06-23-audit-3rd: it trusted the record path's `.peaks` segment,
//     letting a caller point `--record` at any project's record tree. The
//     heartbeat command now trusts `--project` (or `process.cwd()`) and
//     leaves the relative() backstop to the R-2 guard.
