// src/services/compact-history/compact-history-service.ts
//
// Slice 2026-07-30-compact-visibility (slice 1/4). Pure-function
// reader for the .peaks/_runtime/<sessionId>/compact-history.jsonl
// file that auto-compact-orchestrator now appends to on every
// dispatch. The CLI surface `peaks compact history` and the
// statusline indicator both consume this service.
//
// The file is one JSON event per line. Malformed lines are
// surfaced as { kind: 'parse-error', line, raw } records so the
// caller (CLI / statusline) can warn without aborting the whole
// read.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface CompactHistoryEvent {
  readonly schemaVersion: 1;
  readonly ts: string;
  readonly target: 'main' | 'sub-agent' | 'worker';
  readonly mode: 'standard' | 'partial' | 'aggressive';
  readonly ide: string;
  readonly pathway: string;
  readonly beforeRatio: number;
  readonly redLine: boolean;
  readonly ok: boolean;
  readonly checkpointPath: string;
  readonly dispatchMessage: string;
  /**
   * Slice 2026-09-13-auto-compact-trigger-ownership (T4): the window this
   * dispatch divided by. `beforeRatio * windowTokens` is the token point
   * peaks-loop asked the harness to compact at.
   */
  readonly windowTokens?: number | null;
  /** Which layer produced `windowTokens` (env-override | harness-env | config | model-heuristic | default). */
  readonly windowSource?: string | null;
  /**
   * `dispatch` — peaks-loop asked for a compact (every row written before
   * this slice is implicitly one of these). `observed` — a later probe
   * MEASURED the ratio after a dispatched compact, proving one landed.
   */
  readonly kind?: 'dispatch' | 'observed';
  /** `observed` rows only: the measured post-compact ratio. */
  readonly afterRatio?: number;
}

/**
 * One dispatch paired with the measurement that followed it — the
 * intent-vs-observed record for the harness auto-compact window.
 *
 * Why a pair and not a number: the slice that owns this instrument could not
 * run a real Claude Code session, and the harness's own documentation gives
 * the env var as a WINDOW, not a trigger point, so "a window of X makes the
 * harness fire at Y%" has no documented answer. Fabricating Y would be worse
 * than not having it. Recording the intent (`requested*`) next to whatever
 * the next real session actually measures (`observed*`) is the honest
 * substitute: after one real session the gap becomes a measured fact.
 */
export interface WindowCalibrationPair {
  readonly dispatchedAt: string;
  readonly windowTokens: number | null;
  readonly windowSource: string | null;
  /** The ratio at which peaks-loop asked. */
  readonly requestedRatio: number;
  /** `requestedRatio * windowTokens` — token point asked for; null with no window. */
  readonly requestedTokens: number | null;
  /** Measured ratio of the first `observed` row after this dispatch. */
  readonly observedRatio: number | null;
  readonly observedTokens: number | null;
  /**
   * `observedTokens - requestedTokens`. Negative = the harness compacted
   * BEFORE the point peaks-loop asked for (which is the harness's own
   * trigger firing early). Null while unmeasured.
   */
  readonly driftTokens: number | null;
  readonly measured: boolean;
}

export interface WindowCalibration {
  readonly pairs: ReadonlyArray<WindowCalibrationPair>;
  /** Dispatches with no following measurement yet. */
  readonly unmeasured: number;
  /** The window in force on the most recent dispatch, for a one-line read. */
  readonly lastWindowTokens: number | null;
}

/**
 * Pair each dispatched compact with the measurement that followed it. Pure;
 * tolerates a file written by an earlier release (no `windowTokens`, no
 * `kind`) — those rows produce a pair with a null window rather than an
 * error, because the history file is append-only and never rewritten.
 */
export function computeWindowCalibration(
  events: ReadonlyArray<CompactHistoryEvent>
): WindowCalibration {
  const pairs: WindowCalibrationPair[] = [];
  for (const event of events) {
    const kind = event.kind ?? 'dispatch';
    if (kind === 'observed') {
      // Attach to the most recent dispatch still waiting for a measurement.
      for (let i = pairs.length - 1; i >= 0; i -= 1) {
        const candidate = pairs[i]!;
        if (candidate.observedRatio !== null || typeof event.afterRatio !== 'number') continue;
        const observedTokens = candidate.windowTokens === null ? null : event.afterRatio * candidate.windowTokens;
        pairs[i] = {
          ...candidate,
          observedRatio: event.afterRatio,
          observedTokens,
          driftTokens:
            observedTokens === null || candidate.requestedTokens === null
              ? null
              : observedTokens - candidate.requestedTokens,
          measured: true
        };
        break;
      }
      continue;
    }
    const windowTokens = typeof event.windowTokens === 'number' ? event.windowTokens : null;
    pairs.push({
      dispatchedAt: event.ts,
      windowTokens,
      windowSource: event.windowSource ?? null,
      requestedRatio: event.beforeRatio,
      requestedTokens: windowTokens === null ? null : event.beforeRatio * windowTokens,
      observedRatio: null,
      observedTokens: null,
      driftTokens: null,
      measured: false
    });
  }
  return {
    pairs,
    unmeasured: pairs.filter((p) => !p.measured).length,
    lastWindowTokens: pairs.length === 0 ? null : pairs[pairs.length - 1]!.windowTokens
  };
}

export type CompactHistoryReadResult =
  | { readonly kind: 'file-missing'; readonly path: string }
  | { readonly kind: 'empty'; readonly path: string }
  | {
      readonly kind: 'ok';
      readonly path: string;
      readonly events: ReadonlyArray<CompactHistoryEvent>;
      readonly parseErrors: ReadonlyArray<{ readonly line: number; readonly raw: string }>;
    };

export function readCompactHistory(input: {
  readonly projectRoot: string;
  readonly sessionId: string;
}): CompactHistoryReadResult {
  const path = join(input.projectRoot, '.peaks', '_runtime', input.sessionId, 'compact-history.jsonl');
  if (!existsSync(path)) {
    return { kind: 'file-missing', path };
  }
  const raw = readFileSync(path, 'utf8');
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) {
    return { kind: 'empty', path };
  }
  const events: CompactHistoryEvent[] = [];
  const parseErrors: { line: number; raw: string }[] = [];
  lines.forEach((line, idx) => {
    try {
      const parsed = JSON.parse(line) as CompactHistoryEvent;
      if (typeof parsed.beforeRatio !== 'number' || typeof parsed.ts !== 'string') {
        parseErrors.push({ line: idx + 1, raw: line });
        return;
      }
      events.push(parsed);
    } catch {
      parseErrors.push({ line: idx + 1, raw: line });
    }
  });
  return { kind: 'ok', path, events, parseErrors };
}

export interface CompactHistorySummary {
  readonly totalCompacts: number;
  readonly lastTs: string | null;
  readonly lastBeforeRatio: number | null;
  readonly lastRedLine: boolean;
  readonly redLineCount: number;
  readonly failedCount: number;
}

export function summarizeCompactHistory(events: ReadonlyArray<CompactHistoryEvent>): CompactHistorySummary {
  if (events.length === 0) {
    return {
      totalCompacts: 0,
      lastTs: null,
      lastBeforeRatio: null,
      lastRedLine: false,
      redLineCount: 0,
      failedCount: 0,
    };
  }
  const last = events[events.length - 1]!;
  return {
    totalCompacts: events.length,
    lastTs: last.ts,
    lastBeforeRatio: last.beforeRatio,
    lastRedLine: last.redLine,
    redLineCount: events.filter((e) => e.redLine).length,
    failedCount: events.filter((e) => !e.ok).length,
  };
}
