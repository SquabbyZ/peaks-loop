/**
 * Colour detector (S7).
 *
 * Two questions source text can answer, and one it cannot:
 *   - does the page use more than five chromatic families? Families are 30°
 *     OKLCH hue wedges, so a light/dark pair (`bg-emerald-500
 *     dark:bg-emerald-400`, or two shades of one token) is ONE family; the
 *     dark duplicate is subtracted, never recounted.
 *   - is a raw literal (`#c81e1e`, `rgba(…)`, `oklch(…)`) one the contract
 *     already declares? A literal that maps to a declared colour token is
 *     counted under that token, not as raw — and is not a finding. A literal
 *     with no matching token is `hard`: the contract says use the token.
 *   - a value behind `var()` / `color-mix()` is `unmeasured`, naming the
 *     variable(s). A contract that declares no colour token at all records
 *     one `unmeasured` finding for the page, never a violation per literal.
 *
 * Measurement (`measureColor`) lives in `color-measure.ts`; this module only
 * judges the samples. `tests/unit/design/audit-color.test.ts` calibrates each
 * rule against a fixture pair and its inversion control.
 */

import { toRenderableColor } from '../css-color.js';
import type { AuditFinding, AuditInput, AuditSource, DimensionJudgement } from './audit-finding.js';
import { HUE_LABELS, hueBucket } from './color-oklch.js';
import { measureColor, type ColorSample } from './color-measure.js';

export { measureColor } from './color-measure.js';
export type { ColorSample } from './color-measure.js';

/** The `color` group of `design/tokens.json`, as the contract declares it. */
export type ColorTokenGroup = Record<string, { $value: string }>;

export type ColorAuditInput = AuditInput & {
  /** The contract's colour group; absent means "no colour token declared". */
  tokens?: { color?: ColorTokenGroup } | null;
};

/** One chromatic family, with up to three `name@file:line` witnesses. */
export type ColorFamily = {
  bucket: number;
  label: string;
  witnesses: string[];
  first: { file: string; line: number };
};

/** More than five chromatic families on one page is the crowded-palette rule. */
const MAX_CHROMATIC_FAMILIES = 5;

/** Witnesses stay short in the technical line; the report can list the rest. */
const MAX_WITNESSES = 3;

const UNKNOWN_LABEL = '未知色相';

function tokenName(key: string): string {
  return key.startsWith('--') ? key : `--${key}`;
}

/**
 * The contract's token values as `#rrggbb → token name`. A token whose value
 * cannot be converted (`var()`, `color-mix()`) is not in the index: the literal
 * it would match is unmeasured, not silently accepted.
 */
export function declaredColourIndex(tokens?: ColorAuditInput['tokens']): Map<string, string> {
  const index = new Map<string, string>();
  const group = tokens?.color ?? {};
  for (const key of Object.keys(group).sort((left, right) => left.localeCompare(right))) {
    const value = group[key]?.$value;
    const hex = value === undefined ? null : toRenderableColor(value);
    if (hex !== null && !index.has(hex)) index.set(hex, tokenName(key));
  }
  return index;
}

/** The literal as written, or the whole value when no literal was read. */
function renderingOf(sample: ColorSample): string {
  return sample.literal ?? sample.raw;
}

/** How a sample is named in a family: its token when mapped, else its spelling. */
function spellingOf(sample: ColorSample, index: ReadonlyMap<string, string>): string {
  if (sample.hex === null) return sample.raw;
  return index.get(sample.hex) ?? sample.literal ?? sample.raw;
}

function chromatic(sample: ColorSample): boolean {
  return sample.hue !== null && sample.variable === null && sample.reason === null;
}

/** The distinct chromatic families a page uses, bucket-sorted. */
export function chromaticFamilies(
  samples: readonly ColorSample[],
  tokens?: ColorAuditInput['tokens']
): ColorFamily[] {
  const index = declaredColourIndex(tokens);
  const families = new Map<number, ColorFamily>();
  for (const sample of samples) {
    if (!chromatic(sample) || sample.hue === null) continue;
    const bucket = hueBucket(sample.hue);
    const family = families.get(bucket) ?? {
      bucket,
      label: HUE_LABELS[bucket] ?? UNKNOWN_LABEL,
      witnesses: [],
      first: { file: sample.file, line: sample.line }
    };
    // A dark duplicate is named as one, but it lands in the same bucket: the
    // subtraction is the bucket, the marker is how the report shows why.
    const witness = `${spellingOf(sample, index)}@${sample.file}:${sample.line}${sample.dark ? ' dark' : ''}`;
    if (family.witnesses.length < MAX_WITNESSES && !family.witnesses.includes(witness)) {
      family.witnesses.push(witness);
    }
    families.set(bucket, family);
  }
  return [...families.values()].sort((left, right) => left.bucket - right.bucket);
}

/**
 * The distinct chromatic SPELLINGS a page uses, dark duplicates included. This
 * is the count before the dark-theme subtraction; a light/dark pair of one
 * family contributes two spellings here and one family above.
 */
export function chromaticSpellings(
  samples: readonly ColorSample[],
  tokens?: ColorAuditInput['tokens']
): string[] {
  const index = declaredColourIndex(tokens);
  const names = new Set<string>();
  for (const sample of samples) {
    if (chromatic(sample)) names.add(spellingOf(sample, index));
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}

function unmeasuredFinding(sample: ColorSample): AuditFinding {
  const technical = [sample.reason, sample.variable === null ? null : `variable ${sample.variable}`]
    .filter((part): part is string => part !== null)
    .join('; ');
  const why =
    sample.variable === null
      ? `它用了 ${sample.reason ?? '无法解析的颜色写法'}`
      : `它依赖运行时的 CSS 变量 ${sample.variable}`;
  const rendered = renderingOf(sample);
  return {
    dimension: 'color',
    severity: 'unmeasured',
    file: sample.file,
    line: sample.line,
    value: rendered,
    expected: '',
    humanText: `第 ${sample.line} 行的 ${sample.property} 是 ${rendered}，${why}，源码里无法判断它是否来自 token。`,
    techText: `${sample.file}:${sample.line} ${sample.property}:${rendered} unmeasured (${technical})`
  };
}

function rawLiteralFinding(sample: ColorSample): AuditFinding {
  const literal = sample.literal ?? sample.raw;
  return {
    dimension: 'color',
    severity: 'hard',
    file: sample.file,
    line: sample.line,
    value: literal,
    expected: 'declared token',
    humanText: `第 ${sample.line} 行的 ${sample.property} 用了原始色值 ${literal}，契约里没有对应的颜色 token，应该改用 token。`,
    techText: `${sample.file}:${sample.line} ${sample.property}:${literal} raw colour not a declared token`
  };
}

function noOracleFinding(
  literals: readonly ColorSample[],
  sources: readonly AuditSource[]
): AuditFinding {
  const first = literals[0];
  const file = first?.file ?? sources[0]?.file ?? '';
  const line = first?.line ?? 1;
  return {
    dimension: 'color',
    severity: 'unmeasured',
    file,
    line,
    value: String(literals.length),
    expected: 'tokens.color',
    humanText: `契约没有声明颜色 token，本页的 ${literals.length} 个原始色值无法按 token 判断。`,
    techText: `${file}:${line} colour-literals:${literals.length} unmeasured (tokens.color declares no colour token)`
  };
}

function familiesFinding(
  families: readonly ColorFamily[],
  sources: readonly AuditSource[]
): AuditFinding {
  const first = families[0]?.first ?? { file: sources[0]?.file ?? '', line: 1 };
  const labels = families.map((family) => family.label).join('、');
  const listing = families
    .map((family) => `${family.label}(${family.witnesses.join(', ')})`)
    .join('; ');
  return {
    dimension: 'color',
    severity: 'soft',
    file: first.file,
    line: first.line,
    value: labels,
    expected: `<=${MAX_CHROMATIC_FAMILIES}`,
    humanText: `本页共用了 ${families.length} 个色系（${labels}），超过 ${MAX_CHROMATIC_FAMILIES} 个，页面颜色显得杂乱。`,
    techText: `${first.file}:${first.line} colour-families:${families.length} > ${MAX_CHROMATIC_FAMILIES} (${listing})`
  };
}

/** Every colour finding for a page, plus the judged/on-contract counts. */
export type ColorDimensionAudit = {
  findings: AuditFinding[];
  judgement: DimensionJudgement;
};

/**
 * Judge every colour value once. The findings are exactly what `auditColor`
 * always returned; the judgement counts a palette utility or a literal that
 * maps to a declared token as on-contract, a raw literal with no token as
 * measured-but-off, and a `var()`/unreadable value (or a literal when the
 * contract declares no colour token at all) as unmeasured — excluded from both
 * sides of the ratio.
 */
export function auditColorDimension(input: ColorAuditInput): ColorDimensionAudit {
  const samples = measureColor(input.sources);
  const index = declaredColourIndex(input.tokens);
  const findings: AuditFinding[] = [];
  const rawLiterals: ColorSample[] = [];
  let measured = 0;
  let onContract = 0;
  for (const sample of samples) {
    if (sample.variable !== null || sample.reason !== null) {
      findings.push(unmeasuredFinding(sample));
    } else if (sample.hex !== null && !index.has(sample.hex)) {
      rawLiterals.push(sample);
    } else {
      measured += 1;
      onContract += 1;
    }
  }
  if (rawLiterals.length > 0 && index.size === 0) {
    findings.push(noOracleFinding(rawLiterals, input.sources));
  } else {
    for (const sample of rawLiterals) findings.push(rawLiteralFinding(sample));
    measured += rawLiterals.length;
  }
  const families = chromaticFamilies(samples, input.tokens);
  if (families.length > MAX_CHROMATIC_FAMILIES) {
    findings.push(familiesFinding(families, input.sources));
  }
  return { findings, judgement: { measured, onContract } };
}

/** Every colour finding for a page: raw literals (hard), families (soft), gaps. */
export function auditColor(input: ColorAuditInput): AuditFinding[] {
  return auditColorDimension(input).findings;
}
