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

import { isRequestType } from '../../services/artifacts/artifact-prerequisites.js';
import { extractMetadata } from '../../services/artifacts/request-artifact-metadata.js';
import { guardRuntimeSegment, runtimeRoot } from '../../shared/runtime-root.js';
import { slugifyDescription } from '../../shared/incrementing-number.js';
import { aggregateHotspots } from '../../services/observability/hotspots.js';
import { summarizeAttribution } from '../../services/observability/hotspot-attribution-summary.js';
import {
  groupHotspotsByMeaning,
  type RequestTypeReading
} from '../../services/observability/hotspot-shared.js';
import type { ObservabilityEvent } from '../../services/observability/observability-service.js';
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
 * The request type of every request artifact under the project, AND where each
 * type came from.
 *
 * The map is keyed by the request's SLUG — the same form the artifact's
 * filename carries — because that is the only spelling shared by the file
 * on disk and the request id in the event stream.
 *
 * WHY THE SOURCE RIDES ALONG WITH THE TYPE. An artifact that declares no
 * usable `- type:` line still has an EFFECTIVE type — the system's default —
 * and that is the type the prerequisite table was indexed by when the
 * transition ran, so the attribution must use it. But the effective type and
 * the fact that NOBODY WROTE IT DOWN are two different facts, and a reader
 * asking "how many of these attributions rested on a type nobody wrote
 * down?" cannot answer it if the reader throws the second fact away.
 *
 * THE TWO BUCKETS ARE NOT THE SAME BUCKET. `unreadable` counts artifacts
 * that could not be READ — their type is unknown, so their slice contributes
 * no retro-attributed row at all. `defaulted` counts artifacts that read
 * fine but carry no usable type line: their slice DOES contribute a row,
 * attributed against the default. Conflating them would report a type nobody
 * wrote down as a type nobody could supply.
 *
 * WHY A DECLARED READING WINS OVER A DEFAULTED ONE FOR THE SAME SLUG. A
 * request's artifact is written once per role, and one role's copy may carry
 * a type line while another's does not. The declared line is the stronger
 * fact — it is what a human wrote — so it is the one that names the type.
 */
function readRequestTypes(projectRoot: string): {
  readonly bySlug: Map<string, RequestTypeReading>;
  readonly unreadable: number;
  readonly defaulted: number;
} {
  const bySlug = new Map<string, RequestTypeReading>();
  const counts = { unreadable: 0, defaulted: 0 };
  const runtime = runtimeRoot(projectRoot);
  let sessions: string[];
  try {
    sessions = readdirSync(runtime.dir(), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return { bySlug, unreadable: counts.unreadable, defaulted: counts.defaulted };
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
        readOneRequestArtifact(dir, file, bySlug, counts);
      }
    }
  }
  return { bySlug, unreadable: counts.unreadable, defaulted: counts.defaulted };
}

/**
 * Read ONE request artifact and fold it into the slug map.
 *
 * WHY IT IS ITS OWN FUNCTION. The reader walks every artifact of every
 * session and role, and the three facts it collects — the reading, the
 * unreadable count, the no-type-line count — are counted as it goes. Folding
 * one artifact's handling into its own function keeps each step readable and
 * keeps the reader's size under the cap.
 *
 * THE COUNTING RULES. An artifact that cannot be READ is `unreadable` — its
 * slice's type is unknown, so nothing can be attributed to it. An artifact
 * that reads but whose type line is unusable is `defaulted` — its slice still
 * gets the default type, and the attribution is real but its provenance is
 * not. The two are different facts and they do not share a bucket.
 */
function readOneRequestArtifact(
  dir: string,
  file: string,
  bySlug: Map<string, RequestTypeReading>,
  counts: { unreadable: number; defaulted: number }
): void {
  let markdown: string;
  try {
    markdown = readFileSync(join(dir, file), 'utf8');
  } catch {
    counts.unreadable += 1;
    return;
  }
  const { requestType, requestTypeSource } = extractMetadata(markdown);
  if (!isRequestType(requestType)) {
    counts.unreadable += 1;
    return;
  }
  if (requestTypeSource === 'default') counts.defaulted += 1;
  const slug = file.replace(/^\d{3}-/, '').replace(/\.md$/, '');
  const existing = bySlug.get(slug);
  if (existing === undefined || existing.source === 'default') {
    bySlug.set(slug, { requestType, source: requestTypeSource });
  }
}

/**
 * The request types of the slices in the scope, keyed by slice rid.
 *
 * The retro-attribution re-derives a transition's prerequisite list from the
 * request type, and the type lives in the request artifact rather than in the
 * event stream — so a caller that wants the HISTORICAL rows has to resolve
 * the types itself. Without them the ranking holds only the forward events,
 * and on a history that predates the forward emitter it holds NOTHING, which
 * would read as "no hotspot" rather than as "no history".
 *
 * ONE IMPLEMENTATION, TWO CALLERS. The `hotspots` command and the `report`
 * command both need the types, and a second copy of the lookup is a copy that
 * drifts — so both go through this function.
 */
export function hotspotRequestTypes(
  projectRoot: string,
  events: readonly ObservabilityEvent[]
): {
  readonly requestTypes: Map<string, RequestTypeReading>;
  readonly unreadable: number;
  readonly defaulted: number;
} {
  const { bySlug, unreadable, defaulted } = readRequestTypes(projectRoot);
  const requestTypes = new Map<string, RequestTypeReading>();
  for (const event of events) {
    const rid = event.sliceRid;
    if (rid === undefined) continue;
    const reading = bySlug.get(slugifyDescription(rid));
    if (reading !== undefined && !requestTypes.has(rid)) requestTypes.set(rid, reading);
  }
  return { requestTypes, unreadable, defaulted };
}

/**
 * What the reader found while it read the request artifacts, said plainly.
 *
 * WHY THE TWO FACTS ARE TWO WARNINGS. An artifact that could not be READ
 * leaves its slice with no type at all, so nothing is attributed to it — that
 * is a GAP. An artifact that read fine but carried no usable type line leaves
 * its slice with the DEFAULT type, so an attribution IS produced, and only its
 * PROVENANCE is weak. One warning per fact, so a reader can tell which
 * happened without reading the code.
 */
function requestTypeWarnings(unreadable: number, defaulted: number): string[] {
  const warnings: string[] = [];
  if (unreadable > 0) {
    warnings.push(
      `${unreadable} request artifact(s) could not be read, so the slices they belong to have ` +
        'no known request type and contribute no retro-attributed row.'
    );
  }
  if (defaulted > 0) {
    warnings.push(
      `${defaulted} request artifact(s) carry no usable \`- type:\` line, so their slices are ` +
        'attributed against the DEFAULT request type — a type nobody wrote down. The ' +
        'attribution is real; its provenance is not.'
    );
  }
  return warnings;
}

/**
 * `peaks observability hotspots` — print the hotspot ranking.
 */
export function runHotspots(io: ProgramIO, options: ObservabilityQueryOptions): void {
  const projectRoot = resolveProjectRoot(options.project);
  try {
    const { sessionId, events } = readScopedEvents(projectRoot, options);
    const { requestTypes, unreadable, defaulted } = hotspotRequestTypes(projectRoot, events);
    const hotspots = aggregateHotspots(events, requestTypes);
    const attribution = summarizeAttribution(events, requestTypes, {
      unreadable,
      withoutTypeLine: defaulted
    });
    const warnings = [
      ...scopeWarnings(projectRoot, sessionId, events.length),
      ...requestTypeWarnings(unreadable, defaulted)
    ];
    printResult(
      io,
      ok(
        'observability.hotspots',
        {
          scope: scopeOf(sessionId),
          hotspots: groupHotspotsByMeaning(hotspots),
          attribution
        },
        warnings
      ),
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
        'Hotspot ranking: which artifact a skill keeps failing to deliver, and who owns it. The rows are split by what their count COUNTS, so the group a row is in says what its number means: `observedOmissions` are MEASURED (the artifact was seen missing that many times) and `candidateMentions` are CANDIDATES recovered from a historical count (one real failure counts toward EVERY candidate it could not narrow, so those numbers are an upper bound, NOT a count of failures). Each row also carries its owner, artifact, mode and confidence; the confidence values are unchanged.'
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
