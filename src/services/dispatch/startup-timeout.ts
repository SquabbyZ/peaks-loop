/**
 * Slice 2026-07-29-dispatch-stall-governance / S1 — startup-timeout service.
 *
 * Why a separate module (vs adding the logic inline to
 * `dispatch-record-writer.ts`):
 *   - the writer is the on-disk format owner; the eval logic is a small
 *     pure function over a `DispatchRecord` snapshot.
 *   - keeps the writer surface unchanged (no extra `markStartupTimeout`
 *     method) so other consumers (heartbeat, watch, batch poller) do not
 *     have to learn a new mutation API.
 *   - a future `markStartupTimeout` writer helper, if added, would import
 *     this module's STARTUP_OUTCOME / DEFAULT_STARTUP_BUDGET_MS so the
 *     CLI help text and the eval share a single source of truth.
 *
 * Contract (see tests/unit/dispatch/startup-timeout.test.ts for the
 * pinned assertions):
 *
 *   evaluateStartupTimeout(record, now, opts) → StartupTimeoutEvaluation
 *
 *     - `outcome: 'within-budget' | 'never-started' | 'unreadable'`
 *     - `targetStatus: DispatchRecordStatus` — the status to write when
 *       `marked === true`. Distinct from `stale` (heartbeat seen, gone
 *       quiet) and from `no-execution` (the pre-slice silent default).
 *     - `marked: boolean` — whether the caller should write
 *       `targetStatus` to the record.
 *     - `reason: string` — short human-readable rationale, rendered in
 *       the watcher text line and in the dispatch envelope's
 *       `notes[]`.
 *
 *   DEFAULT_STARTUP_BUDGET_MS = 60_000
 *     - 1 order of magnitude above the measured 4–6s cold-start figure
 *       from .peaks/memory/2026-07-28-sub-agent-visibility-issue.md
 *     - well below the 5-minute heartbeat stale threshold so this
 *       fires first
 *     - configurable via opts.budgetMs
 *
 *   STARTUP_OUTCOME = { NEVER_STARTED: 'never-started', UNREADABLE:
 *   'unreadable' }
 *     - exported so the CLI help text, the watch command, and the
 *       reader's legacy fallback all reference the same strings.
 */
import type { DispatchRecord, DispatchRecordStatus } from './dispatch-record-writer.js';

/**
 * Default budget: 60s. 1 order of magnitude above the measured 4–6s
 * cold-start figure from .peaks/memory/2026-07-28-sub-agent-visibility-
 * issue.md; well below the 5-min heartbeat stale threshold so this
 * fires first.
 */
export const DEFAULT_STARTUP_BUDGET_MS = 60_000;

/**
 * String constants for the new terminal statuses. Distinct from the
 * pre-slice `stale` (heartbeat seen, then quiet) and `no-execution`
 * (legacy silent fallback). These are added to the writer's
 * `DispatchRecordStatus` union in the same slice; the constants here
 * are the canonical source so the CLI help / watch / writer all
 * reference the same strings.
 */
export const STARTUP_OUTCOME = {
  NEVER_STARTED: 'never-started',
  UNREADABLE: 'unreadable'
} as const;

export type StartupTimeoutOutcome = 'within-budget' | 'never-started' | 'unreadable';

export interface StartupTimeoutOptions {
  /** Override the default 60s budget. */
  readonly budgetMs?: number;
  /**
   * Test seam: when true, the record is treated as if its body is
   * corrupt (status field unparseable). The function returns
   * `{ outcome: 'unreadable', ... }` and recommends writing the
   * `unreadable` status. The CLI never sets this; the read path does.
   */
  readonly corrupt?: boolean;
}

export interface StartupTimeoutEvaluation {
  readonly outcome: StartupTimeoutOutcome;
  readonly marked: boolean;
  readonly targetStatus: DispatchRecordStatus;
  readonly reason: string;
  readonly ageMs: number;
  readonly budgetMs: number;
}

/**
 * Pure eval. Returns a typed triple; the caller decides whether to
 * write `targetStatus` to the record.
 */
export function evaluateStartupTimeout(
  record: DispatchRecord,
  now: () => Date = () => new Date(),
  options: StartupTimeoutOptions = {}
): StartupTimeoutEvaluation {
  const budgetMs = options.budgetMs ?? DEFAULT_STARTUP_BUDGET_MS;
  const safeBudget = Number.isFinite(budgetMs) && budgetMs > 0 ? budgetMs : DEFAULT_STARTUP_BUDGET_MS;
  const createdAt = parseIsoOrFallback(record.createdAt, now);
  const ageMs = Math.max(0, now().getTime() - createdAt.getTime());

  if (options.corrupt === true) {
    return {
      outcome: 'unreadable',
      marked: true,
      targetStatus: 'unreadable',
      reason: `record body is corrupt (status field unparseable) at age ${ageMs}ms`,
      ageMs,
      budgetMs: safeBudget
    };
  }

  // A record that already reached `running` (or beyond) is by definition
  // not a startup-timeout candidate. `stale` (heartbeat seen, then
  // quiet) is its own ladder; we do not reclassify it.
  if (record.status === 'running' || record.status === 'finalizing') {
    return {
      outcome: 'within-budget',
      marked: false,
      targetStatus: record.status,
      reason: `record is ${record.status} and not eligible for startup timeout`,
      ageMs,
      budgetMs: safeBudget
    };
  }

  // A terminal record is not eligible either (the marker functions own
  // the terminal transition; this evaluator is a read-only gate).
  const TERMINAL: readonly DispatchRecordStatus[] = [
    'done',
    'failed',
    'cancelled',
    'no-execution',
    'stale',
    'never-started',
    'unreadable'
  ];
  if (TERMINAL.includes(record.status)) {
    return {
      outcome: 'within-budget',
      marked: false,
      targetStatus: record.status,
      reason: `record is terminal (${record.status}) and not eligible for startup timeout`,
      ageMs,
      budgetMs: safeBudget
    };
  }

  if (ageMs < safeBudget) {
    return {
      outcome: 'within-budget',
      marked: false,
      targetStatus: record.status,
      reason: `record age ${ageMs}ms is within ${safeBudget}ms startup budget`,
      ageMs,
      budgetMs: safeBudget
    };
  }

  return {
    outcome: 'never-started',
    marked: true,
    targetStatus: 'never-started',
    reason: `record stayed ${record.status} for ${ageMs}ms (budget ${safeBudget}ms) without a first heartbeat`,
    ageMs,
    budgetMs: safeBudget
  };
}

function parseIsoOrFallback(iso: string, now: () => Date): Date {
  const d = new Date(iso);
  if (!Number.isNaN(d.getTime())) return d;
  return new Date(now().getTime());
}