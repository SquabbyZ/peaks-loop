/**
 * `src/cli/commands/observability-commands-hotspots.ts`
 *
 * `peaks observability hotspots` — which artifact does a skill keep failing
 * to deliver, and who owns it.
 *
 * WHY THE REGISTRATION LIVES HERE AND NOT IN `observability-commands.ts`.
 * That file is at its file-size cap and a later task needs room in it too,
 * so each subcommand's registration lives in its own module and the parent
 * gains one import and one call. The precedent is the sibling split of
 * `observability-commands-queries.ts` and `observability-commands-baseline.ts`.
 *
 * WHY THE REQUEST TYPES ARE RESOLVED HERE. The retro-attribution re-derives
 * a transition's prerequisite list, and the table is indexed by request type —
 * a fact that lives in the request artifact, not in the event stream. The
 * events carry the slice; the request artifact carries the type. So this
 * layer reads the request artifacts and hands the types to the ranking.
 *
 * WHY THE READER IS THE CANONICAL ONE. The `- type:` line is parsed by the
 * repository's own metadata reader, so a value this command accepts is a
 * value the rest of the pipeline accepts. A type line this command does not
 * understand is left unresolved, and its slice contributes no retro-attributed
 * row — reported as a warning, never as a silent omission.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { fail, ok } from 'peaks-loop-shared/result';

import {
  isRequestType,
  type RequestType
} from '../../services/artifacts/artifact-prerequisites.js';
import { extractMetadata } from '../../services/artifacts/request-artifact-metadata.js';
import { guardRuntimeSegment, runtimeRoot } from '../../shared/runtime-root.js';
import { slugifyDescription } from '../../shared/incrementing-number.js';
import { aggregateHotspots } from '../../services/observability/hotspots.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import {
  readScopedEvents,
  resolveProjectRoot,
  scopeOf,
  scopeWarnings,
  type ObservabilityQueryOptions
} from './observability-commands-queries.js';

/** The request artifact roles a request type can be read from. */
const REQUEST_ROLES = ['prd', 'ui', 'rd', 'qa', 'sc'] as const;

/**
 * The declared request type of every request artifact under the project.
 *
 * The map is keyed by the request's SLUG — the same form the artifact's
 * filename carries — because that is the only spelling shared by the file
 * on disk and the request id in the event stream.
 */
function readRequestTypes(projectRoot: string): {
  readonly bySlug: Map<string, RequestType>;
  readonly unparsed: number;
} {
  const bySlug = new Map<string, RequestType>();
  let unparsed = 0;
  const runtime = runtimeRoot(projectRoot);
  let sessions: string[];
  try {
    sessions = readdirSync(runtime.dir(), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return { bySlug, unparsed };
  }
  for (const session of sessions) {
    for (const role of REQUEST_ROLES) {
      const dir = join(
        runtime.join(
          guardRuntimeSegment(session, 'session id'),
          guardRuntimeSegment(role, 'role'),
          guardRuntimeSegment('requests', 'leaf')
        )
      );
      let files: string[];
      try {
        files = readdirSync(dir).filter((name) => name.endsWith('.md'));
      } catch {
        continue;
      }
      for (const file of files) {
        let markdown: string;
        try {
          markdown = readFileSync(join(dir, file), 'utf8');
        } catch {
          continue;
        }
        const { requestType } = extractMetadata(markdown);
        if (!isRequestType(requestType)) {
          unparsed += 1;
          continue;
        }
        const slug = file.replace(/^\d{3}-/, '').replace(/\.md$/, '');
        if (!bySlug.has(slug)) bySlug.set(slug, requestType);
      }
    }
  }
  return { bySlug, unparsed };
}

/**
 * `peaks observability hotspots` — print the hotspot ranking.
 */
export function runHotspots(io: ProgramIO, options: ObservabilityQueryOptions): void {
  const projectRoot = resolveProjectRoot(options.project);
  try {
    const { sessionId, events } = readScopedEvents(projectRoot, options);
    const { bySlug, unparsed } = readRequestTypes(projectRoot);
    const requestTypes = new Map<string, RequestType>();
    for (const event of events) {
      const rid = event.sliceRid;
      if (rid === undefined) continue;
      const type = bySlug.get(slugifyDescription(rid));
      if (type !== undefined && !requestTypes.has(rid)) requestTypes.set(rid, type);
    }
    const hotspots = aggregateHotspots(events, requestTypes);
    const warnings = scopeWarnings(projectRoot, sessionId, events.length);
    if (unparsed > 0) {
      warnings.push(
        `${unparsed} request artifact(s) declare a type this command does not recognise, so the ` +
          'slices they belong to contribute no retro-attributed row.'
      );
    }
    printResult(
      io,
      ok('observability.hotspots', { scope: scopeOf(sessionId), hotspots }, warnings),
      options.json
    );
  } catch (error) {
    printResult(
      io,
      fail(
        'observability.hotspots',
        'OBSERVABILITY_HOTSPOTS_FAILED',
        getErrorMessage(error),
        { projectRoot },
        []
      ),
      options.json
    );
    process.exitCode = 1;
  }
}

/** Register `peaks observability hotspots` under the observability command. */
export function registerHotspotsCommand(observability: Command, io: ProgramIO): void {
  addJsonOption(
    observability
      .command('hotspots')
      .description(
        'Hotspot ranking: which artifact a skill keeps failing to deliver, and who owns it. Grouped by owner, artifact, mode and confidence; `exact` rows are measured, `inferred`/`ambiguous` rows are candidates recovered from a historical count and are NOT proof that the artifact was missing. Each row carries `countMeaning`: `observed-missing` (the artifact was seen missing that many times) or `candidate-mentions` (the artifact was one of the candidates that many times — one real failure counts toward EVERY candidate it could not narrow, so that number is an upper bound, not a count of failures).'
      )
      .option('--project <path>', 'target project root (defaults to git root or cwd)')
      .option(
        '--session <sessionId>',
        'scope to one session (defaults to the canonical session binding)'
      )
      .option(
        '--all-sessions',
        'measure the whole recorded history of the project instead of the canonical session binding'
      )
  ).action((options: ObservabilityQueryOptions) => {
    runHotspots(io, options);
  });
}
