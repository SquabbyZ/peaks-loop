/**
 * Type-ladder judgement for the S7 audit (Task 6c).
 *
 * Split from `audit-type.ts` when the calibration report demanded that a ratio
 * score always be explainable. The pilot's `usage-logs-table.tsx` scored type 0
 * from five measured sizes and ZERO findings — a number no reader could act on.
 * A value that leaves the declared ladder now emits one finding per distinct
 * value, with its first `file:line` witness and how many times it occurs, so a
 * ratio can never move without a finding behind it.
 *
 * The ladder, its step and the judgement counts live here; the page-level rules
 * (crowded scale, adjacency, weights) stay in `audit-type.ts`.
 */

import type { DesignTokenScale } from '../paved-road.js';
import type { AuditFinding, DimensionJudgement } from './audit-finding.js';
import type { TypeSample } from './type-measure.js';

/** Float tolerance for ladder equality. */
const EPSILON = 1e-6;

export function nearly(left: number, right: number): boolean {
  return Math.abs(left - right) < EPSILON;
}

/** A number as a person reads it: an integer, or two decimals at most. */
export function display(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

/** The distinct readable font sizes a page uses, ascending. */
export function typeSizeLevels(samples: readonly TypeSample[]): number[] {
  const values: number[] = [];
  for (const sample of samples) {
    if (sample.kind === 'size' && sample.px !== null) values.push(Math.abs(sample.px));
  }
  return [...new Set(values)].sort((left, right) => left - right);
}

/** The declared ladder as positive numbers; empty when the contract declares none. */
export function numericScale(scale: readonly string[] | undefined): number[] {
  if (scale === undefined) return [];
  return [
    ...new Set(
      scale
        .map((entry) => Number.parseFloat(entry))
        .filter((value) => Number.isFinite(value) && value > 0)
    )
  ];
}

/** True when a measured size/weight is a step on one declared ladder. */
export function onScale(value: number, scale: readonly number[]): boolean {
  return scale.some((declared) => nearly(declared, Math.abs(value)));
}

/** The smallest gap between two declared font steps, or null when there is none. */
export function fontStep(scale: readonly string[]): number | null {
  const values = numericScale(scale).sort((left, right) => left - right);
  let step: number | null = null;
  for (let index = 1; index < values.length; index += 1) {
    const gap = (values[index] ?? 0) - (values[index - 1] ?? 0);
    if (gap > EPSILON && (step === null || gap < step)) step = gap;
  }
  return step;
}

/**
 * The judged/on-contract counts. Each readable size is judged against the font
 * ladder and each readable weight against the weight ladder; a ladder the
 * contract does not declare leaves its values unmeasured — excluded from both
 * sides, never silently accepted.
 */
export function typeJudgement(
  samples: readonly TypeSample[],
  tokenScale: DesignTokenScale
): DimensionJudgement {
  const fontScale = numericScale(tokenScale.font);
  const weightScale = numericScale(tokenScale.weight);
  let measured = 0;
  let onContract = 0;
  for (const sample of samples) {
    if (sample.kind === 'size' && sample.px !== null && fontScale.length > 0) {
      measured += 1;
      if (onScale(sample.px, fontScale)) onContract += 1;
    } else if (sample.kind === 'weight' && sample.weight !== null && weightScale.length > 0) {
      measured += 1;
      if (onScale(sample.weight, weightScale)) onContract += 1;
    }
  }
  return { measured, onContract };
}

type Ladder = { kind: 'size' | 'weight'; value: number; samples: TypeSample[] };

/** Readable samples of one kind, grouped by their distinct measured value. */
function bucketsOf(
  samples: readonly TypeSample[],
  kind: 'size' | 'weight',
  scale: readonly number[]
): Map<number, TypeSample[]> {
  const buckets = new Map<number, TypeSample[]>();
  if (scale.length === 0) return buckets;
  for (const sample of samples) {
    if (sample.kind !== kind) continue;
    const value = kind === 'size' ? sample.px : sample.weight;
    if (value === null || onScale(value, scale)) continue;
    const key = Math.abs(value);
    const bucket = buckets.get(key) ?? [];
    bucket.push(sample);
    buckets.set(key, bucket);
  }
  return buckets;
}

function offLadderFinding(ladder: Ladder, scale: readonly number[]): AuditFinding {
  const first = ladder.samples[0];
  const file = first?.file ?? '';
  const line = first?.line ?? 1;
  const count = ladder.samples.length;
  const label = ladder.kind === 'size' ? 'font-size' : 'font-weight';
  const written = ladder.kind === 'size' ? `${display(ladder.value)}px` : display(ladder.value);
  const ladderText = scale.map((entry) => display(entry)).join('/');
  const witness = ladder.kind === 'size' ? `字号 ${written}` : `字重 ${written}`;
  return {
    dimension: 'type',
    severity: 'soft',
    file,
    line,
    value: written,
    expected: ladderText,
    humanText: `第 ${line} 行的${witness}不在设计刻度上（共 ${count} 处），字号体系会显得随意。`,
    techText: `${file}:${line} ${label}:${written} off-ladder x${count} (tokenScale.${ladder.kind === 'size' ? 'font' : 'weight'}: ${ladderText})`
  };
}

/**
 * One finding per DISTINCT off-ladder value: the first witness, the value and
 * how many times the page uses it. This is what makes a ratio score readable —
 * every measured-but-off value is now a finding, not only a lower number.
 */
export function offLadderFindings(
  samples: readonly TypeSample[],
  tokenScale: DesignTokenScale
): AuditFinding[] {
  const fontScale = numericScale(tokenScale.font);
  const weightScale = numericScale(tokenScale.weight);
  const findings: AuditFinding[] = [];
  const groups: Array<{ kind: 'size' | 'weight'; scale: number[] }> = [
    { kind: 'size', scale: fontScale },
    { kind: 'weight', scale: weightScale }
  ];
  for (const group of groups) {
    const buckets = [...bucketsOf(samples, group.kind, group.scale).entries()].sort(
      (left, right) => left[0] - right[0]
    );
    for (const [value, bucket] of buckets) {
      findings.push(offLadderFinding({ kind: group.kind, value, samples: bucket }, group.scale));
    }
  }
  return findings;
}
