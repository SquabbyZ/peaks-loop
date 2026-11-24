/**
 * Combines MutationReport + AssertionsReport into MutReportJson, computes
 * thresholds, derives followups, computes MUT.sig, writes file atomically.
 *
 * Hard constraints:
 *   H8 (audit trail hashable): MUT.sig is sha256 of normalized content;
 *       generatedAt + sha256 are excluded from the digest to make the
 *       signature deterministic across runs.
 *   H6 (CLI裁决): passed boolean + followups computed by CLI, not LLM.
 *   KISS: keep composition narrow — input, thresholds, output file path.
 */
import { createHash } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  MutReportSchema,
  type AssertionsReport,
  type EvaluatedAxes,
  type Followup,
  type MutationReport,
  type MutReportJson
} from './types.js';
import { DEFAULT_THRESHOLDS, evaluateThresholds, type Thresholds } from './thresholds.js';

/**
 * Which pipeline produced the report. `run` executes Stryker + the
 * assertion scan; `asserts` scans assertions only and carries an empty
 * mutation block, so the mutation threshold must not be judged.
 */
export type MutReportMode = 'run' | 'asserts';

export interface BuildMutInput {
  readonly mutation: MutationReport;
  readonly assertions: AssertionsReport;
  readonly inputSig: string;
  readonly out: string;
  readonly mode?: MutReportMode;
  readonly thresholds?: Thresholds;
  readonly now?: () => Date;
}

/** The axes a mode measures. Only `asserts` drops an axis. */
function evaluatedAxesFor(mode: MutReportMode): EvaluatedAxes {
  return mode === 'asserts'
    ? { mutation: false, assertions: true }
    : { mutation: true, assertions: true };
}

function deriveFollowups(
  m: MutationReport,
  a: AssertionsReport,
  t: Thresholds,
  evaluated: EvaluatedAxes
): ReadonlyArray<Followup> {
  const out: Followup[] = [];
  if (evaluated.mutation && m.killRate < t.mutationKillRateMin) {
    for (const f of m.byFile) {
      if (f.killRate < t.mutationKillRateMin) {
        out.push({
          file: f.file,
          issue: 'low_kill_rate',
          severity: 'soft',
          suggestion: `Add tests for ${f.survived.length} survived mutants in ${f.file}`
        });
      }
    }
  }
  if (evaluated.assertions && a.weakRate > t.weakAssertionRateMax) {
    for (const p of a.weakPatterns) {
      if (p.count > 0) {
        const exampleFile = p.examples[0]?.file ?? '<unknown>';
        out.push({
          file: exampleFile,
          issue: 'high_weak_assertions',
          severity: 'hard',
          suggestion: `Replace ${p.count} weak assertions of type "${p.pattern}" with concrete value checks`
        });
      }
    }
  }
  return out;
}

/**
 * Recursively sort object keys to produce a canonical JSON string.
 * Arrays preserve order; only object keys are sorted.
 */
function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => canonicalize(v));
  }
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = canonicalize(obj[key]);
  }
  return sorted;
}

function sha256OfCanonical(value: unknown): string {
  const canonical = JSON.stringify(canonicalize(value));
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Compute MUT.sig: sha256 of the report content excluding generatedAt and
 * sha256 itself. Both fields are removed before canonicalization so the
 * digest is stable across runs that differ only in timestamp.
 */
function computeMutSig(report: Omit<MutReportJson, 'sha256'>): string {
  const { generatedAt: _g, ...rest } = report;
  void _g;
  return sha256OfCanonical(rest);
}

export async function buildMutReport(input: BuildMutInput): Promise<MutReportJson> {
  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS;
  const now = input.now ?? (() => new Date());
  const evaluated = evaluatedAxesFor(input.mode ?? 'run');
  const evalResult = evaluateThresholds(
    thresholds,
    input.mutation.killRate,
    input.assertions.weakRate,
    evaluated
  );
  const followups = deriveFollowups(input.mutation, input.assertions, thresholds, evaluated);

  const partial: Omit<MutReportJson, 'sha256'> = {
    version: '1.0',
    generatedAt: now().toISOString(),
    inputSig: input.inputSig,
    mutation: input.mutation,
    assertions: input.assertions,
    thresholds: {
      mutationKillRateMin: thresholds.mutationKillRateMin,
      weakAssertionRateMax: thresholds.weakAssertionRateMax,
      passed: evalResult.passed,
      evaluated: evalResult.evaluated
    },
    followups
  };
  const sha256 = computeMutSig(partial);
  const final: MutReportJson = { ...partial, sha256 };

  MutReportSchema.parse(final);

  await mkdir(dirname(input.out), { recursive: true });
  const tmp = `${input.out}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(final, null, 2), 'utf8');
    await rename(tmp, input.out);
  } catch (err: unknown) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }

  return final;
}
