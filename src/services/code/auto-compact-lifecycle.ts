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
import { tryGetSessionDir } from '../session/getSessionDir.js';

/**
 * Stages a compact *attempt* can prove from inside the dispatching
 * process. `verifying` / `completed` are deliberately absent — see
 * `CompactLifecyclePublisher` and `settleOpenLifecycleRun` for why.
 *
 * `armed` is the honest resting stage for a dispatch that only
 * REGISTERED a trigger (slice 2026-09-12-compact-band-policy, defect B)
 * — see `resolveDispatchedStage`.
 */
type ObservableDispatchStage = Extract<
  CompactLifecycleStage,
  'queued' | 'preparing' | 'compacting' | 'armed'
>;

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
 * The answer to "is there an open compact record for this session?".
 *
 * THREE states, not two. `none` and `unresolvable` both used to be
 * `null`, and that conflation is the defect repair R6 exists to close:
 * `readOpenDispatchRun` maps `none` to the ADMIT branch of the compact
 * backoff ("no attempt is outstanding, dispatch freely"), so a session
 * id that could not be resolved — and therefore could not be READ —
 * was silently answered as "no attempt is outstanding". The backoff
 * then failed to apply precisely where the id was malformed.
 */
type OpenCompactLifecycleRead =
  | { readonly kind: 'found'; readonly record: CompactLifecycleRecord }
  | { readonly kind: 'none' }
  | { readonly kind: 'unresolvable'; readonly reason: string };

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
 * The session id is resolved through `tryGetSessionDir` FIRST, so the
 * guard's throw is answered before the store is entered and the failing
 * branch is a value the caller must handle rather than a `catch` nobody
 * reads. The residual `catch` is therefore unreachable for a bad id;
 * anything that reaches it is a store fault, and a store fault is still
 * not "there is no open run" — hence `unresolvable`, never `none`.
 */
function readOpenCompactLifecycle(input: {
  readonly projectRoot: string;
  readonly sessionId: string;
}): OpenCompactLifecycleRead {
  const resolved = tryGetSessionDir(input.projectRoot, input.sessionId);
  if (!resolved.ok) {
    return { kind: 'unresolvable', reason: resolved.reason };
  }
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
  } catch (error) {
    return { kind: 'unresolvable', reason: summarizeLifecycleError(error) };
  }
  return out.kind === 'valid' ? { kind: 'found', record: out.record } : { kind: 'none' };
}

/**
 * rid `2026-09-14-compact-dispatch-backoff`: the compact run this session has
 * already DISPATCHED and whose outcome is still unknown — the backoff token.
 *
 * WHY A BACKOFF IS NEEDED AT ALL. Once the ratio crosses the auto-fire
 * threshold it STAYS crossed: nothing in peaks-loop can compact a running
 * session, and the harness fires only at its own red line. So the dispatch
 * obligation became unsatisfiable and fired on every probe. Measured in one
 * real session (2026-09-13T22:43:33Z → 2026-09-14T14:15:02Z, ~15.5 h):
 * 1035 `dispatch` rows, 444 checkpoints, and ZERO compactions — 1075 by
 * 14:22:09.112Z. The dispatch itself is idempotent — `ide-native` only
 * installs a PreToolUse hook, and a second install of the same hook is a
 * documented no-op — so 1074 of those rows installed nothing (their own
 * `dispatchMessage` says `already installed`) and carried no new information.
 * Only noise: a signal that fires a thousand times is not a signal.
 *
 * WHY NO NEW STORE. The one-record-per-session lifecycle store already holds
 * the one fact the backoff needs: is a compact attempt dispatched and not yet
 * superseded? `armed` and `compacting` are exactly those two stages, and
 * `completed` / `failed` mean the attempt is over and the next crossing is a
 * legitimate new one. The state lives here rather than in
 * `compact-history.jsonl`, which is append-only and never rewritten — so the
 * backoff cannot be built by editing history, which is the point.
 *
 * STALENESS IS DELIBERATELY IGNORED, for `settleOpenLifecycleRun`'s reason: a
 * probe arriving after `staleAfterMs` has learned nothing about whether the run
 * is still live. Age cannot make re-dispatching honest, so the stale window
 * must not decide it. (`settleOpenLifecycleRun` reads with the same window for
 * the same reason; the two must not grow two policies.)
 *
 * `queued` / `preparing` / `verifying` are NOT open here: they are transient
 * stages inside a dispatch or a settle, and a process that died in one of them
 * left no compact attempt to protect — the next probe should be free to
 * dispatch. `failed` is not open either, by the same argument: a failure is a
 * reason to try again, not a reason to stay quiet.
 */
/**
 * The answer to "is a compact attempt outstanding for this session?".
 *
 * `none` and `unresolvable` must not be the same value. The caller uses
 * `none` to ADMIT a dispatch; `unresolvable` means the question could
 * not be asked, and a caller that admits on "could not ask" has a gate
 * that reads a string rather than the artifact it names.
 */
export type OpenDispatchRunRead =
  | {
      readonly kind: 'open';
      readonly runId: string;
      readonly stage: 'armed' | 'compacting';
      readonly triggerRatio: number;
    }
  | { readonly kind: 'none' }
  | { readonly kind: 'unresolvable'; readonly reason: string };

export function readOpenDispatchRun(input: {
  readonly projectRoot: string;
  readonly sessionId: string;
}): OpenDispatchRunRead {
  const read = readOpenCompactLifecycle(input);
  if (read.kind === 'unresolvable') return read;
  if (read.kind === 'none') return { kind: 'none' };
  const record = read.record;
  if (record.stage !== 'armed' && record.stage !== 'compacting') return { kind: 'none' };
  return {
    kind: 'open',
    runId: record.runId,
    stage: record.stage,
    triggerRatio: record.triggerRatio
  };
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
      readonly onLifecycleStage?:
        ((stage: CompactLifecycleStage, record: CompactLifecycleRecord) => void) | undefined;
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
  return collapsed.length === 0
    ? 'unknown error'
    : collapsed.length > COLLAPSED_ERROR_MAX_CHARS
      ? collapsed.slice(0, COLLAPSED_ERROR_MAX_CHARS)
      : collapsed;
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
 *
 * Returns the settled record, or `null` when nothing settled. Slice
 * 2026-09-13-auto-compact-trigger-ownership: the caller needs the settled
 * `afterRatio` to append the "observed compaction point" row that makes the
 * intent-vs-observed gap readable after a real session. The return value is
 * telemetry only — callers that ignore it are unaffected.
 *
 * `lifecycleWritten` (repair R6) makes the returned record honest about
 * whether the RUN actually moved. Before it, a failed write still returned
 * the full envelope, so a store that could not be written reported a settle
 * on every probe, forever: the run stayed `armed`, the next probe found it
 * open again, and each one added another "observed compaction point" row —
 * an unbounded append driven by a write that never happened. A failed write
 * is not an absent run (the facts are real and stay true, so the caller may
 * still record the measurement), but it is also not a settled one. This is
 * the same field `settleOpenLifecycleRunOnCompactEvent` carries, for the
 * same reason, so the two settle paths no longer disagree about what a write
 * failure means.
 */
export function settleOpenLifecycleRun(input: {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly measuredRatio: number;
  readonly source: string;
  readonly autoFireThreshold: number;
  readonly onLifecycleStage?:
    ((stage: CompactLifecycleStage, record: CompactLifecycleRecord) => void) | undefined;
  /** Failure injection for the write below — the seam `CompactLifecyclePublisher` already takes. */
  readonly failLifecycleWrite?: boolean | undefined;
}): {
  readonly runId: string;
  readonly triggerRatio: number;
  readonly afterRatio: number;
  /** `false` when the `completed` write threw, so the run is STILL open. */
  readonly lifecycleWritten: boolean;
} | null {
  // A `conservative-fallback` probe means no signal was available at
  // all. Its `ratio: 0` is the absence of a measurement, so it can
  // never be evidence that the context shrank.
  if (input.source === 'conservative-fallback') return null;
  if (input.measuredRatio >= input.autoFireThreshold) return null;

  const openRead = readOpenCompactLifecycle({
    projectRoot: input.projectRoot,
    sessionId: input.sessionId
  });
  // Both `none` and `unresolvable` mean "nothing to settle" HERE, and the
  // collapse is legitimate on this path rather than a fail-open: settling
  // ADMITS nothing. No record can exist under an id that names no session
  // directory, so there is nothing this probe could have been about.
  if (openRead.kind !== 'found') return null;
  const prior = openRead.record;
  // Only a run that was actually dispatched can be completed by a
  // post-compact measurement. Both `compacting` (the in-band trigger is
  // satisfied) and `armed` (a trigger was registered and could fire at
  // any time) qualify: the measured drop is proof that SOME compact
  // landed, and this is the only open run to attribute it to.
  if (prior.stage !== 'compacting' && prior.stage !== 'armed') return null;

  const emit = (stage: 'verifying' | 'completed', withAfterRatio: boolean): boolean => {
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
      if (input.failLifecycleWrite) throw new Error('lifecycle store unavailable');
      writeCompactLifecycle({
        projectRoot: input.projectRoot,
        sessionId: input.sessionId,
        record
      });
    } catch {
      // Best-effort telemetry, as everywhere in this file — but the failure is
      // REPORTED to the caller as `lifecycleWritten: false` rather than folded
      // into a record that reads as settled.
      return false;
    }
    try {
      input.onLifecycleStage?.(stage, record);
    } catch {
      // Observer failures are not ours to propagate.
    }
    return true;
  };

  // `verifying` = we hold a measurement and are checking it.
  emit('verifying', false);
  // `completed` = the measurement confirms the drop; publish it. This write
  // is the one that closes the run, so it is the one that is reported.
  const lifecycleWritten = emit('completed', true);
  return {
    runId: prior.runId,
    triggerRatio: prior.triggerRatio,
    afterRatio: input.measuredRatio,
    lifecycleWritten
  };
}

/**
 * rid `2026-09-13-compact-event-settle`: close out an open compact run because
 * the HARNESS said one completed — `PostCompact` — rather than because a later
 * probe noticed the ratio had fallen.
 *
 * WHY THIS IS A SECOND FUNCTION AND NOT A FLAG ON THE ONE ABOVE. The function
 * above is defined by two MEASUREMENT gates: it refuses when nothing could be
 * measured, and refuses when the number it got has not dropped far enough. Both
 * are correct for a probe, whose ratio is an INFERENCE about whether something
 * happened. Handed a harness event, both are wrong in the same direction —
 * the harness has already stated that the compaction happened, so a probe that
 * could not measure, or measured something larger, contradicts nothing. The
 * event is the evidence; the ratio is a consequence.
 *
 * What survives from the probe path is the ATTRIBUTION gate, and only that:
 * there must be an open run (`compacting` / `armed`) for this event to be
 * about. A `PostCompact` on a session where peaks-loop never dispatched has
 * nothing to settle — objectively, the run the event would complete does not
 * exist. (`queued` / `preparing` are excluded for the probe path's reason: a
 * run that died before dispatch never had a compaction to complete.)
 *
 * `afterRatio` is recorded ONLY when it is a genuine DROP below the ratio the
 * dispatch was made at. Immediately after a compaction, `readContextPercent`
 * prefers the statusline file, which may still hold the PRE-compact value; the
 * one thing this row must not do is launder that stale reading into an
 * `afterRatio` and publish "the context did not shrink" as a measurement. A
 * `null` here means "no honest post-compact number was available at the moment
 * the event fired" — and that is NOT self-healing: the record is left at
 * `completed` with no number, `computeWindowCalibration` skips `observed` rows
 * that carry none, and the probe path refuses a run that is no longer open. The
 * pair is then closed by `fillEventSettledMeasurement` below — but only on the
 * probes that reach it, which is not all of them: that call sits in the
 * BELOW-THRESHOLD branch of `runAutoCompact` (`auto-compact-orchestrator.ts:567`
 * guards it, `:589` calls it). A probe that instead commits to compacting does
 * not merely defer the measurement: `advance('queued')` writes a fresh run to
 * the same one-record-per-session store (`auto-compact-orchestrator.ts:668`), so
 * the `completed`-without-`afterRatio` record this pair was owed is gone and the
 * pair stays unmeasured. That loss is inherent rather than an oversight — once a
 * second compaction has happened, no later ratio can be attributed to the first,
 * so there is nothing honest left to fill — and it is visible as `unmeasured` in
 * `peaks compact history` (QA residual R9). A fabricated number is not
 * recoverable at all, which is why the stale reading is dropped rather than
 * corrected.
 *
 * `verifying` is deliberately NOT emitted: its documented meaning is "we hold a
 * measurement and are checking it", and on this path there may be no
 * measurement at all. Emitting it would move the same untruth from the history
 * row into the lifecycle record.
 *
 * Returns the settled facts, or `null` when there was nothing to settle. `null`
 * means exactly ONE thing here — there was no OPEN run for this event to be
 * about. A run that was open but whose record could not be written is not
 * `null`: it returns the facts read off that run with `lifecycleWritten: false`,
 * because a failed write is not an absent run, and a caller that cannot tell the
 * two apart ends up telling the user a falsehood (see `compact-event-settle.ts`).
 */
export function settleOpenLifecycleRunOnCompactEvent(input: {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly measuredRatio: number | null;
  readonly onLifecycleStage?:
    ((stage: CompactLifecycleStage, record: CompactLifecycleRecord) => void) | undefined;
  /** Failure injection for the write below — the seam `CompactLifecyclePublisher` already takes. */
  readonly failLifecycleWrite?: boolean | undefined;
}): {
  readonly runId: string;
  readonly triggerRatio: number;
  readonly afterRatio: number | null;
  /**
   * `false` when the run could not be marked settled — `writeCompactLifecycle`
   * threw. The three facts above were read off the OPEN run, so they stay true
   * and a caller may still record the observation; what it must not do is report
   * the run as settled. `settleOpenLifecycleRun` above does not suppress its
   * returned record on a failed write either, so the two now agree that a write
   * failure is not "nothing happened". This field exists because this function's
   * caller, unlike the sibling's, renders a sentence about the outcome.
   */
  readonly lifecycleWritten: boolean;
} | null {
  const openRead = readOpenCompactLifecycle({
    projectRoot: input.projectRoot,
    sessionId: input.sessionId
  });
  // Same collapse as `settleOpenLifecycleRun` above, for the same reason:
  // an unresolvable id names no session directory, so no open run exists
  // for this event to be about, and `null` here admits nothing.
  if (openRead.kind !== 'found') return null;
  const prior = openRead.record;
  if (prior.stage !== 'compacting' && prior.stage !== 'armed') return null;

  const afterRatio =
    input.measuredRatio !== null && input.measuredRatio < prior.triggerRatio
      ? input.measuredRatio
      : null;

  const record: CompactLifecycleRecord = {
    schemaVersion: 1,
    runId: prior.runId,
    stage: 'completed',
    updatedAt: new Date().toISOString(),
    triggerRatio: prior.triggerRatio,
    redLine: prior.redLine,
    ...(afterRatio !== null ? { afterRatio } : {})
  };
  const facts = { runId: prior.runId, triggerRatio: prior.triggerRatio, afterRatio };
  try {
    if (input.failLifecycleWrite) throw new Error('lifecycle store unavailable');
    writeCompactLifecycle({
      projectRoot: input.projectRoot,
      sessionId: input.sessionId,
      record
    });
  } catch {
    // Deliberately NOT `null`. The run WAS open and the write FAILED; returning
    // the same value as "no run is open" is the conflation the repo's own lint
    // names at this exact line (`catch-return-null — caller cannot distinguish
    // failure from success`), and it reached the user as "No compact run was
    // open", which is false.
    return { ...facts, lifecycleWritten: false };
  }
  try {
    input.onLifecycleStage?.('completed', record);
  } catch {
    // Observer failures are not ours to propagate.
  }
  return { ...facts, lifecycleWritten: true };
}

/**
 * rid `2026-09-13-compact-event-settle` (repair R1): supply the measurement a
 * harness-settled run was left owing.
 *
 * The function above deliberately refuses to launder a post-compact reading
 * that has not dropped — and right after a compaction that refusal is the
 * NORMAL case, because the statusline still holds the pre-compact value. The
 * run is then closed at `completed` with no `afterRatio`, so the dispatch's
 * calibration pair never closes and "intent vs observed" stays blank for
 * exactly the compactions this slice exists to witness. This function is what
 * makes the function above's promise payable.
 *
 * WHY NOT WIDEN `settleOpenLifecycleRun`. That one re-emits `verifying` before
 * `completed`, which on an already-`completed` record is a backwards stage
 * transition with no observer to serve. This is not a settlement — the run IS
 * settled; only the number is owed. So no stage is rewritten here.
 *
 * WRITING `afterRatio` ONTO THE RECORD IS THE IDEMPOTENCE TOKEN: every later
 * probe finds it present and returns `null`, so however many probes follow, one
 * compaction yields exactly one late measurement.
 *
 * THE DROP GATE IS THE EVENT PATH'S OWN (`measuredRatio < triggerRatio`), not
 * the probe path's `autoFireThreshold`. `afterRatio` has to mean "below the
 * ratio this run was dispatched at" — the rule the event path already enforces
 * — or a run dispatched under the threshold (a forced or banded dispatch) would
 * let a NON-drop through the one path that can still write a `completed` record.
 * `conservative-fallback` is refused for the probe path's reason: its `0` is
 * the absence of a measurement, not an empty context.
 *
 * Returns the filled record, or `null` when no run is owed a measurement.
 */
export function fillEventSettledMeasurement(input: {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly measuredRatio: number;
  readonly source: string;
}): { readonly runId: string; readonly triggerRatio: number; readonly afterRatio: number } | null {
  if (input.source === 'conservative-fallback') return null;

  const openRead = readOpenCompactLifecycle({
    projectRoot: input.projectRoot,
    sessionId: input.sessionId
  });
  // Same collapse as the two settle paths above — `null` here admits nothing.
  if (openRead.kind !== 'found') return null;
  const prior = openRead.record;
  // Exactly one shape is owed a number: the one the EVENT path leaves behind.
  // `settleOpenLifecycleRun` never writes it (it always carries `afterRatio`),
  // and a `failed` run never dispatched, so it has no row to pair with.
  if (prior.stage !== 'completed' || prior.afterRatio !== undefined) return null;
  if (input.measuredRatio >= prior.triggerRatio) return null;

  const record: CompactLifecycleRecord = {
    schemaVersion: 1,
    runId: prior.runId,
    stage: 'completed',
    updatedAt: new Date().toISOString(),
    triggerRatio: prior.triggerRatio,
    redLine: prior.redLine,
    afterRatio: input.measuredRatio
  };
  try {
    writeCompactLifecycle({
      projectRoot: input.projectRoot,
      sessionId: input.sessionId,
      record
    });
  } catch {
    return null;
  }
  return { runId: prior.runId, triggerRatio: prior.triggerRatio, afterRatio: input.measuredRatio };
}
