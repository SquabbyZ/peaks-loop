/**
 * `src/cli/commands/observability-commands-session-row.ts`
 *
 * `peaks observability session-row` — the production caller of the per-session
 * metric row, and the reader of the compliance rate.
 *
 * WHY IT IS ON DEMAND. The row and the judge had no caller outside their own
 * tests, so neither was reachable. This command is the caller: it reads the
 * scoped session, judges every slice it recorded against the peaks-rd spec,
 * writes the tracked row, and prints the rates it was built from. No session-end
 * hook exists to attach to, so the row is written when the command is asked for.
 *
 * WHY THE RATE IS NULL WHEN NOTHING WAS JUDGED. A compliance rate is the share of
 * declared steps that ran. A session with no judged slice has no such share: 0
 * would read as "judged, and nothing ran", which nothing observed. So the rate
 * is null and the reason says why, the same coverage rule the near-miss rate uses.
 *
 * WHY THE SPEC IS PEAKS-RD ONLY. The fast-lane spec's steps describe a lane that
 * writes no RD artifacts, so judging an RD slice against it would report a rate
 * that measures the wrong skill. Each reading names its spec, so a second spec
 * can be added later without changing the shape.
 */

import type { Command } from 'commander';
import { fail, ok } from 'peaks-loop-shared/result';

import { PEAKS_RD_SPEC } from '../../services/observability/compliance-specs/peaks-rd.spec.js';
import {
  buildSessionMetricRow,
  judgeSessionCompliance,
  readSkillsBlobSha,
  sessionMetricRowPath,
  writeSessionMetricRow,
  type SessionComplianceReading,
  type SessionMetricRow
} from '../../services/observability/session-metric-rows.js';
import type { ObservabilityEvent } from '../../services/observability/observability-service.js';
import { isSinglePathSegment } from '../../services/session/getSessionDir.js';
import { NUMBERED_PREFIX_RE } from '../../shared/incrementing-number.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { hotspotRequestTypes } from './observability-commands-hotspots.js';
import {
  readScopedEvents,
  resolveProjectRoot,
  scopeOf,
  scopeWarnings,
  type ObservabilityQueryOptions
} from './observability-commands-queries.js';

/** The compliance rate of a session, or the reason it was not observed. */
export type ComplianceSummary = {
  /** The unweighted mean of the judged slices' rates, or null when none was judged. */
  readonly complianceRate: number | null;
  /**
   * Why the rate is null, or why it covers fewer slices than the session
   * recorded. Null when the rate covers every slice the session recorded.
   */
  readonly complianceReason: string | null;
  readonly judgedSliceCount: number;
  /** The recorded slices that could not be judged, and why. */
  readonly rejectedSliceCount: number;
};

/** Summarise the readings. An empty set is unobserved, never a zero rate. */
export function summarizeCompliance(
  readings: readonly SessionComplianceReading[],
  rejectedSliceCount = 0
): ComplianceSummary {
  const rejectedNote =
    rejectedSliceCount === 0
      ? null
      : `${rejectedSliceCount} recorded slice id(s) could NOT be judged, because they are ` +
        'not a single safe path segment — an unobserved slice, not a failed one';
  if (readings.length === 0) {
    // The two reasons are different facts, and the recorded one wins when both
    // hold: a session whose slices were all REJECTED did record slices, so
    // saying "no slice was recorded" would deny the event stream's own content.
    return {
      complianceRate: null,
      complianceReason:
        rejectedNote ??
        'no slice was recorded in this session, so no slice was judged and no compliance ' +
          'rate was observed — an absence of data, not a result',
      judgedSliceCount: 0,
      rejectedSliceCount
    };
  }
  const total = readings.reduce((sum, reading) => sum + reading.complianceRate, 0);
  return {
    complianceRate: total / readings.length,
    complianceReason: rejectedNote,
    judgedSliceCount: readings.length,
    rejectedSliceCount
  };
}

/**
 * The distinct slices the session's events name, split by whether they can be
 * judged, together with the spelling each slice is judged under.
 *
 * WHY A SLICE ID IS CHECKED BEFORE IT BECOMES A PATH. The slice id comes from
 * the event stream, and the judge substitutes it into the spec's declared
 * artifact paths before probing the filesystem. A slice id carrying `..` would
 * therefore move the probe OUTSIDE the session directory, and an artifact
 * planted elsewhere would be credited as a step that ran inside the session.
 * The event stream is a file on disk, so its contents are input like any other:
 * the check belongs here, at the boundary where the id becomes a path.
 *
 * The predicate is the repository's own `isSinglePathSegment`, the same one the
 * session id is held to. A legal slice id is a single segment, so nothing a
 * real slice id carries is refused.
 *
 * WHY THE SLICES ARE KEYED ON THE LOGICAL ID AND NOT ON THE RAW STRING. A
 * slice's id arrives in TWO spellings, from two different producers: the
 * request writer stamps `NNN-` on the artifact FILENAME, while the transition
 * CLI is handed the UN-NUMBERED rid — and the event stream carries both. Keyed
 * on the raw string, ONE slice was judged twice, under two spellings that
 * resolve DIFFERENTLY: the resolver finds the artifacts under the numbered
 * spelling and misses most of them under the bare one, so the same slice was
 * counted once at its real rate and once at a rate its artifacts do not
 * support. The rate's denominator was then the count of SPELLINGS rather than
 * the count of slices, so it was not the mean the slice's contract names.
 *
 * The repository's own rule says which spelling is the slice's identity:
 * `NUMBERED_PREFIX_RE` — the family `buildNumberedFilename` writes and
 * `requestIdFromFileName` strips. Stripping it leaves the LOGICAL slice id,
 * and that is what the sets are keyed on.
 *
 * WHY THE NUMBERED SPELLING IS THE ONE JUDGED. The artifacts on disk carry
 * that number — `rd/requests/002-<rid>.md` and `prd/handoff-002-<rid>.md`
 * alike — so the numbered spelling is the one the resolver can actually find
 * them under. A slice the stream named only in its bare spelling is judged
 * under that spelling, because it is the only one it has.
 *
 * WHY THE SAFETY CHECK RUNS BEFORE THE NORMALISATION. The check is on the RAW
 * id, so a hostile multi-segment id is refused rather than normalised into
 * something that looks safe: stripping a leading `NNN-` can only ever REMOVE
 * characters from an id that is already a single safe segment, and can never
 * turn one segment into two or into a traversal.
 */
function partitionSliceRids(events: readonly ObservabilityEvent[]): {
  readonly judged: readonly string[];
  readonly rejected: readonly string[];
} {
  const judged = new Map<string, { rid: string; numbered: boolean }>();
  const rejected = new Set<string>();
  for (const event of events) {
    if (event.sliceRid === undefined) continue;
    const rid = event.sliceRid;
    if (!isSinglePathSegment(rid)) {
      rejected.add(rid);
      continue;
    }
    const numbered = NUMBERED_PREFIX_RE.test(rid);
    const logical = rid.replace(NUMBERED_PREFIX_RE, '');
    const existing = judged.get(logical);
    if (existing === undefined) judged.set(logical, { rid, numbered });
    // A numbered spelling resolves artifacts the bare spelling cannot find, so
    // it wins; two spellings of the same family are the same slice either way.
    else if (numbered && !existing.numbered) judged.set(logical, { rid, numbered });
  }
  return { judged: [...judged.values()].map((entry) => entry.rid), rejected: [...rejected] };
}

/** Judge every slice the session recorded against the peaks-rd spec. */
async function judgeSessionSlices(
  projectRoot: string,
  sessionId: string,
  sliceRids: readonly string[]
): Promise<SessionComplianceReading[]> {
  const readings: SessionComplianceReading[] = [];
  for (const sliceRid of sliceRids) {
    readings.push(
      await judgeSessionCompliance({ projectRoot, sessionId, spec: PEAKS_RD_SPEC, sliceRid })
    );
  }
  return readings;
}

/** The warnings the envelope carries: the scope, the spec, and any unobserved rate. */
function sessionRowWarnings(
  projectRoot: string,
  sessionId: string,
  eventCount: number,
  compliance: ComplianceSummary
): string[] {
  const warnings = [
    ...scopeWarnings(projectRoot, sessionId, eventCount),
    `compliance is judged against the \`${PEAKS_RD_SPEC.id}\` spec only.`
  ];
  if (compliance.complianceReason !== null) warnings.push(compliance.complianceReason);
  return warnings;
}

/** The envelope's data: the near-miss rate, the compliance rate, and the row's location. */
function sessionRowData(
  projectRoot: string,
  sessionId: string,
  row: SessionMetricRow,
  compliance: ComplianceSummary
): Record<string, unknown> {
  // The near-miss rate is null when no slice passed: the row stores 0 there,
  // and the command must not present that 0 as a measured rate.
  const nearMissRate = row.passedSliceCount === 0 ? null : row.nearMissRate;
  return {
    scope: scopeOf(sessionId),
    rowPath: sessionMetricRowPath(projectRoot, sessionId),
    nearMissRate,
    nearMissReason:
      nearMissRate === null
        ? 'no slice passed in this session, so the near-miss rate was not observed'
        : null,
    passedSliceCount: row.passedSliceCount,
    nearMissSliceCount: row.nearMissSliceCount,
    ...compliance,
    specIds: [PEAKS_RD_SPEC.id]
  };
}

/**
 * `peaks observability session-row` — write the session's tracked row and print
 * its near-miss and compliance rates.
 */
export async function runSessionRow(
  io: ProgramIO,
  options: ObservabilityQueryOptions
): Promise<void> {
  const projectRoot = resolveProjectRoot(options.project);
  try {
    const { sessionId, events } = readScopedEvents(projectRoot, options);
    if (sessionId === undefined) {
      throw new Error(
        'a session row belongs to one session: pass --session <sessionId>, or run without --all-sessions'
      );
    }
    const { requestTypes } = hotspotRequestTypes(projectRoot, events);
    const { judged, rejected } = partitionSliceRids(events);
    const readings = await judgeSessionSlices(projectRoot, sessionId, judged);
    const skillsBlobSha = readSkillsBlobSha(projectRoot);
    const row = buildSessionMetricRow({
      sessionId,
      events,
      requestTypes,
      compliance: readings,
      ...(skillsBlobSha === undefined ? {} : { skillsBlobSha })
    });
    writeSessionMetricRow(projectRoot, row);

    const compliance = summarizeCompliance(readings, rejected.length);
    printResult(
      io,
      ok(
        'observability.session-row',
        sessionRowData(projectRoot, sessionId, row, compliance),
        sessionRowWarnings(projectRoot, sessionId, events.length, compliance)
      ),
      options.json
    );
  } catch (error) {
    printResult(
      io,
      fail(
        'observability.session-row',
        'OBSERVABILITY_SESSION_ROW_FAILED',
        getErrorMessage(error),
        { projectRoot },
        []
      ),
      options.json
    );
    process.exitCode = 1;
  }
}

/** Register `peaks observability session-row` under the observability command. */
export function registerSessionRowCommand(observability: Command, io: ProgramIO): void {
  addJsonOption(
    observability
      .command('session-row')
      .description(
        "Write the tracked per-session metric row (.peaks/observability/sessions/<sessionId>.json) and print its rates. The near-miss rate is null, with a reason, when no slice passed; the compliance rate is the mean share of the peaks-rd spec's required steps that ran across the session's slices, and is null, with a reason, when no slice was recorded."
      )
      .option('--project <path>', 'target project root (defaults to git root or cwd)')
      .option(
        '--session <sessionId>',
        'scope to one session (defaults to the canonical session binding)'
      )
  ).action(async (options: ObservabilityQueryOptions) => {
    await runSessionRow(io, options);
  });
}
