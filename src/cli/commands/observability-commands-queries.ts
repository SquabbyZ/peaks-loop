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

export function resolveSessionId(
  optionSession: string | undefined,
  projectRoot: string
): string | undefined {
  if (optionSession !== undefined) return optionSession;
  return getSessionIdCanonical(projectRoot) ?? undefined;
}

export function runStatus(
  io: ProgramIO,
  options: { project?: string; session?: string; json?: boolean }
): void {
  const projectRoot = resolveProjectRoot(options.project);
  const sessionId = resolveSessionId(options.session, projectRoot);
  try {
    const events =
      sessionId !== undefined
        ? readSessionEvents(projectRoot, sessionId)
        : readAllSessionEvents(projectRoot);
    const status = aggregateStatus(events);
    const warnings: string[] =
      sessionId === undefined && status.totalEvents === 0
        ? [
            'No observability events found in any session — emit a slice transition via `peaks request transition` to populate.'
          ]
        : [];
    printResult(
      io,
      ok(
        'observability.status',
        {
          scope: sessionId !== undefined ? { sessionId } : { allSessions: true },
          status
        },
        warnings
      ),
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

export function runSlices(
  io: ProgramIO,
  options: { project?: string; session?: string; json?: boolean }
): void {
  const projectRoot = resolveProjectRoot(options.project);
  const sessionId = resolveSessionId(options.session, projectRoot);
  try {
    const events =
      sessionId !== undefined
        ? readSessionEvents(projectRoot, sessionId)
        : readAllSessionEvents(projectRoot);
    const slices = aggregateSlices(events);
    printResult(
      io,
      ok(
        'observability.slices',
        {
          scope: sessionId !== undefined ? { sessionId } : { allSessions: true },
          total: slices.length,
          slices
        },
        []
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

export function runFanout(
  io: ProgramIO,
  options: { project?: string; session?: string; json?: boolean }
): void {
  const projectRoot = resolveProjectRoot(options.project);
  const sessionId = resolveSessionId(options.session, projectRoot);
  try {
    const events =
      sessionId !== undefined
        ? readSessionEvents(projectRoot, sessionId)
        : readAllSessionEvents(projectRoot);
    const fanout = aggregateFanout(events);
    const warnings: string[] =
      fanout.total === 0
        ? [
            'No dispatch events recorded yet — Slice C will wire `peaks sub-agent dispatch`; until then fanout is empty.'
          ]
        : [];
    printResult(
      io,
      ok(
        'observability.fanout',
        {
          scope: sessionId !== undefined ? { sessionId } : { allSessions: true },
          fanout
        },
        warnings
      ),
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

export function runRepairCycles(
  io: ProgramIO,
  options: { project?: string; session?: string; json?: boolean }
): void {
  const projectRoot = resolveProjectRoot(options.project);
  const sessionId = resolveSessionId(options.session, projectRoot);
  try {
    const events =
      sessionId !== undefined
        ? readSessionEvents(projectRoot, sessionId)
        : readAllSessionEvents(projectRoot);
    const cycles = aggregateRepairCycles(events);
    printResult(
      io,
      ok(
        'observability.repair-cycles',
        {
          scope: sessionId !== undefined ? { sessionId } : { allSessions: true },
          cycles
        },
        []
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
