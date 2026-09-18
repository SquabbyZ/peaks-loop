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
import type { HeartbeatStatus } from '../../services/dispatch/dispatch-record-writer.js';
// Slice F2 (rid-f2-ac1-wiring) — first caller of the RD dispatch policy
// module. Before this wiring `src/services/rd/reviewer-dispatch-policy.ts`
// had zero importers in src/ + packages/ + scripts/ and the 2 slots it
// governs (`security-reviewer`, `perf-baseline-reviewer`) were neither
// rejected nor rerouted by anything on the dispatch path.
import { isDeprecatedReviewer } from '../../services/rd/reviewer-dispatch-policy.js';
// Slice 2026-07-29-dispatch-stall-governance / S6 — `probeShell` is
// re-exported here so the dispatch chokepoint (`dispatch-commands.ts`)
// and the sub-agent batch-sync wait can lazily acquire a typed
// shell-probe report without importing the env service at every
// call site. Codifies .peaks/memory/2026-07-27-windows-shell-pref.md
// at the dispatch / tool boundary (AC-6.2).
export { probeShell, type ShellProbeReport, type ShellProbeOptions } from '../../services/env/shell-probe.js';

export const RECOMMENDED_ROLES = 'rd | qa | ui | txt | qa-business | qa-perf | qa-security | qa-business-<*> | general-purpose';

// Slice 2026-07-29-dispatch-stall-governance / S2 — align the per-
// heartbeat vocabulary with the dispatch record's aggregate status
// union. The CLI --status help, the writer's isHeartbeatStatus guard,
// and this constant must stay byte-identical (the parity test in
// tests/unit/dispatch/heartbeat-parity.test.ts pins it). Adding
// `cancelled` / `no-execution` closes AC-2.1; adding `never-started`
// and `unreadable` closes the S1 status surface.
export const HEARTBEAT_STATUSES: readonly HeartbeatStatus[] = [
  'queued',
  'running',
  'finalizing',
  'done',
  'failed',
  'stale',
  'cancelled',
  'no-execution',
  'never-started',
  'unreadable'
];

export const PROMPT_LIMIT_BYTES = 256 * 1024;

export type DispatchOptions = {
  prompt?: string;
  promptLength?: string;
  requestId?: string;
  sessionId?: string;
  project?: string;
  batchId?: string;
  writeArtifact?: string;
  force?: boolean;
  fromDag?: string;
  /**
   * Slice 2026-07-29-worktree-l2-extended Part 2.C: dispatch isolation mode.
   * Only `worktree` is currently recognised. When set, dispatch
   * auto-spawns a worktree lease (delegates to `peaks worktree spawn`)
   * and injects `PEAKS_WORKTREE_LEASE_ID=<id>` into the dispatch
   * envelope so the receiving sub-agent can write to the lease's
   * worktree without needing a separate `peaks worktree auth grant`.
   */
  isolation?: string;
  /**
   * Slice 4.0.8 RD §4 (presence-lease-graph): required graph-node binding.
   * Empty / missing / wrong-kind rejects with PEAKS_GRAPH_NODE_REQUIRED /
   * PEAKS_GRAPH_NODE_NOT_PREPARED / PEAKS_GRAPH_NODE_KIND_INVALID.
   */
  graphNode?: string;
  workflowId?: string;
  graphRef?: string;
  /**
   * rid-001 detached sub-agent dispatch (slice 2026-08-11): dispatch
   * execution mode. `in-process` (default) keeps the existing warm-path
   * CLI dispatch; `detached` shells out to
   * `peaks-loop-internal-runtime/dispatch.dispatchDetached` for vendor
   * CLI execution. Default `in-process` preserves backward compat with
   * the 106+ existing dispatch call sites.
   */
  mode?: 'in-process' | 'detached';
  /**
   * rid-001 detached sub-agent dispatch: target vendor CLI when
   * --mode detached is selected. Only consulted in the detached path;
   * ignored in the default in-process path. Accepts `claude | codex
   * | copilot` (matches VendorAdapterRegistry).
   */
  vendor?: 'claude' | 'codex' | 'copilot';
  /**
   * rid-001 Task 11.5 budget ceiling: user-overrides ResourceBudgetGuard
   * when active concurrent fan-out would otherwise throttle detached
   * dispatch. The user accepts the risk; surfaces as `warnings[]` only.
   */
  noThrottle?: boolean;
  /**
   * rid-001 Task 11.5: override the per-tenant max-concurrent budget
   * (default 8). Effective in both detached (ResourceBudgetGuard) and
   * in-process (batch-counter) paths.
   */
  maxConcurrent?: string;
  /**
   * F5 follow-up (sediment 2026-08-11-rid-001-redo-fake-green-recovery-closure
   * §Lesson 1): frontmatter `--must-ls-files <glob>` flag. When set, the
   * dispatch CLI runs `git ls-files <glob>` upfront, surfaces
   * `mustLsFilesVerification: { path, exists, files }` in the envelope,
   * and prepends a `## must_ls_files enforcement` block to the sub-agent
   * prompt so the LLM's first action MUST verify the file exists before
   * claiming "PASS". Absent → unchanged behavior (backward compat with
   * the 106+ existing dispatch call sites).
   */
  mustLsFiles?: string;
  json?: boolean;
};

export type HeartbeatOptions = {
  record?: string;
  status?: string;
  progress?: string;
  note?: string;
  project?: string;
  graphNodeId?: string;
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
export type DagOrchestratorModule = typeof import('../../services/code/dag-orchestrator.js');
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
 * Slice F2 (rid-f2-ac1-wiring) — the dispatch-side twin of the prereq-side
 * back-compat in `artifact-prerequisites.ts` (`AUDIT_SECURITY` /
 * `AUDIT_PERF` accept `rd/security-review.md` / `rd/perf-baseline.md` via
 * `legacyRelativePaths`).
 *
 * `security-reviewer` and `perf-baseline-reviewer` left the RD 3-way
 * fan-out in v2.12.0 (`RD_DEPRECATED_REVIEWERS`), so a dispatch of either
 * name no longer runs a reviewer that exists. They are **accepted, not
 * rejected**, for two reasons:
 *   - the prereq side still accepts their legacy artifacts, so refusing
 *     the dispatch would make the two halves of the same deprecation
 *     disagree; and
 *   - `reviewer-dispatch-policy.ts` states the intended behaviour as
 *     "route to the new audit skill **instead of failing the gate**".
 *
 * The reroute is therefore advisory: the envelope carries this notice and
 * the caller takes it to `peaks-security-audit` / `peaks-perf-audit`.
 *
 * Returns `[]` for every other role, so dispatching a current role
 * produces the byte-identical envelope it produced before this wiring.
 */
export function deprecatedReviewerWarnings(role: string): string[] {
  if (!isDeprecatedReviewer(role)) {
    return [];
  }
  return [
    `role "${role}" was removed from the RD fan-out in v2.12.0 — reroute to the standalone audit skill ` +
      `(\`peaks security-audit run --rid <rid>\` / \`peaks perf-audit run --rid <rid>\`). The dispatch still ` +
      `proceeds for back-compat, and the legacy rd/security-review.md / rd/perf-baseline.md artifact stays ` +
      `accepted by the rd:qa-handoff prereq (artifact-prerequisites.ts legacyRelativePaths).`
  ];
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