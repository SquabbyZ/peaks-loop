/**
 * The in-flight probe: is a dispatch in flight right now?
 *
 * THE DISPATCH LEDGER IS THE SOURCE OF TRUTH. The session's ledger — the
 * `active-dispatches.json` index plus the dispatch record each row names — is
 * the artifact that records what the auto-compact deferral is about: a
 * sub-agent that is running right now. The workflow graphs never carried that
 * fact. A dispatch node sits at `prepared` and no writer stamps a heartbeat
 * onto it, so a graph-backed probe could only ever answer "no"; the deferral
 * was unreachable in production for that reason alone.
 *
 * WHERE THE BOUNDARY SITS. This module is the pure half: it opens no file,
 * reads no clock of its own, and decides from the facts the reader hands it.
 * The reader lives in `../dispatch/dispatch-ledger-reader.js` and produces
 * plain data for the types below. That split is what keeps the decision
 * testable without a filesystem, and it is the reason the reader and the probe
 * are two modules rather than one.
 *
 * THE DIRECTION OF THE ANSWER. A wrongly deferred compaction is an
 * inconvenience; a compaction that lands in the middle of a batch is a lost
 * batch. So every unknown — a ledger that cannot be enumerated, a record that
 * cannot be read, a status this probe does not recognise, a freshness signal
 * that cannot be parsed — answers "in flight" and defers the compaction.
 */

/** One minute, in milliseconds. */
const MS_PER_MINUTE = 60_000;

/** How long a dispatch's freshness signal stays fresh. */
const FRESH_RUNNING_MINUTES = 30;

/**
 * The freshness bound, shared with the deferral that uses it. A dispatch whose
 * freshness signal is older than this is not in flight any more.
 */
export const FRESH_RUNNING_THRESHOLD_MS = FRESH_RUNNING_MINUTES * MS_PER_MINUTE;

/** The dispatch record carried no freshness signal this probe could read. */
export const PEAKS_HEARTBEAT_MISSING = 'PEAKS_HEARTBEAT_MISSING';
/** The ledger, or one of the records it names, could not be read. */
export const PEAKS_DISPATCH_LEDGER_UNREADABLE = 'PEAKS_DISPATCH_LEDGER_UNREADABLE';
/** The record's status is not one this probe recognises. */
export const PEAKS_DISPATCH_STATUS_UNKNOWN = 'PEAKS_DISPATCH_STATUS_UNKNOWN';

/**
 * One dispatch's ledger facts, as the reader found them.
 *
 * `absent` means the record file is gone, so no dispatch is running behind it —
 * the record IS the artifact that proves liveness, and without it there is
 * nothing running. `unreadable` means the record is there but cannot be
 * believed, which is an unknown, not an absence.
 */
export type LedgerDispatchFact =
  | { readonly kind: 'absent'; readonly recordPath: string }
  | { readonly kind: 'unreadable'; readonly recordPath: string }
  | {
      readonly kind: 'record';
      readonly recordPath: string;
      readonly status: string;
      readonly outcome: string;
      readonly lastBeatAt: string | null;
      readonly createdAt: string;
      readonly disposed: boolean;
    };

/** What the reader found in one session's dispatch ledger. */
export interface LedgerFacts {
  /** `absent` = the session has no ledger; `unreadable` = the ledger cannot be enumerated. */
  readonly ledgerState: 'absent' | 'unreadable' | 'readable';
  readonly dispatches: readonly LedgerDispatchFact[];
}

export interface ProbeInput {
  readonly now: string;
  readonly ledger: LedgerFacts;
  readonly redLine?: boolean;
}

export interface ProbeWarning {
  readonly code: string;
  readonly message: string;
  readonly recordPath?: string;
}

export interface ProbeResult {
  readonly inFlightBatch: boolean;
  readonly shouldCompact: boolean;
  readonly deferPreCompact: boolean;
  readonly warnings: readonly ProbeWarning[];
  readonly errors: readonly ProbeWarning[];
  readonly reason: string;
}

/**
 * The statuses that mean the dispatch is over. `no-execution` and
 * `never-started` are here because the dispatch never ran; `unreadable` is
 * NOT here, because a record that cannot be believed is an unknown rather
 * than a finished dispatch — it is answered by the status-unknown branch.
 */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'done',
  'failed',
  'cancelled',
  'no-execution',
  'never-started'
]);

/**
 * The statuses that mean the dispatch may still be running. `stale` is here
 * because a stale dispatch is quiet, not finished — its freshness signal is
 * what decides it.
 */
const LIVE_STATUSES: ReadonlySet<string> = new Set(['queued', 'running', 'finalizing', 'stale']);

/**
 * The outcomes that mean the dispatch is over. `no-execution` is absent: it is
 * the value a record carries BEFORE it runs, so on its own it says nothing
 * about liveness.
 */
const TERMINAL_OUTCOMES: ReadonlySet<string> = new Set([
  'success',
  'failed',
  'timeout',
  'cancelled'
]);

/** What one dispatch's facts add up to. */
interface DispatchVerdict {
  readonly inFlight: boolean;
  readonly unknown: boolean;
  readonly warning: ProbeWarning | null;
  readonly error: ProbeWarning | null;
}

const NOT_IN_FLIGHT: DispatchVerdict = {
  inFlight: false,
  unknown: false,
  warning: null,
  error: null
};

function unreadableVerdict(recordPath: string, message: string): DispatchVerdict {
  return {
    inFlight: true,
    unknown: true,
    warning: null,
    error: { code: PEAKS_DISPATCH_LEDGER_UNREADABLE, message, recordPath }
  };
}

function unknownStatusVerdict(recordPath: string, status: string): DispatchVerdict {
  return {
    inFlight: true,
    unknown: true,
    warning: {
      code: PEAKS_DISPATCH_STATUS_UNKNOWN,
      message: `dispatch record status '${status}' is not one this probe recognises`,
      recordPath
    },
    error: null
  };
}

function missingHeartbeatVerdict(recordPath: string, message: string): DispatchVerdict {
  return {
    inFlight: true,
    unknown: true,
    warning: { code: PEAKS_HEARTBEAT_MISSING, message, recordPath },
    error: null
  };
}

/** Is this record's own state terminal — finished, failed, disposed, or never executed? */
function isTerminal(fact: Extract<LedgerDispatchFact, { kind: 'record' }>): boolean {
  return fact.disposed || TERMINAL_STATUSES.has(fact.status) || TERMINAL_OUTCOMES.has(fact.outcome);
}

/**
 * The freshness of one live dispatch.
 *
 * The anchor is `lastBeatAt` when the dispatch has beaten, and `createdAt`
 * when it has not. The floor is bounded by the SAME threshold as a beat, so a
 * dispatch that never beats can defer a compaction for at most thirty
 * minutes after it was issued — a dead dispatch cannot defer forever, and a
 * dispatch that was just issued is still a live member of its batch.
 *
 * The heartbeat ARRAY is not consulted: `lastBeatAt` is written in the same
 * atomic write as the array's last entry, so the two cannot disagree, and the
 * array keeps only its last hundred entries, so it is not a history.
 */
function judgeFreshness(
  fact: Extract<LedgerDispatchFact, { kind: 'record' }>,
  nowMs: number
): DispatchVerdict {
  const anchor = fact.lastBeatAt ?? fact.createdAt;
  const anchorMs = new Date(anchor).getTime();
  if (!Number.isFinite(anchorMs)) {
    return missingHeartbeatVerdict(
      fact.recordPath,
      'dispatch record carries no freshness signal this probe could read'
    );
  }
  if (nowMs - anchorMs < FRESH_RUNNING_THRESHOLD_MS) {
    return { inFlight: true, unknown: false, warning: null, error: null };
  }
  return NOT_IN_FLIGHT;
}

/** What one dispatch's facts add up to. */
function judgeDispatch(fact: LedgerDispatchFact, nowMs: number): DispatchVerdict {
  if (fact.kind === 'absent') return NOT_IN_FLIGHT;
  if (fact.kind === 'unreadable') {
    return unreadableVerdict(fact.recordPath, 'dispatch record could not be read');
  }
  if (isTerminal(fact)) return NOT_IN_FLIGHT;
  if (!LIVE_STATUSES.has(fact.status)) {
    return unknownStatusVerdict(fact.recordPath, fact.status);
  }
  return judgeFreshness(fact, nowMs);
}

/**
 * The decision. Pure: the ledger's facts go in, the answer comes out.
 *
 * Red-line compaction overrides the in-flight deferral, so a session at the
 * red line still asks the harness to compact.
 */
export function probeInFlightBatch(input: ProbeInput): ProbeResult {
  const nowMs = new Date(input.now).getTime();
  const warnings: ProbeWarning[] = [];
  const errors: ProbeWarning[] = [];
  const ledgerUnreadable = input.ledger.ledgerState === 'unreadable';
  if (ledgerUnreadable) {
    errors.push({
      code: PEAKS_DISPATCH_LEDGER_UNREADABLE,
      message: 'the dispatch ledger could not be enumerated'
    });
  }
  const verdicts = input.ledger.dispatches.map((fact) => judgeDispatch(fact, nowMs));
  for (const verdict of verdicts) {
    if (verdict.warning !== null) warnings.push(verdict.warning);
    if (verdict.error !== null) errors.push(verdict.error);
  }
  const inFlight = ledgerUnreadable || verdicts.some((verdict) => verdict.inFlight);
  const unknown = ledgerUnreadable || verdicts.some((verdict) => verdict.unknown);
  const shouldCompact = input.redLine === true ? true : !inFlight;
  return {
    inFlightBatch: inFlight,
    shouldCompact,
    deferPreCompact: inFlight,
    warnings,
    errors,
    reason: unknown ? 'unknown-ledger-state' : inFlight ? 'fresh-dispatch' : 'no-fresh-dispatch'
  };
}
