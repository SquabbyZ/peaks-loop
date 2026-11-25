/**
 * Type-scale detector (S7).
 *
 * Two questions source text can answer, and one the contract must answer first:
 *   - is the page's font-size set crowded — more than four distinct levels, or
 *     two adjacent levels closer than one declared step?
 *   - does the page use 400 / 500 / 600 / 700? When the contract declares no
 *     weight scale, that part is `unmeasured` — never guessed.
 * Measurement lives in `type-measure.ts`; this module only judges samples.
 */

import type { AuditFinding, AuditInput, AuditSource, DimensionJudgement } from './audit-finding.js';
import { resolveThrough, wholeVariableReference, type CssVariableTable } from './css-variables.js';
import { measureType, parseFontSize, parseWeight, type TypeSample } from './type-measure.js';
import {
  display,
  fontStep,
  nearly,
  offLadderFindings,
  typeJudgement,
  typeSizeLevels
} from './type-ladder.js';

export { measureType } from './type-measure.js';
export { typeSizeLevels } from './type-ladder.js';
export type { TypeSample } from './type-measure.js';

/** "More than four levels" is the crowded-scale rule; the number lives here once. */
const MAX_TYPE_LEVELS = 4;

/** Float tolerance for ladder equality. */
const EPSILON = 1e-6;

/** The declared weight ladder as numbers; empty when the contract declares none. */
function requiredWeights(declared: readonly string[] | undefined): number[] {
  if (declared === undefined) return [];
  return declared
    .map((entry) => Number.parseFloat(entry))
    .filter((weight) => Number.isFinite(weight))
    .sort((left, right) => left - right);
}

function anchorOf(
  samples: readonly TypeSample[],
  sources: readonly AuditSource[]
): { file: string; line: number } {
  const first = samples[0];
  if (first !== undefined) return { file: first.file, line: first.line };
  const source = sources[0];
  return { file: source?.file ?? '', line: source === undefined ? 0 : 1 };
}

function unmeasuredSampleFinding(sample: TypeSample, detail: string | null): AuditFinding {
  const label = sample.kind === 'size' ? 'font-size' : 'font-weight';
  const technical =
    sample.variable === null
      ? (sample.reason ?? 'unreadable')
      : detail === null
        ? `variable ${sample.variable}`
        : `variable ${sample.variable} state-dependent: ${detail}`;
  const why =
    sample.variable === null
      ? `它用了 ${sample.reason ?? '无法解析的值'}`
      : detail === null
        ? `它依赖运行时的 CSS 变量 ${sample.variable}`
        : `它依赖运行时的 CSS 变量 ${sample.variable}，而该变量在不同状态下取值不同（${detail}）`;
  return {
    dimension: 'type',
    severity: 'unmeasured',
    file: sample.file,
    line: sample.line,
    value: sample.raw,
    expected: '',
    humanText: `第 ${sample.line} 行的${sample.kind === 'size' ? '字号' : '字重'}是 ${sample.raw}，${why}，源码里无法判断。`,
    techText: `${sample.file}:${sample.line} ${label}:${sample.raw} unmeasured (${technical})`
  };
}

/** A variable sample resolved through the stylesheet table, or left unreadable. */
function resolveTypeSample(
  sample: TypeSample,
  table: CssVariableTable | undefined
): { sample: TypeSample; detail: string | null } {
  if (sample.variable === null || table === undefined) return { sample, detail: null };
  // Only a whole `var()` value resolves; `calc(var(--x) * 2)` stays unmeasured.
  if (wholeVariableReference(sample.raw) !== sample.variable) return { sample, detail: null };
  const outcome = resolveThrough(table, sample.variable, (value) => {
    if (sample.kind === 'size') {
      const parsed = parseFontSize(value);
      return parsed !== null && parsed.px !== null && parsed.variable === null ? parsed.px : null;
    }
    const parsed = parseWeight(value);
    return parsed !== null && parsed.weight !== null && parsed.variable === null
      ? parsed.weight
      : null;
  });
  if (outcome.kind === 'resolved') {
    return {
      sample:
        sample.kind === 'size'
          ? { ...sample, px: outcome.value, variable: null, reason: null }
          : { ...sample, weight: outcome.value, variable: null, reason: null },
      detail: null
    };
  }
  if (outcome.kind === 'state-dependent') return { sample, detail: outcome.detail };
  return { sample, detail: null };
}

function levelsFinding(
  levels: readonly number[],
  anchor: { file: string; line: number }
): AuditFinding {
  return {
    dimension: 'type',
    severity: 'soft',
    file: anchor.file,
    line: anchor.line,
    value: levels.join('/'),
    expected: '<=4',
    humanText: `本页共用了 ${levels.length} 级字号（${levels.join(' / ')}px），超过 4 级，标题和正文不容易一眼区分。`,
    techText: `${anchor.file}:${anchor.line} font-size:${levels.join('/')} levels=${levels.length} > ${MAX_TYPE_LEVELS}`
  };
}

function adjacencyFindings(
  levels: readonly number[],
  step: number,
  sizes: readonly TypeSample[]
): AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (let index = 1; index < levels.length; index += 1) {
    const left = levels[index - 1];
    const right = levels[index];
    if (left === undefined || right === undefined) continue;
    const gap = right - left;
    if (gap >= step - EPSILON) continue;
    const sample = sizes.find(
      (entry) => entry.kind === 'size' && entry.px !== null && nearly(Math.abs(entry.px), right)
    );
    const fallback = sizes[0];
    const anchor =
      sample === undefined
        ? { file: fallback?.file ?? '', line: fallback?.line ?? 0 }
        : { file: sample.file, line: sample.line };
    findings.push({
      dimension: 'type',
      severity: 'soft',
      file: anchor.file,
      line: anchor.line,
      value: `${display(left)}/${display(right)}`,
      expected: `${display(step)}px`,
      humanText: `字号 ${display(left)}px 和 ${display(right)}px 只差 ${display(gap)}px，小于最小刻度 ${display(step)}px，两个层级看起来几乎一样。`,
      techText: `${anchor.file}:${anchor.line} font-size:${display(left)}/${display(right)} gap=${display(gap)} < step=${display(step)}`
    });
  }
  return findings;
}

function weightFindings(
  input: AuditInput,
  weights: readonly TypeSample[],
  allSamples: readonly TypeSample[]
): AuditFinding[] {
  const observed = [
    ...new Set(weights.flatMap((sample) => (sample.weight === null ? [] : [sample.weight])))
  ].sort((left, right) => left - right);
  const anchor = anchorOf(weights.length > 0 ? weights : allSamples, input.sources);
  const declared = input.tokenScale.weight;
  const value = observed.length === 0 ? 'none' : observed.join('/');
  // A weight this reader cannot resolve is unmeasured, not absent: claiming the
  // set is "missing" it would turn an unreadable value into a violation.
  const hasUnreadable = weights.some(
    (sample) => sample.variable !== null || sample.reason !== null
  );
  if (declared !== undefined && declared.length > 0 && hasUnreadable) return [];
  const required = requiredWeights(declared);
  if (required.length === 0) {
    return [
      {
        dimension: 'type',
        severity: 'unmeasured',
        file: anchor.file,
        line: anchor.line,
        value,
        expected: 'tokenScale.weight',
        humanText: '契约没有声明字重刻度，本页的字重无法按刻度判断。',
        techText: `${anchor.file}:${anchor.line} font-weight:${value} unmeasured (tokenScale.weight not declared)`
      }
    ];
  }
  // The requirement is the DECLARED ladder, never a built-in four-weight list:
  // a `[400, 500]` contract must not be told it is missing 600 and 700.
  const missing = required.filter((weight) => !observed.includes(weight));
  if (missing.length === 0) return [];
  return [
    {
      dimension: 'type',
      severity: 'soft',
      file: anchor.file,
      line: anchor.line,
      value,
      expected: missing.join('/'),
      humanText: `本页字重缺少 ${missing.join('、')}，标题和正文的粗细对比不足。`,
      techText: `${anchor.file}:${anchor.line} font-weight:${value} missing ${missing.join('/')}`
    }
  ];
}

/** Every type finding for a page, plus the judged/on-contract counts. */
export type TypeDimensionAudit = {
  findings: AuditFinding[];
  judgement: DimensionJudgement;
};

/**
 * Judge the page's type values once. The judgement counts each readable size
 * against the declared font ladder and each readable weight against the
 * declared weight ladder. An off-ladder value emits its own finding (Task 6c),
 * so the ratio can never move without a finding behind it.
 */
export function auditTypeDimension(input: AuditInput): TypeDimensionAudit {
  const resolved = measureType(input.sources).map((sample) =>
    resolveTypeSample(sample, input.variables)
  );
  const samples = resolved.map((entry) => entry.sample);
  const sizes = samples.filter((sample) => sample.kind === 'size');
  const weights = samples.filter((sample) => sample.kind === 'weight');
  const findings: AuditFinding[] = [];
  for (const entry of resolved) {
    if (entry.sample.variable !== null || entry.sample.reason !== null) {
      findings.push(unmeasuredSampleFinding(entry.sample, entry.detail));
    }
  }
  const levels = typeSizeLevels(sizes);
  if (levels.length > MAX_TYPE_LEVELS) {
    findings.push(levelsFinding(levels, anchorOf(sizes, input.sources)));
  }
  const step = fontStep(input.tokenScale.font);
  if (step !== null) findings.push(...adjacencyFindings(levels, step, sizes));
  findings.push(...weightFindings(input, weights, samples));
  findings.push(...offLadderFindings(samples, input.tokenScale));
  return { findings, judgement: typeJudgement(samples, input.tokenScale) };
}

/** Every type finding for a page: crowded scale (soft), weights, unreadable. */
export function auditType(input: AuditInput): AuditFinding[] {
  return auditTypeDimension(input).findings;
}
