// src/services/race/pilot-gate-store.ts
//
// THE ONLY I/O MODULE of the race-lane gate-2 evidence. `gate2-evaluator.ts`
// judges; this file reads and writes, and nothing else may.
//
// WHY THE EVIDENCE IS TRACKED. Gate 2 gates a switch of `skills/peaks-audit/SKILL.md`
// to "offered by default" — a tracked change, which must be judged on tracked
// evidence. If `pilot-gate.json` lived under `.peaks/_runtime/` it would be
// gitignored, the guard would read nothing on a clean CI clone, and "did the gate
// pass?" would remain a local fact rather than a repository fact.
//
// WHAT THIS FILE DOES NOT PROVE. The per-task prose traces stay gitignored
// (`.peaks/_runtime/<sessionId>/race/<rid>.md`), so the rows here were extracted
// from them and committed. Nothing in this repository can prove those rows came
// from tasks that were really run; the guard can only prove the rows, the counts,
// the verdict and the SKILL.md marker are mutually consistent.
//
// THE POLICY BLOCK IN THE FILE IS A RECORD, NOT THE AUTHORITY. The thresholds a
// verdict is computed from are `RACE_GATE2_POLICY_V1` in `gate2-policy.ts`. Were
// the file's own block the computational source, weakening it in a commit would
// launder the gate it exists to hold. The writer copies the constant into the
// block verbatim, and a reader can compare `recordedPolicyVersion` against the
// policy it was judged under.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CLI_VERSION } from 'peaks-loop-shared/version';
import { z } from 'zod';

import { isUnsafePathInput } from '../../shared/path-safety.js';
import { REQUEST_ID_PATTERN } from '../artifacts/request-artifact-service.js';
import {
  evaluatePilotGate,
  type PilotGateEvaluation,
  type PilotTaskRow
} from './gate2-evaluator.js';
import { RACE_GATE2_POLICY_V1, RACE_GATE2_POLICY_VERSION } from './gate2-policy.js';

/** `fast-lane-norm.md` §2 numbers the risk surfaces 1..7; a value outside that is a typo, not a row. */
export const RISK_SURFACE_MAX = 7;

/**
 * The file's own note, written by the writer so the artifact cannot be produced
 * without it. Two claims it must carry, per PRD §4 and §5.3: what the evidence
 * does NOT prove, and which of the two policy blocks is authoritative.
 */
export const PILOT_GATE_NOTE = [
  'Gate-2 evidence for the peaks-race-code fast lane.',
  'WHY IT IS TRACKED: gate 2 gates a TRACKED change (skills/peaks-audit/SKILL.md), so it is judged on tracked evidence; under .peaks/_runtime/ it would be gitignored, and whether the gate passed would stay a local fact.',
  'WHAT IT DOES NOT PROVE: the per-task prose traces (.peaks/_runtime/<sessionId>/race/<rid>.md) are gitignored, so these rows were extracted from them and committed. Nothing in this repository can prove they came from tasks that were really run; a guard can only prove the rows, the counts, the verdict and the SKILL.md marker are mutually consistent.',
  'WHICH POLICY IS AUTHORITATIVE: src/services/race/gate2-policy.ts. The policy block below is the RECORD of what was applied, copied verbatim from that constant; a verdict is always computed from the constant, never from this file — otherwise weakening this block would launder the gate.',
  'ciRed false means no CI failure is attributed to this task, NOT that CI was green on its commit.',
  'missedRiskSurface false means no missed risk surface is known; no procedure exists yet for setting it (U-C), so it is a required value with nothing behind it.'
].join(' ');

export const LANE_CHOSEN_BY_VALUES = ['user-named', 'user-picked'] as const;
export const OUTCOME_VALUES = ['landed', 'escalated', 'stopped'] as const;
export const HANDLING_VALUES = ['refused', 'escalated', 'user-override-recorded', 'none'] as const;

/**
 * One evidence row. `z.object` strips unknown keys, so an author-written
 * `coreCapability: true` is ignored rather than honoured — the coverage value is
 * derived (§3.2) and there is deliberately no field that can assert it.
 */
const pilotTaskRowSchema = z.object({
  rid: z.string().min(1),
  sessionId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  laneChosenBy: z.enum(LANE_CHOSEN_BY_VALUES),
  outcome: z.enum(OUTCOME_VALUES),
  filesChanged: z.array(z.string()),
  riskSurfacesHit: z.array(z.number().int()),
  riskSurfaceHandling: z.enum(HANDLING_VALUES),
  rolledBack: z.boolean(),
  ciRed: z.boolean(),
  missedRiskSurface: z.boolean()
});

/**
 * The reader needs what it judges with and nothing else. `tasks` is required —
 * a file whose rows cannot be read is not a verdict, it is unreadable evidence.
 * `policyVersion` is read for the report. The rest of the artifact
 * (`evaluatorVersion`, `updatedAt`, `policy`, `lastEvaluation`) is the writer's
 * record and is deliberately NOT a precondition for judging: PRD §3 versions the
 * policy precisely so that a file written under a different version stays
 * readable instead of turning into a parse error.
 */
const pilotGateFileSchema = z.object({
  policyVersion: z.string().optional(),
  tasks: z.array(pilotTaskRowSchema)
});

export type PilotGateFile = {
  // `| undefined` is required by `exactOptionalPropertyTypes`: zod produces the
  // key with an `undefined` value when the file omits it.
  readonly policyVersion?: string | undefined;
  readonly tasks: readonly PilotTaskRow[];
};

export type ReadPilotGateResult =
  | { readonly kind: 'ok'; readonly path: string; readonly gate: PilotGateFile }
  | { readonly kind: 'missing'; readonly path: string }
  | { readonly kind: 'invalid'; readonly path: string; readonly message: string };

export type PilotTaskInput = {
  readonly rid: string;
  readonly sessionId: string;
  readonly date: string;
  readonly laneChosenBy: string;
  readonly outcome: string;
  readonly filesChanged: readonly string[];
  readonly riskSurfacesHit: readonly number[];
  readonly riskSurfaceHandling: string;
  readonly rolledBack: boolean;
  readonly ciRed: boolean;
  readonly missedRiskSurface: boolean;
};

export function pilotGatePath(projectRoot: string): string {
  return join(projectRoot, '.peaks', 'race', 'pilot-gate.json');
}

export function readPilotGate(projectRoot: string): ReadPilotGateResult {
  const path = pilotGatePath(projectRoot);
  if (!existsSync(path)) return { kind: 'missing', path };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return {
      kind: 'invalid',
      path,
      message: error instanceof Error ? error.message : String(error)
    };
  }
  const parsed = pilotGateFileSchema.safeParse(raw);
  if (!parsed.success) {
    return { kind: 'invalid', path, message: describeIssues(parsed.error) };
  }
  return { kind: 'ok', path, gate: parsed.data };
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    .join('; ');
}

/** Backslashes are normalized rather than refused: a path is a path on either shell. */
function normalizeFiles(
  files: readonly string[]
):
  | { readonly ok: true; readonly files: string[] }
  | { readonly ok: false; readonly message: string } {
  const normalized: string[] = [];
  for (const file of files) {
    const path = file.replace(/\\/g, '/');
    if (isUnsafePathInput(path)) {
      return {
        ok: false,
        message: `--file must be repository-relative, got ${JSON.stringify(file)}`
      };
    }
    normalized.push(path);
  }
  return { ok: true, files: normalized };
}

/**
 * The one rule no schema can state: a hit with no disposition is a MISSING
 * record, and accepting it silently would make the coverage derivation credit
 * nothing and say nothing.
 */
function checkRiskSurfaces(surfaces: readonly number[], handling: string): string | null {
  for (const surface of surfaces) {
    if (!Number.isInteger(surface) || surface < 1 || surface > RISK_SURFACE_MAX) {
      return `--risk-surface must be an integer 1..${RISK_SURFACE_MAX}, got ${surface}`;
    }
  }
  if (surfaces.length > 0 && handling === 'none') {
    return '--risk-surface-handling cannot be "none" when --risk-surface is present: a hit with no disposition is a missing record, not a clean row';
  }
  return null;
}

/**
 * Validate one row, fail-closed, each refusal naming the rule it broke. Nothing
 * is written when this returns `invalid`.
 */
export function buildPilotTaskRow(
  input: PilotTaskInput
):
  | { readonly kind: 'ok'; readonly row: PilotTaskRow }
  | { readonly kind: 'invalid'; readonly message: string } {
  const invalid = (message: string): { readonly kind: 'invalid'; readonly message: string } => ({
    kind: 'invalid',
    message
  });

  // The rule is the id PATTERN, not a prefix: a name may key a row, it may not
  // veto one. Snapshot of `.peaks/_runtime/*/rd/requests/` on 2026-10-13 — 97
  // ids, 39 prefixed, 58 not — so the test this replaces refused 58 of 97 of
  // what the repository mints. `REQUEST_ID_PATTERN` is imported rather than
  // re-spelled so this site cannot drift, and it is STRICTER than that test:
  // the old one accepted `rid-/abs`, this one refuses it.
  if (!REQUEST_ID_PATTERN.test(input.rid)) {
    return invalid(
      `--rid must match ${REQUEST_ID_PATTERN.source}, got ${JSON.stringify(input.rid)}`
    );
  }
  // `isUnsafePathInput` is the predicate `guardRuntimeSegment` is built on; the
  // ids and the file paths are checked BEFORE anything is written. THIS RID ARM
  // IS UNREACHABLE-TRUE: every string the pattern admits is one `[A-Za-z0-9._-]`
  // segment starting alphanumeric, so it always passes, and it is KEPT as
  // defence in depth — the invariant, not the test, makes the write safe. The
  // SESSION arm below is the live one; `../../PWNED` reaches and is refused by it.
  if (isUnsafePathInput(input.rid)) {
    return invalid(`--rid must be a single safe path segment, got ${JSON.stringify(input.rid)}`);
  }
  if (isUnsafePathInput(input.sessionId)) {
    return invalid(
      `--session-id must be a single safe path segment, got ${JSON.stringify(input.sessionId)}`
    );
  }

  const files = normalizeFiles(input.filesChanged);
  if (!files.ok) return invalid(files.message);

  const surfaceProblem = checkRiskSurfaces(input.riskSurfacesHit, input.riskSurfaceHandling);
  if (surfaceProblem !== null) return invalid(surfaceProblem);

  const parsed = pilotTaskRowSchema.safeParse({ ...input, filesChanged: files.files });
  if (!parsed.success) return invalid(describeIssues(parsed.error));
  return { kind: 'ok', row: parsed.data };
}

/**
 * Idempotent upsert of one row, keyed by `--rid`: a repeated rid replaces that
 * row in place (first-seen order preserved), a new rid is appended. The writer is
 * also the only thing that can refresh `lastEvaluation` — the reader owns no file
 * — which is what keeps the committed evaluation from going stale.
 *
 * Throws when the existing file cannot be read: clobbering unreadable evidence
 * with a fresh one-row file would silently destroy rows.
 */
export function upsertPilotTask(
  projectRoot: string,
  row: PilotTaskRow,
  now: Date = new Date()
): { readonly path: string; readonly evaluation: PilotGateEvaluation } {
  const existing = readPilotGate(projectRoot);
  if (existing.kind === 'invalid') {
    throw new Error(`PILOT_GATE_EVIDENCE_INVALID: ${existing.path}: ${existing.message}`);
  }
  const previousTasks = existing.kind === 'ok' ? existing.gate.tasks : [];
  const index = previousTasks.findIndex((task) => task.rid === row.rid);
  const tasks =
    index === -1
      ? [...previousTasks, row]
      : previousTasks.map((task, at) => (at === index ? row : task));

  const evaluation = evaluatePilotGate(tasks, RACE_GATE2_POLICY_V1);
  writePilotGate(projectRoot, tasks, evaluation, now);
  return { path: pilotGatePath(projectRoot), evaluation };
}

/**
 * The full artifact the writer owns. The `policy` block is copied from the code
 * constant verbatim — it records what was applied, and a test asserts the two are
 * byte-equal so the record cannot drift from the source.
 */
function writePilotGate(
  projectRoot: string,
  tasks: readonly PilotTaskRow[],
  evaluation: PilotGateEvaluation,
  now: Date
): void {
  const path = pilotGatePath(projectRoot);
  const artifact = {
    note: PILOT_GATE_NOTE,
    policyVersion: RACE_GATE2_POLICY_VERSION,
    evaluatorVersion: CLI_VERSION,
    updatedAt: now.toISOString(),
    policy: RACE_GATE2_POLICY_V1,
    tasks,
    lastEvaluation: { ...evaluation, evaluatedAt: now.toISOString() }
  };
  // Temp file in the same directory, then rename: a crash mid-write leaves the
  // previous valid evidence intact rather than a truncated one.
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
}
