/**
 * Slice `b1-filesplit-campaign` (wave 3B) — verbatim extraction of the four
 * read-only `peaks observability` query runners (`status` / `slices` /
 * `fanout` / `repair-cycles`) and the two scope resolvers they share out of
 * `./observability-commands.ts` (380 raw lines > the 300 cap) so that module
 * clears the cap. No query, envelope key, warning string or exit-code path
 * changed and no assertion moved: `observability-commands.ts` imports these
 * six names from this path, so the commander tree and every importer are
 * byte-equivalent in behaviour.
 *
 * `runReport` stayed behind on purpose: it carries a
 * `max-lines-per-function` finding, and a NEW module in this campaign must be
 * clean outright — hoisting it would move a finding into a brand-new file.
 *
 * LATER ADDITION — `peaks observability repair-cycles` also grew an
 * `--all-sessions` scope, so the whole recorded history of a project can be
 * measured from the command itself.
 *
 * TASK 4 — the same `--all-sessions` scope now reaches `status` / `slices` /
 * `fanout` / `report`, and every scoped query says so when its scope holds no
 * events while OTHER sessions hold some.
 */

import { fail, ok } from 'peaks-loop-shared/result';

import { findProjectRoot } from '../../services/config/config-safety.js';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import {
  aggregateFanout,
  aggregateRepairCycles,
  aggregateSlices,
  aggregateStatus,
  readAllSessionEvents,
  readSessionEvents
} from '../../services/observability/aggregation.js';
import { getSessionIdCanonical } from '../../services/session/session-manager.js';
import { getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';

export function resolveProjectRoot(optionProject: string | undefined): string {
  return optionProject !== undefined
    ? resolveCanonicalProjectRoot(optionProject)
    : (findProjectRoot(process.cwd()) ?? process.cwd());
}

/**
 * The options every read-only observability query accepts.
 *
 * `allSessions` widens the scope from the canonical session binding to the
 * WHOLE recorded history of the project — the same flag, and the same
 * meaning, that `repair-cycles` already carries.
 */
export type ObservabilityQueryOptions = {
  project?: string;
  session?: string;
  json?: boolean;
  allSessions?: boolean;
};

/**
 * The session a query reads, or `undefined` for EVERY session.
 *
 * `allSessions` short-circuits the resolution: the whole recorded history is
 * read instead of the canonical session binding, and an explicit `--session`
 * does not narrow it back. That is the precedence `repair-cycles
 * --all-sessions` already has.
 */
export function resolveSessionId(
  optionSession: string | undefined,
  projectRoot: string,
  allSessions: boolean
): string | undefined {
  if (allSessions) return undefined;
  if (optionSession !== undefined) return optionSession;
  return getSessionIdCanonical(projectRoot) ?? undefined;
}

/**
 * The warnings a scoped query carries.
 *
 * A scoped query that reads zero events reads exactly like a project that
 * recorded nothing, and the reader concludes the second — the events that ARE
 * there stay invisible. So when the scope is empty while OTHER sessions hold
 * events, the warning says how many sessions hold them, how many events in
 * total, and names the flag that reaches them.
 *
 * Empty otherwise: either the scope holds events, or the scope already
 * covers every session.
 */
export function scopeWarnings(
  projectRoot: string,
  scopedSessionId: string | undefined,
  scopedEventCount: number
): string[] {
  if (scopedSessionId === undefined) return [];
  if (scopedEventCount > 0) return [];
  const sessions = new Set<string>();
  let eventCount = 0;
  for (const event of readAllSessionEvents(projectRoot)) {
    if (event.sessionId === scopedSessionId) continue;
    sessions.add(event.sessionId);
    eventCount += 1;
  }
  if (eventCount === 0) return [];
  return [
    `No observability events in session \`${scopedSessionId}\`; ` +
      `${sessions.size} other session(s) hold ${eventCount} event(s) in total — ` +
      'use `--all-sessions` to read them.'
  ];
}

/** What a scoped query reads: the session it was scoped to, and its events. */
export type ScopedRead = {
  readonly sessionId: string | undefined;
  readonly events: ReturnType<typeof readAllSessionEvents>;
};

/**
 * The events a scoped query answers for: the one session the scope names, or
 * every session the project recorded.
 */
export function readScopedEvents(
  projectRoot: string,
  options: ObservabilityQueryOptions
): ScopedRead {
  const sessionId = resolveSessionId(options.session, projectRoot, options.allSessions === true);
  const events =
    sessionId !== undefined
      ? readSessionEvents(projectRoot, sessionId)
      : readAllSessionEvents(projectRoot);
  return { sessionId, events };
}

/**
 * The scope a query answered for: one session, or every session.
 *
 * ONE spelling of that shape, exported because the report command answers
 * with it too: a scope written two ways is a scope that can drift.
 */
export function scopeOf(
  sessionId: string | undefined
): { sessionId: string } | { allSessions: true } {
  return sessionId !== undefined ? { sessionId } : { allSessions: true };
}

export function runStatus(io: ProgramIO, options: ObservabilityQueryOptions): void {
  const projectRoot = resolveProjectRoot(options.project);
  try {
    const { sessionId, events } = readScopedEvents(projectRoot, options);
    const status = aggregateStatus(events);
    const warnings = scopeWarnings(projectRoot, sessionId, status.totalEvents);
    if (sessionId === undefined && status.totalEvents === 0) {
      warnings.push(
        'No observability events found in any session — emit a slice transition via `peaks request transition` to populate.'
      );
    }
    printResult(
      io,
      ok('observability.status', { scope: scopeOf(sessionId), status }, warnings),
      options.json
    );
  } catch (error) {
    printResult(
      io,
      fail(
        'observability.status',
        'OBSERVABILITY_STATUS_FAILED',
        getErrorMessage(error),
        { projectRoot },
        ['Run `peaks observability slices` for per-slice detail']
      ),
      options.json
    );
    process.exitCode = 1;
  }
}

export function runSlices(io: ProgramIO, options: ObservabilityQueryOptions): void {
  const projectRoot = resolveProjectRoot(options.project);
  try {
    const { sessionId, events } = readScopedEvents(projectRoot, options);
    const slices = aggregateSlices(events);
    const warnings = scopeWarnings(projectRoot, sessionId, events.length);
    printResult(
      io,
      ok(
        'observability.slices',
        { scope: scopeOf(sessionId), total: slices.length, slices },
        warnings
      ),
      options.json
    );
  } catch (error) {
    printResult(
      io,
      fail(
        'observability.slices',
        'OBSERVABILITY_SLICES_FAILED',
        getErrorMessage(error),
        { projectRoot },
        []
      ),
      options.json
    );
    process.exitCode = 1;
  }
}

export function runFanout(io: ProgramIO, options: ObservabilityQueryOptions): void {
  const projectRoot = resolveProjectRoot(options.project);
  try {
    const { sessionId, events } = readScopedEvents(projectRoot, options);
    const fanout = aggregateFanout(events);
    const warnings = scopeWarnings(projectRoot, sessionId, events.length);
    if (fanout.total === 0) {
      warnings.push(
        'No dispatch events recorded in this scope — the fanout breakdown counts the dispatch events of the scope that was read.'
      );
    }
    printResult(
      io,
      ok('observability.fanout', { scope: scopeOf(sessionId), fanout }, warnings),
      options.json
    );
  } catch (error) {
    printResult(
      io,
      fail(
        'observability.fanout',
        'OBSERVABILITY_FANOUT_FAILED',
        getErrorMessage(error),
        { projectRoot },
        []
      ),
      options.json
    );
    process.exitCode = 1;
  }
}

export function runRepairCycles(io: ProgramIO, options: ObservabilityQueryOptions): void {
  const projectRoot = resolveProjectRoot(options.project);
  try {
    // `--all-sessions` is the escape from the canonical-session binding: the
    // recorded history (every session in the project) is the population the
    // results baseline and the metric comparison are measured over.
    const { sessionId, events } = readScopedEvents(projectRoot, options);
    const cycles = aggregateRepairCycles(events);
    printResult(
      io,
      ok(
        'observability.repair-cycles',
        { scope: scopeOf(sessionId), cycles },
        scopeWarnings(projectRoot, sessionId, events.length)
      ),
      options.json
    );
  } catch (error) {
    printResult(
      io,
      fail(
        'observability.repair-cycles',
        'OBSERVABILITY_REPAIR_CYCLES_FAILED',
        getErrorMessage(error),
        { projectRoot },
        []
      ),
      options.json
    );
    process.exitCode = 1;
  }
}
