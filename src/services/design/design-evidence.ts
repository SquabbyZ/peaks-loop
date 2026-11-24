/**
 * Conformance evidence for `peaks design check --gate`.
 *
 * The check writes the pair itself and nothing else may: a verdict a later gate
 * reads must come from a check that ran, so a hand-authored file is not evidence.
 * Both files land under `.peaks/_runtime/<sessionId>/design/`; the session id and
 * the request id are the only caller-supplied path segments, and both are refused
 * before any directory is created.
 *
 * The JSON sha256 covers the result exactly as `checkDesign` returned it — no
 * metadata is folded in before hashing, so a consumer can recompute it from the
 * result portion of the document.
 *
 * Caller-controlled strings are neutralized before they reach the markdown,
 * because the prerequisite reads its accepted verdicts as whole-body
 * substrings. That includes the engine's own `grade` (`fidelity.json` is a
 * project-reachable file), which could otherwise forge a heading or the pass
 * marker. The JSON is written before the markdown, so a partially written
 * pair never leaves the gate a readable pass.
 */
import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { repoRelativeKey } from '../../shared/path-utils.js';
import { getSessionDir, isSinglePathSegment } from '../session/getSessionDir.js';
import type { DesignCheckResult } from './design-check.js';
import type { G3AResult } from './design-check-g3.js';
import type { G3BRouteResult, G3ExemplarCheck } from './design-check-g3-suite.js';
import type { DesignFinding } from './source-scan/scan-file.js';

/** The verdict vocabulary the prerequisite reads; `accepted` is not a check verdict. */
export type ConformanceMarker =
  'pass' | 'fail' | 'blocked' | 'not-adopted' | 'not-applicable' | 'accepted';

export type ConformanceEvidenceMeta = {
  rid: string;
  sessionId: string;
  generatedAt: string;
  sha256: string;
};

export type WriteConformanceEvidenceInput = {
  projectRoot: string;
  sessionId: string;
  rid: string;
  result: DesignCheckResult;
  now?: () => Date;
};

export type WrittenConformanceEvidence = {
  markdownPath: string;
  jsonPath: string;
  sha256: string;
};

/** The refusal for a session/request id that is not one path segment. */
export class DesignEvidencePathError extends Error {
  readonly code = 'DESIGN_EVIDENCE_PATH_INVALID';
  readonly field: 'sessionId' | 'rid';

  constructor(field: 'sessionId' | 'rid', value: string) {
    super(`The design evidence ${field} must be a single path segment: ${value}`);
    this.name = 'DesignEvidencePathError';
    this.field = field;
  }
}

/**
 * An acceptance recorded by a human upgrades a source-only PASS to `accepted`.
 * It never upgrades anything else: `checkDesign` also stamps `acceptedBy` on a
 * failing result, so a marker derived from that field alone would turn a fail
 * or blocked check into an accepted one at the gate.
 */
export function markerOf(result: DesignCheckResult): ConformanceMarker {
  if (result.verdict === 'pass' && result.acceptedBy != null) return 'accepted';
  return result.verdict;
}

/** sha256 hex over the result as returned by `checkDesign`; metadata is not folded in. */
export function sha256OfResult(result: DesignCheckResult): string {
  return createHash('sha256').update(JSON.stringify(result)).digest('hex');
}

/**
 * Neutralize a caller-controlled value before it reaches the gate-read
 * markdown. A line break could forge a heading or a verdict line, and the
 * literal verdict marker must never appear as a substring of a path, reason or
 * finding message: the prerequisite's `mustContainAny` is a whole-body
 * substring match, so `design conformance: pass` inside a changed file name
 * would otherwise satisfy a fail or blocked run. The JSON keeps raw values.
 */
function neutralize(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/design-conformance:/gi, 'design-conformance_');
}

function surfaceLines(result: DesignCheckResult): string[] {
  const lines = [`- isUi: ${String(result.surface.isUi)}`];
  if (result.surface.reasons.length === 0) return [...lines, '- reason: (none)'];
  return [...lines, ...result.surface.reasons.map((reason) => `- reason: ${neutralize(reason)}`)];
}

function findingLine(finding: DesignFinding): string {
  return `- ${finding.code} (${finding.severity}) ${neutralize(finding.file)}:${finding.line}: ${neutralize(finding.message)}`;
}

function findingLines(findings: readonly DesignFinding[]): string[] {
  if (findings.length === 0) return ['- (none)'];
  return findings.map(findingLine);
}

function g3aText(run: G3AResult): string {
  const route = neutralize(run.route);
  if (run.status === 'skipped') return `${route} skipped (${run.reason})`;
  if (run.status === 'blocked') return `${route} blocked (${run.code})`;
  const score = `${String(run.score)}/${String(run.min)}`;
  const visual = run.visual === null ? 'n/a' : String(run.visual);
  const motion = run.motion === null ? 'n/a' : String(run.motion);
  const grade = neutralize(run.grade ?? 'n/a');
  return `${route} ${run.status} (score ${score}, visual ${visual}, motion ${motion}, grade ${grade})`;
}

function g3bText(run: G3BRouteResult): string {
  const route = neutralize(run.route);
  if (run.status === 'skipped') return `${route} skipped (${run.reason ?? 'no-reason'})`;
  if (run.status === 'blocked') return `${route} blocked (${run.code ?? 'blocked'})`;
  const total = run.total === undefined ? 'n/a' : String(run.total);
  const reason = run.reason === undefined ? '' : `, ${run.reason}`;
  return `${route} ${run.status} (rubric ${total}/40${reason})`;
}

/** Status, score split and rubric total only — the URLs stay in the JSON. */
function g3ExemplarLine(check: G3ExemplarCheck): string {
  const g3a = check.g3a.map(g3aText).join(', ') || 'not-run';
  const g3b = check.g3b.map(g3bText).join(', ') || 'not-run';
  return `- g3_exemplar: g3a ${g3a}; g3b ${g3b}`;
}

/** The literal markdown the prerequisite's `mustContain` markers are read from. */
export function renderConformanceMarkdown(
  result: DesignCheckResult,
  meta: ConformanceEvidenceMeta
): string {
  const lines = [
    'schemaVersion: 1',
    `rid: ${neutralize(meta.rid)}`,
    `session: ${neutralize(meta.sessionId)}`,
    `generatedAt: ${meta.generatedAt}`,
    `sha256: ${meta.sha256}`,
    '',
    '## Design conformance',
    `design-conformance: ${markerOf(result)}`,
    '',
    '## Surface',
    ...surfaceLines(result),
    '',
    '## Checks',
    `- g1_source: ${result.checks.g1_source.status} (${result.checks.g1_source.findings.length} findings)`,
    `- g2_render: ${result.checks.g2_render.status}`,
    g3ExemplarLine(result.checks.g3_exemplar),
    '',
    '## Findings',
    ...findingLines(result.findings),
    ''
  ];
  return lines.join('\n');
}

function requireSegment(field: 'sessionId' | 'rid', value: string): void {
  if (!isSinglePathSegment(value)) throw new DesignEvidencePathError(field, value);
}

/**
 * Write `check-<rid>.md` and `check-<rid>.json` for one check result.
 *
 * Both path segments are validated first, so a refusal leaves the tree untouched;
 * the design directory is created only after that, which also covers the case
 * where the session directory does not exist yet.
 */
export async function writeConformanceEvidence(
  input: WriteConformanceEvidenceInput
): Promise<WrittenConformanceEvidence> {
  requireSegment('sessionId', input.sessionId);
  requireSegment('rid', input.rid);

  const generatedAt = (input.now?.() ?? new Date()).toISOString();
  const sha256 = sha256OfResult(input.result);
  const designDir = join(getSessionDir(input.projectRoot, input.sessionId), 'design');
  const markdownPath = join(designDir, `check-${input.rid}.md`);
  const jsonPath = join(designDir, `check-${input.rid}.json`);
  const evidencePath = repoRelativeKey(markdownPath, input.projectRoot);
  const markdown = renderConformanceMarkdown(input.result, {
    rid: input.rid,
    sessionId: input.sessionId,
    generatedAt,
    sha256
  });
  const document = {
    ...input.result,
    session: input.sessionId,
    generatedAt,
    sha256,
    evidencePath
  };

  await mkdir(designDir, { recursive: true });
  // The gate reads the markdown, so it is written LAST: a failure at either
  // write must not leave a gate-readable file behind. If the second write
  // fails, the json this call wrote is removed before the error surfaces; a
  // directory occupying the failing path is left untouched.
  const written: string[] = [];
  try {
    await writeFile(jsonPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
    written.push(jsonPath);
    await writeFile(markdownPath, markdown, 'utf8');
    written.push(markdownPath);
  } catch (error) {
    // Best effort: every removal outcome is awaited but deliberately ignored,
    // because the write error is the one the caller must see.
    await Promise.allSettled(written.map((path) => rm(path, { force: true })));
    throw error;
  }
  return { markdownPath, jsonPath, sha256 };
}
