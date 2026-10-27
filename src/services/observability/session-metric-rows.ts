/**
 * `src/services/observability/session-metric-rows.ts`
 *
 * WHY THIS FILE EXISTS. The raw event stream lives in gitignored session
 * state, so a CI runner and a fresh clone have nothing to compare against.
 * The per-session row is the TRACKED artifact that makes the numbers
 * comparable across machines and across time: one JSON file per session,
 * holding that session's aggregate numbers.
 *
 * WHAT THE ROW CARRIES, AND WHAT IT REFUSES TO CARRY. Counts and rates, and
 * nothing else: no event, no free-text reason, no tool input or output. The
 * event stream's `reason` field holds paths and code fragments, and a
 * tracked file is the one place in this program where such text would
 * outlive the session that produced it.
 *
 * WHY THE COMPLIANCE READING IS COMPUTED HERE. The compliance judge asks
 * whether an artifact exists, and the paths it asks about carry an
 * UNRESOLVED `<rid>` placeholder: the judge hands the declared path through
 * verbatim, and the CALLER substitutes the request id. A caller that probes
 * the raw string asks the filesystem about a path that contains the literal
 * `<rid>`, every step misses, and the rate reads 0 without a single error.
 * The substitution is therefore not left to the caller of this module: the
 * reading is produced here, through the repository's own path resolver.
 *
 * WHY THE ROW IS PUBLISHED THROUGH THE SHARED ATOMIC WRITER. A tracked file
 * that a later run reads must never be observed half-written, so the row is
 * written to a temporary file in the same directory and renamed over the
 * target — the same guarantee the lease store gives.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  resolvePrerequisiteAbsolutePathWithFallback,
  sessionRootsFor
} from '../artifacts/prerequisite-path-resolver.js';
import { atomicWriteJson } from '../ide/shared/atomic-json.js';
import { isSinglePathSegment } from '../session/getSessionDir.js';
import { judgeCompliance } from './compliance-judge.js';
import type { ComplianceSpec } from './compliance-spec.js';
import { aggregateHotspots } from './hotspots.js';
import { computeNearMiss } from './near-miss.js';
import type { ObservabilityEvent } from './observability-service.js';

/** Where a session's tracked row lives, relative to the project root. */
export const SESSION_METRIC_ROWS_RELATIVE_PATH = '.peaks/observability/sessions/<sessionId>.json';

/** The row's schema version. */
export const SESSION_METRIC_ROW_SCHEMA_VERSION = 1;

/** The shape of a git object id. */
const GIT_OBJECT_ID_RE = /^[0-9a-f]{40}$/;

/** One slice's compliance reading, inside a session row. */
export type SessionComplianceReading = {
  /** The spec that was judged. */
  readonly specId: string;
  /** The slice the spec was judged against. */
  readonly sliceRid: string;
  /** The share of the spec's REQUIRED steps that ran. */
  readonly complianceRate: number;
};

/** The tracked per-session aggregate row. */
export type SessionMetricRow = {
  readonly schemaVersion: 1;
  readonly sessionId: string;
  readonly generatedAt: string;
  readonly nearMissRate: number;
  readonly passedSliceCount: number;
  readonly nearMissSliceCount: number;
  readonly hotspotCount: number;
  readonly compliance: readonly SessionComplianceReading[];
  readonly skillsBlobSha?: string;
};

/**
 * Judge one slice against one compliance spec, in this session's directory.
 *
 * THE SUBSTITUTION HAPPENS HERE, NOT AT THE CALL SITE. The declared paths
 * carry the `<rid>` placeholder, and the request id is put in before the
 * filesystem is asked — through the repository's own path resolver, which
 * also honours the numbered filename prefix the request writer stamps on.
 *
 * The rate is the share of the spec's REQUIRED steps that ran. A spec that
 * declares no required step demonstrates no compliance and reads 0, which is
 * the judge's own rule and is not restated here.
 */
export async function judgeSessionCompliance(opts: {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly spec: ComplianceSpec;
  readonly sliceRid: string;
}): Promise<SessionComplianceReading> {
  assertSinglePathSegment(opts.sessionId);
  const roots = sessionRootsFor(opts.projectRoot, opts.sessionId);
  const present = new Set<string>();
  for (const step of opts.spec.steps) {
    const resolved = await resolvePrerequisiteAbsolutePathWithFallback(
      roots.canonical,
      roots.legacy,
      { relativePath: step.verify.artifactExists, description: step.description },
      opts.sliceRid
    );
    if (resolved !== null) present.add(step.verify.artifactExists);
  }
  const judged = judgeCompliance(opts.spec, (artifactPath) => present.has(artifactPath));
  return {
    specId: judged.specId,
    sliceRid: opts.sliceRid,
    complianceRate: judged.complianceRate
  };
}

/**
 * Build a session's row from its events.
 *
 * The row carries the metrics a later run compares: the near-miss rate with
 * the two counts behind it, the size of the hotspot ranking, and the
 * compliance readings the caller judged. It carries no event and no prose.
 */
export function buildSessionMetricRow(opts: {
  readonly sessionId: string;
  readonly events: readonly ObservabilityEvent[];
  readonly skillsBlobSha?: string;
  readonly compliance?: readonly SessionComplianceReading[];
}): SessionMetricRow {
  const nearMiss = computeNearMiss(opts.events);
  const hotspots = aggregateHotspots(opts.events);
  return {
    schemaVersion: SESSION_METRIC_ROW_SCHEMA_VERSION,
    sessionId: opts.sessionId,
    generatedAt: new Date().toISOString(),
    nearMissRate: nearMiss.nearMissRate,
    passedSliceCount: nearMiss.passedSliceCount,
    nearMissSliceCount: nearMiss.nearMissSliceCount,
    hotspotCount: hotspots.length,
    compliance: opts.compliance ?? [],
    ...(opts.skillsBlobSha === undefined ? {} : { skillsBlobSha: opts.skillsBlobSha })
  };
}

/**
 * The absolute path of a session's tracked row.
 *
 * The row lives OUTSIDE the session directory, so it cannot route through
 * the session-dir resolver; the SAME predicate is used, so the two cannot
 * disagree about what a legal session id is.
 */
export function sessionMetricRowPath(projectRoot: string, sessionId: string): string {
  assertSinglePathSegment(sessionId);
  return join(projectRoot, '.peaks', 'observability', 'sessions', `${sessionId}.json`);
}

/** Publish a session's row. The write is atomic: a reader sees it whole. */
export function writeSessionMetricRow(projectRoot: string, row: SessionMetricRow): void {
  atomicWriteJson(sessionMetricRowPath(projectRoot, row.sessionId), row);
}

/**
 * The tracked row for a session, or null when the project has none.
 *
 * A row this build cannot read is an ERROR, not an absence: a file that is
 * there and unreadable is a different fact from a file that is not there,
 * and reading it as "no row" would hide a version this build does not know.
 */
export function readSessionMetricRow(
  projectRoot: string,
  sessionId: string
): SessionMetricRow | null {
  const path = sessionMetricRowPath(projectRoot, sessionId);
  if (!existsSync(path)) return null;
  const row = JSON.parse(readFileSync(path, 'utf8')) as SessionMetricRow;
  const version: unknown = row.schemaVersion;
  if (version !== SESSION_METRIC_ROW_SCHEMA_VERSION) {
    throw new Error(
      `session metric row ${path} declares schema version ${String(version)}, ` +
        'which this build does not read'
    );
  }
  return row;
}

/**
 * The git object id of the `skills/` tree, or undefined when there is none.
 *
 * The id is the skills version a session ran against, so a later run can
 * tell whether two sessions measured the same skills. A directory that is
 * not a git repository — or one with no committed `skills/` tree — has no
 * version to report, and "no version" is an answer the caller can read.
 */
export function readSkillsBlobSha(projectRoot: string): string | undefined {
  let sha = '';
  try {
    sha = execFileSync('git', ['rev-parse', 'HEAD:skills'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true
    }).trim();
  } catch {
    sha = '';
  }
  return GIT_OBJECT_ID_RE.test(sha) ? sha : undefined;
}

/** Refuse a session id that is not a single path segment. */
function assertSinglePathSegment(sessionId: string): void {
  if (!isSinglePathSegment(sessionId)) {
    throw new Error(`Invalid session id: ${sessionId} (must be a single path segment)`);
  }
}
