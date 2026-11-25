/**
 * Spacing-ladder detector (S7).
 *
 * A value is judged by its LADDER STEP, not by one pinned px: a Tailwind
 * numeric utility (`p-4`, `gap-2`) is compared to the declared scale's step
 * multipliers, because the spike measured that form to survive the runtime
 * density presets (`--spacing ∈ {4, 4.8, 3.6, 4.48}px`). An absolute value —
 * an arbitrary `p-[20px]`, a CSS/inline `padding: 20px`, a `1.25rem` — is
 * compared in px against the declared values. Anything that resolves only
 * through a runtime CSS variable is `unmeasured` with the variable named,
 * never a violation.
 */

import type { AuditFinding, AuditInput, DimensionJudgement } from './audit-finding.js';
import { resolveThrough, wholeVariableReference, type CssVariableTable } from './css-variables.js';
import { measureSpacing, parseSpacingValue, type SpacingSample } from './spacing-measure.js';

export { measureSpacing } from './spacing-measure.js';
export type { SpacingSample } from './spacing-measure.js';

/** The declared ladder in both forms: px values, and steps of its own base. */
export type SpacingLadder = {
  /** Declared px values, ascending. */
  values: number[];
  /** The same ladder as step multipliers of its own base. */
  steps: number[];
};

export type SpacingVerdict =
  | { kind: 'on' }
  | { kind: 'convention' }
  | { kind: 'off'; expected: number }
  | { kind: 'unmeasured'; reason: string; variable: string | null; detail?: string };

/** The verdicts that produce a finding: an off-ladder or an unreadable value. */
type FindingVerdict = Extract<SpacingVerdict, { kind: 'off' | 'unmeasured' }>;

type UnmeasuredVerdict = Extract<SpacingVerdict, { kind: 'unmeasured' }>;

/** Float tolerance for ladder equality; a step is a ratio, not an integer. */
const EPSILON = 1e-6;

function nearly(left: number, right: number): boolean {
  return Math.abs(left - right) < EPSILON;
}

/** The nearest declared value; a tie goes to the larger step (never shrink). */
function nearest(values: readonly number[], target: number): number {
  let best = values[0] ?? target;
  let bestDistance = Math.abs(best - target);
  for (const value of values.slice(1)) {
    const distance = Math.abs(value - target);
    if (distance < bestDistance || (nearly(distance, bestDistance) && value > best)) {
      best = value;
      bestDistance = distance;
    }
  }
  return best;
}

/** Read the declared px scale into both the value and the step form. */
export function spacingLadder(scale: readonly string[]): SpacingLadder {
  const values = scale
    .map((entry) => Number.parseFloat(entry))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);
  const base = values[0];
  return {
    values,
    steps: base === undefined ? [] : values.map((value) => value / base)
  };
}

/** An absolute px value against the declared px values. */
function absoluteVerdict(px: number, ladder: SpacingLadder): SpacingVerdict {
  const magnitude = Math.abs(px);
  if (nearly(magnitude, 0)) return { kind: 'convention' };
  if (ladder.values.some((value) => nearly(value, magnitude))) return { kind: 'on' };
  return { kind: 'off', expected: nearest(ladder.values, magnitude) };
}

/** A Tailwind step multiplier against the ladder's step multipliers. */
function stepVerdict(step: number, ladder: SpacingLadder): SpacingVerdict {
  if (nearly(step, 0)) return { kind: 'convention' };
  if (ladder.steps.some((declared) => nearly(declared, step))) return { kind: 'on' };
  const nearestStep = nearest(ladder.steps, step);
  return { kind: 'off', expected: nearestStep * (ladder.values[0] ?? 1) };
}

/**
 * One value's verdict against the declared ladder. `detail` carries the
 * state-by-state listing when a variable resolves differently per state, so the
 * finding can name every value instead of averaging them.
 */
export function spacingVerdict(
  sample: SpacingSample,
  ladder: SpacingLadder,
  detail: string | null = null
): SpacingVerdict {
  if (sample.variable !== null || sample.reason !== null) {
    return {
      kind: 'unmeasured',
      reason: sample.reason ?? 'unreadable',
      variable: sample.variable,
      ...(detail === null ? {} : { detail })
    };
  }
  if (ladder.values.length === 0) {
    return {
      kind: 'unmeasured',
      reason: 'tokenScale.space declares no numeric step',
      variable: null
    };
  }
  if (sample.px !== null) return absoluteVerdict(sample.px, ladder);
  if (sample.step !== null) return stepVerdict(sample.step, ladder);
  return { kind: 'unmeasured', reason: 'unrecognised value', variable: null };
}

function display(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

/** The value a variable resolved to, when it is a readable length. */
function parseResolvedPx(value: string): number | null {
  const parsed = parseSpacingValue(value);
  return parsed !== null && parsed.px !== null && parsed.variable === null ? parsed.px : null;
}

type ResolvedSpacing = {
  sample: SpacingSample;
  via: string | null;
  detail: string | null;
  state: string | null;
};

/**
 * Resolve a `var()` sample through the stylesheet table, when one was supplied.
 *
 * Unique definition → the sample becomes the resolved px, and `via` records the
 * definition so the finding can say which variable and state it scored. Several
 * distinct values → the sample stays unmeasured and `detail` lists every state.
 * No table / no definition → the sample is untouched (the pre-Task-3b verdict).
 */
function resolveSpacingSample(
  sample: SpacingSample,
  table: CssVariableTable | undefined
): ResolvedSpacing {
  if (sample.variable === null || table === undefined) {
    return { sample, via: null, detail: null, state: null };
  }
  // A `calc(var(--x) * 2)` keeps the variable name but must NOT resolve: the
  // audit cannot know the mixed result, so it stays unmeasured by rule.
  if (wholeVariableReference(sample.raw) !== sample.variable) {
    return { sample, via: null, detail: null, state: null };
  }
  const outcome = resolveThrough(table, sample.variable, parseResolvedPx);
  if (outcome.kind === 'resolved') {
    return {
      sample: { ...sample, px: outcome.value, variable: null, reason: null },
      via: outcome.via,
      detail: null,
      state: outcome.state
    };
  }
  if (outcome.kind === 'state-dependent') {
    return { sample, via: null, detail: outcome.detail, state: null };
  }
  return { sample, via: outcome.detail, detail: null, state: null };
}

function resolutionNote(via: string | null, state: string | null): string {
  if (via === null) return '';
  return `（由 CSS 变量解析：${via}${state === null ? '' : `，状态 ${state}`}）`;
}

function offFinding(
  sample: SpacingSample,
  expected: string,
  via: string | null,
  state: string | null
): AuditFinding {
  const resolved = via === null ? '' : ` (${via}${state === null ? '' : `, state ${state}`})`;
  return {
    dimension: 'spacing',
    severity: 'soft',
    file: sample.file,
    line: sample.line,
    value: sample.raw,
    expected,
    humanText: `第 ${sample.line} 行的 ${sample.property} 间距是 ${sample.raw}，不在设计刻度上，最近的刻度是 ${expected}px。${resolutionNote(via, state)}`,
    techText: `${sample.file}:${sample.line} ${sample.property}:${sample.raw}${resolved} not in tokenScale.space`
  };
}

function unmeasuredFinding(sample: SpacingSample, verdict: UnmeasuredVerdict): AuditFinding {
  if (verdict.detail !== undefined) {
    const variable = verdict.variable ?? '';
    return {
      dimension: 'spacing',
      severity: 'unmeasured',
      file: sample.file,
      line: sample.line,
      value: sample.raw,
      expected: '',
      humanText: `第 ${sample.line} 行的 ${sample.property} 是 ${sample.raw}，它依赖运行时的 CSS 变量 ${variable}，而该变量在不同状态下取值不同（${verdict.detail}），源码里无法判断是否在刻度上。`,
      techText: `${sample.file}:${sample.line} ${sample.property}:${sample.raw} unmeasured (variable ${variable} state-dependent: ${verdict.detail})`
    };
  }
  const why =
    verdict.variable === null
      ? `它用了 ${verdict.reason}`
      : `它依赖运行时的 CSS 变量 ${verdict.variable}`;
  const technical = verdict.variable === null ? verdict.reason : `variable ${verdict.variable}`;
  return {
    dimension: 'spacing',
    severity: 'unmeasured',
    file: sample.file,
    line: sample.line,
    value: sample.raw,
    expected: '',
    humanText: `第 ${sample.line} 行的 ${sample.property} 是 ${sample.raw}，${why}，源码里无法判断是否在刻度上。`,
    techText: `${sample.file}:${sample.line} ${sample.property}:${sample.raw} unmeasured (${technical})`
  };
}

function findingFor(
  sample: SpacingSample,
  verdict: FindingVerdict,
  via: string | null,
  state: string | null
): AuditFinding {
  return verdict.kind === 'off'
    ? offFinding(sample, display(verdict.expected), via, state)
    : unmeasuredFinding(sample, verdict);
}

/** Every spacing finding for a page, plus the judged/on-contract counts. */
export type SpacingDimensionAudit = {
  findings: AuditFinding[];
  judgement: DimensionJudgement;
};

/**
 * Judge every measured spacing value once. The findings are exactly what
 * `auditSpacing` always returned; the judgement adds the ratio denominator the
 * score needs — `on`/`convention` values are on-contract, `off` values are
 * measured but off-contract, and an `unmeasured` value is in neither count.
 */
export function auditSpacingDimension(input: AuditInput): SpacingDimensionAudit {
  const ladder = spacingLadder(input.tokenScale.space);
  const findings: AuditFinding[] = [];
  let measured = 0;
  let onContract = 0;
  for (const sample of measureSpacing(input.sources)) {
    const resolved = resolveSpacingSample(sample, input.variables);
    const verdict = spacingVerdict(resolved.sample, ladder, resolved.detail);
    if (verdict.kind === 'on' || verdict.kind === 'convention') {
      measured += 1;
      onContract += 1;
      continue;
    }
    if (verdict.kind === 'off') measured += 1;
    findings.push(findingFor(resolved.sample, verdict, resolved.via, resolved.state));
  }
  return { findings, judgement: { measured, onContract } };
}

/** Every spacing finding for a page: off-ladder (soft) and unreadable (unmeasured). */
export function auditSpacing(input: AuditInput): AuditFinding[] {
  return auditSpacingDimension(input).findings;
}
