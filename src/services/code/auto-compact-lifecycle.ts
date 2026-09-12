/**
 * Auto-compact lifecycle telemetry (v2.13.0 AC-2 + AC-3 + AC-4,
 * slice 2026-08-01-compact-lifecycle Task 5).
 *
 * Extracted from `auto-compact-orchestrator.ts` to keep that file under
 * the 800 LOC cap (mechanical verbatim move). Publishes the stages a
 * compact attempt actually PROVED in-process (`queued` / `preparing` /
 * `compacting`) plus the terminal `failed` stage, and settles an open
 * `compacting` run using a real post-compact measurement. Telemetry is
 * strictly subordinate to the compact itself: every write is best-effort
 * and never changes the threshold decision, the dispatch, or the
 * returned envelope.
 */
import {
  readCompactLifecycle,
  writeCompactLifecycle,
  type CompactLifecycleRecord,
  type CompactLifecycleStage
} from '../compact-statusline/compact-lifecycle-store.js';
import { AUTO_COMPACT_RED_LINE_RATIO } from '../context/auto-compact-types.js';

/**
 * Stages a compact *attempt* can prove from inside the dispatching
 * process. `verifying` / `completed` are deliberately absent — see
 * `CompactLifecyclePublisher` and `settleOpenLifecycleRun` for why.
 *
 * `armed` is the honest resting stage for a dispatch that only
 * REGISTERED a trigger (slice 2026-09-12-compact-band-policy, defect B)
 * — see `resolveDispatchedStage`.
 */
type ObservableDispatchStage = Extract<CompactLifecycleStage, 'queued' | 'preparing' | 'compacting' | 'armed'>;

/** Stage a failure is attributed to (mirrors the store's `failedAt` domain). */
type FailableStage = Exclude<CompactLifecycleStage, 'failed' | 'completed'>;

/**
 * PRD-002b slice 2 — extract the few cross-cutting magic numbers
 * that actually appear at runtime call sites in this orchestrator.
 * Threshold ratios (0.85 / 0.95) live in `auto-compact-types.ts`
 * and are NOT extracted here because they ARE the contract; comment
 * + spec prose references must keep the literal value visible.
 */
const COLLAPSED_ERROR_MAX_CHARS = 160;

/**
 * Slice 2026-09-12-compact-band-policy (defect B): which stage a
 * *successful* dispatch can honestly claim.
 *
 * A dispatch is only evidence that a compact is IN FLIGHT when the
 * adapter's own trigger is already satisfied. claude-code's
 * `ide-native` pathway installs a PreToolUse hook that compacts
 * in-band at ratio ≥ 0.95 (`AUTO_COMPACT_RED_LINE_RATIO`); at or above
 * that ratio the very next tool call fires it, so `compacting` (and
 * therefore `stalled` if it never lands) is the truthful reading.
 *
 * Below it — and for every pathway that only writes an intent
 * (`llm-self-compress`), or whose shell-exec branch is a deprecated
 * no-op — NOTHING is compacting. The process merely ARMED a trigger.
 * Recording `compacting` there published a heartbeat nobody would ever
 * send, which is what pinned the statusline at `stalled` forever.
 */
export function resolveDispatchedStage(input: {
  readonly pathway: string;
  readonly ratio: number;
}): Extract<CompactLifecycleStage, 'compacting' | 'armed'> {
  return input.pathway === 'ide-native' && input.ratio >= AUTO_COMPACT_RED_LINE_RATIO
    ? 'compacting'
    : 'armed';
}

/**
 * One id per compact attempt. Timestamp-prefixed so a human reading
 * the raw record can order runs by eye; the random suffix keeps two
 * attempts inside the same millisecond distinct.
 */
export function newCompactRunId(now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const suffix = Math.random().toString(16).slice(2, 8);
  return `compact-${stamp}-${suffix}`;
}

/**
 * Slice 2026-08-01-compact-lifecycle (Task 5): read an open compact
 * record ignoring staleness.
 *
 * The lifecycle store classifies an active record as `stalled` after a
 * caller-supplied `staleAfterMs` window. That classification exists for
 * the statusline renderer (Task 2/3) — it tells the user "this run
 * hasn't heartbeated for a while".
 *
 * For settling a run by measurement, staleness is irrelevant: if a
 * record exists at `compacting`, a post-compact probe that measures a
 * drop should still complete it, even if the probe itself ran hours
 * later. Wrapping that unbounded read here keeps the magic number out
 * of the settle path and makes the intent self-documenting.
 *
 * Returns `null` for any non-`valid` kind (missing / invalid /
 * stalled). Errors from the underlying read are swallowed — settling
 * is best-effort telemetry and must never bubble.
 */
function readOpenCompactLifecycle(input: {
  readonly projectRoot: string;
  readonly sessionId: string;
}): CompactLifecycleRecord | null {
  let out: ReturnType<typeof readCompactLifecycle>;
  try {
    out = readCompactLifecycle({
      projectRoot: input.projectRoot,
      sessionId: input.sessionId,
      nowMs: Date.now(),
      // Number.MAX_SAFE_INTEGER disables the store's staleness gate
      // for this call — see the doc comment above for why settling
      // intentionally ignores staleness.
      staleAfterMs: Number.MAX_SAFE_INTEGER
    });
  } catch {
    return null;
  }
  return out.kind === 'valid' ? out.record : null;
}

/**
 * Slice 2026-08-01-compact-lifecycle (Task 5): the local transition
 * builder. Carries `runId`, `triggerRatio` and `redLine` forward from
 * the run that opened, and remembers the prior stage so a failure can
 * name the stage it died in.
 *
 * TRUTHFULNESS: this publisher only ever emits a stage the calling
 * process has actually PROVED. It never emits `verifying` or
 * `completed` off the back of a successful dispatch — see
 * `runAutoCompact` and `settleOpenLifecycleRun` for the reason.
 *
 * Telemetry is strictly subordinate to the compact itself: every write
 * is best-effort, and a store failure must not change the threshold
 * decision, the dispatch, or the returned envelope.
 */
export class CompactLifecyclePublisher {
  private lastStage: FailableStage = 'queued';

  constructor(
    private readonly ctx: {
      readonly projectRoot: string;
      readonly sessionId: string;
      readonly runId: string;
      readonly triggerRatio: number;
      readonly redLine: boolean;
      readonly onLifecycleStage?: ((stage: CompactLifecycleStage, record: CompactLifecycleRecord) => void) | undefined;
      readonly failLifecycleWrite?: boolean | undefined;
    }
  ) {}

  /** Publish an active stage the process has proved. */
  advance(stage: ObservableDispatchStage): void {
    this.lastStage = stage;
    this.write({
      schemaVersion: 1,
      runId: this.ctx.runId,
      stage,
      updatedAt: new Date().toISOString(),
      triggerRatio: this.ctx.triggerRatio,
      redLine: this.ctx.redLine
    });
  }

  /**
   * Publish the terminal failure, attributed to the last stage reached.
   *
   * `at` overrides that attribution for the case where the failure
   * happened INSIDE a phase that is only named after its outcome
   * (slice 2026-09-12-compact-band-policy): the dispatch call is the
   * compacting phase even though the resting stage is now chosen from
   * the pathway the dispatch returned. `failedAt` names the phase the
   * attempt died in — it is not a published heartbeat.
   */
  fail(error: unknown, at?: FailableStage): void {
    this.write({
      schemaVersion: 1,
      runId: this.ctx.runId,
      stage: 'failed',
      updatedAt: new Date().toISOString(),
      triggerRatio: this.ctx.triggerRatio,
      redLine: this.ctx.redLine,
      failedAt: at ?? this.lastStage,
      errorSummary: summarizeLifecycleError(error)
    });
  }

  private write(record: CompactLifecycleRecord): void {
    try {
      if (this.ctx.failLifecycleWrite) throw new Error('lifecycle store unavailable');
      writeCompactLifecycle({
        projectRoot: this.ctx.projectRoot,
        sessionId: this.ctx.sessionId,
        record
      });
    } catch {
      // Best-effort telemetry: a lifecycle write failure must never
      // change the compact decision, the dispatch, or the envelope.
      return;
    }
    try {
      this.ctx.onLifecycleStage?.(record.stage, record);
    } catch {
      // An observer is a passive listener; its failure is not ours.
    }
  }
}

/**
 * Reduce an arbitrary thrown value to a single-line, bounded summary
 * fit for a statusline. Stack frames are dropped (the record is a
 * human-facing indicator, not a crash dump); the store clamps the
 * result to its own 160-character cap as a second line of defence.
 *
 * `null` / `undefined` thrown values — a real possibility from
 * `Promise.reject(null)` or a thrown `undefined` — must not collapse
 * to the empty string, which the store would then reject as missing.
 * They map to a fixed "unknown error" sentinel so the record always
 * carries some diagnostic text.
 */
export function summarizeLifecycleError(error: unknown): string {
  let raw: string;
  if (error instanceof Error) raw = error.message;
  else if (error === null || error === undefined) raw = 'unknown error';
  else raw = String(error);
  if (raw.length === 0) raw = 'unknown error';
  const firstLine = raw.split('\n')[0] ?? '';
  const collapsed = firstLine.replace(/\s+/g, ' ').trim();
  return collapsed.length === 0 ? 'unknown error' : (collapsed.length > COLLAPSED_ERROR_MAX_CHARS ? collapsed.slice(0, COLLAPSED_ERROR_MAX_CHARS) : collapsed);
}

/**
 * Slice 2026-08-01-compact-lifecycle (Task 5, Step 4): close out an
 * open compact run using a REAL measurement.
 *
 * This is the integration with the actual post-compact detection path.
 * The claude-code adapter's `postCompactDetectCommand` is
 * `peaks code auto-compact --json` — i.e. the next probe through this very
 * function. So when a probe finds a run still sitting at `compacting`
 * and MEASURES a ratio that has dropped below the auto-fire threshold,
 * that measurement is the proof the compact landed. Only then do we
 * emit `verifying` (we have a measurement in hand) followed by
 * `completed` (it confirms the drop), carrying the measured
 * `afterRatio`.
 *
 * We refuse to complete when:
 *   - the probe could not measure anything (`conservative-fallback`
 *     returns `ratio: 0`, which means "unknown", NOT "empty"). Writing
 *     `afterRatio: 0` there would publish a fabricated number;
 *   - the ratio is still at or above the auto-fire threshold — the
 *     compact has not landed, so the run stays open.
 */
export function settleOpenLifecycleRun(input: {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly measuredRatio: number;
  readonly source: string;
  readonly autoFireThreshold: number;
  readonly onLifecycleStage?: ((stage: CompactLifecycleStage, record: CompactLifecycleRecord) => void) | undefined;
}): void {
  // A `conservative-fallback` probe means no signal was available at
  // all. Its `ratio: 0` is the absence of a measurement, so it can
  // never be evidence that the context shrank.
  if (input.source === 'conservative-fallback') return;
  if (input.measuredRatio >= input.autoFireThreshold) return;

  const prior = readOpenCompactLifecycle({
    projectRoot: input.projectRoot,
    sessionId: input.sessionId
  });
  if (prior === null) return;
  // Only a run that was actually dispatched can be completed by a
  // post-compact measurement. Both `compacting` (the in-band trigger is
  // satisfied) and `armed` (a trigger was registered and could fire at
  // any time) qualify: the measured drop is proof that SOME compact
  // landed, and this is the only open run to attribute it to.
  if (prior.stage !== 'compacting' && prior.stage !== 'armed') return;

  const emit = (stage: 'verifying' | 'completed', withAfterRatio: boolean): void => {
    const record: CompactLifecycleRecord = {
      schemaVersion: 1,
      runId: prior.runId,
      stage,
      updatedAt: new Date().toISOString(),
      triggerRatio: prior.triggerRatio,
      redLine: prior.redLine,
      ...(withAfterRatio ? { afterRatio: input.measuredRatio } : {})
    };
    try {
      writeCompactLifecycle({
        projectRoot: input.projectRoot,
        sessionId: input.sessionId,
        record
      });
    } catch {
      return;
    }
    try {
      input.onLifecycleStage?.(stage, record);
    } catch {
      // Observer failures are not ours to propagate.
    }
  };

  // `verifying` = we hold a measurement and are checking it.
  emit('verifying', false);
  // `completed` = the measurement confirms the drop; publish it.
  emit('completed', true);
}
