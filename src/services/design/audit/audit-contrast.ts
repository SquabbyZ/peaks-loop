/**
 * Contrast detector (S7) — WCAG 2.1 ratios for DECLARED text/background pairs.
 *
 * CONTRACT SHAPE (the line the report can quote): `design/tokens.json` may
 * declare top-level `"pairs": [{ "fg": "<color token key>", "bg": "<color
 * token key>", "large": true? }]`. Each entry names two keys of the `color`
 * group; `large` marks text at or above the WCAG large-text size.
 *
 * With no declared pairs the dimension is `unmeasured` and the finding
 * recommends declaring them. A pairing is NEVER inferred from token names
 * (`foreground` on `background` is a guess, not a measurement): the spike
 * measured that no pair table exists anywhere, and that the effective
 * background can come from an ancestor in another file.
 *
 * The maths is WCAG 2.1 relative luminance: linearise each sRGB channel
 * (`c ≤ 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4`), weight it
 * 0.2126 / 0.7152 / 0.0722, and ratio `(L₁ + 0.05) / (L₂ + 0.05)`. Body text
 * below 4.5:1 and large text below 3:1 is `hard`, naming both tokens and the
 * measured ratio.
 */

import { toRenderableColor } from '../css-color.js';
import type { AuditFinding } from './audit-finding.js';

/** One declared text-on-background pair; keys name entries in `color`. */
export type DeclaredColorPair = {
  fg: string;
  bg: string;
  /** Present and true for large text: the 3:1 threshold instead of 4.5:1. */
  large?: boolean;
};

/** The `color` group of `design/tokens.json`, as the contract declares it. */
export type ContrastTokenGroup = Record<string, { $value: string }>;

/** The slice of `tokens.json` this detector reads. */
export type ContrastContract = {
  color?: ContrastTokenGroup;
  pairs?: readonly DeclaredColorPair[];
};

/** One line the report can quote for "declare your contrast pairs this way". */
export const PAIRS_CONTRACT_LINE =
  'design/tokens.json pairs[]: [{ "fg": "<color token key>", "bg": "<color token key>", "large": true? }]';

/** A token file path a finding can cite when the caller supplies none. */
const DEFAULT_CONTRACT_FILE = 'design/tokens.json';

const BODY_MIN_RATIO = 4.5;
const LARGE_MIN_RATIO = 3;
const DISPLAY_DECIMALS = 2;

const BYTE_MAX = 255;
const BYTE_MASK = 0xff;
const SHIFT_RED = 16;
const SHIFT_GREEN = 8;
const HEX_RADIX = 16;

const GAMMA_THRESHOLD = 0.03928;
const GAMMA_SLOPE = 12.92;
const GAMMA_SCALE = 1.055;
const GAMMA_OFFSET = 0.055;
const GAMMA = 2.4;

const RED_WEIGHT = 0.2126;
const GREEN_WEIGHT = 0.7152;
const BLUE_WEIGHT = 0.0722;
const LUMINANCE_OFFSET = 0.05;

function linearChannel(channel: number): number {
  const ratio = channel / BYTE_MAX;
  return ratio <= GAMMA_THRESHOLD
    ? ratio / GAMMA_SLOPE
    : ((ratio + GAMMA_OFFSET) / GAMMA_SCALE) ** GAMMA;
}

/** WCAG 2.1 relative luminance of a colour, or null when it cannot be read. */
export function relativeLuminance(value: string): number | null {
  const hex = toRenderableColor(value);
  if (hex === null) return null;
  const numeric = Number.parseInt(hex.slice(1), HEX_RADIX);
  if (!Number.isFinite(numeric)) return null;
  const red = linearChannel((numeric >> SHIFT_RED) & BYTE_MASK);
  const green = linearChannel((numeric >> SHIFT_GREEN) & BYTE_MASK);
  const blue = linearChannel(numeric & BYTE_MASK);
  return RED_WEIGHT * red + GREEN_WEIGHT * green + BLUE_WEIGHT * blue;
}

/** The WCAG contrast ratio of two colours, or null when either is unreadable. */
export function contrastRatio(fg: string, bg: string): number | null {
  const foreground = relativeLuminance(fg);
  const background = relativeLuminance(bg);
  if (foreground === null || background === null) return null;
  const lighter = Math.max(foreground, background);
  const darker = Math.min(foreground, background);
  return (lighter + LUMINANCE_OFFSET) / (darker + LUMINANCE_OFFSET);
}

function display(key: string): string {
  return key.startsWith('--') ? key : `--${key}`;
}

function lookup(contract: ContrastContract, key: string): string | null {
  const name = key.startsWith('--') ? key.slice('--'.length) : key;
  const value = contract.color?.[name]?.$value;
  return typeof value === 'string' ? value : null;
}

/** What stops a pair from being measured, or null when both tokens resolve. */
function pairIssue(contract: ContrastContract, pair: DeclaredColorPair): string | null {
  for (const key of [pair.fg, pair.bg]) {
    const value = lookup(contract, key);
    if (value === null) return `token ${display(key)} not declared`;
    if (toRenderableColor(value) === null) {
      return `token ${display(key)} value cannot be converted`;
    }
  }
  return null;
}

function unmeasuredPairFinding(pair: DeclaredColorPair, why: string, file: string): AuditFinding {
  const names = `${display(pair.fg)}/${display(pair.bg)}`;
  return {
    dimension: 'contrast',
    severity: 'unmeasured',
    file,
    line: 1,
    value: names,
    expected: 'declared pair',
    humanText: `契约的配对 ${names} 无法计算对比度（${why}），这个配对的对比度是未知的。`,
    techText: `${file}:1 contrast:${names} unmeasured (${why})`
  };
}

function lowContrastFinding(
  pair: DeclaredColorPair,
  ratio: number,
  minimum: number,
  file: string
): AuditFinding {
  const fg = display(pair.fg);
  const bg = display(pair.bg);
  const measured = ratio.toFixed(DISPLAY_DECIMALS);
  const kind = pair.large === true ? '大字' : '正文';
  return {
    dimension: 'contrast',
    severity: 'hard',
    file,
    line: 1,
    value: `${measured}:1`,
    expected: `${minimum}:1`,
    humanText: `前景 ${fg} 与背景 ${bg} 的对比度只有 ${measured}:1，低于${kind}要求的 ${minimum}:1，文字可能看不清。`,
    techText: `${file}:1 contrast:${fg}/${bg}=${measured} < ${minimum}`
  };
}

function pairFindings(
  contract: ContrastContract,
  pair: DeclaredColorPair,
  file: string
): AuditFinding[] {
  const issue = pairIssue(contract, pair);
  if (issue !== null) return [unmeasuredPairFinding(pair, issue, file)];
  const foreground = lookup(contract, pair.fg) ?? '';
  const background = lookup(contract, pair.bg) ?? '';
  const ratio = contrastRatio(foreground, background);
  if (ratio === null) {
    return [unmeasuredPairFinding(pair, 'measured value is unreadable', file)];
  }
  const minimum = pair.large === true ? LARGE_MIN_RATIO : BODY_MIN_RATIO;
  return ratio < minimum ? [lowContrastFinding(pair, ratio, minimum, file)] : [];
}

function missingPairsFinding(file: string): AuditFinding {
  return {
    dimension: 'contrast',
    severity: 'unmeasured',
    file,
    line: 1,
    value: 'pairs',
    expected: 'pairs[]',
    humanText:
      '契约没有声明前景/背景配对，无法判断文字对比度；建议在 tokens.json 里增加 pairs 数组，声明正文和大字各自的配对。',
    techText: `${file}:1 pairs:missing unmeasured (declare pairs[] { fg, bg, large? })`
  };
}

function declaredPairs(contract: ContrastContract): DeclaredColorPair[] {
  if (!Array.isArray(contract.pairs)) return [];
  return contract.pairs.filter(
    (pair): pair is DeclaredColorPair =>
      pair !== null &&
      typeof pair === 'object' &&
      typeof (pair as DeclaredColorPair).fg === 'string' &&
      typeof (pair as DeclaredColorPair).bg === 'string'
  );
}

/**
 * Every contrast finding for the contract's DECLARED pairs. No pairs is one
 * `unmeasured` finding that recommends declaring them — never a guess.
 */
export function auditContrast(
  contract: ContrastContract,
  file: string = DEFAULT_CONTRACT_FILE
): AuditFinding[] {
  const pairs = declaredPairs(contract);
  if (pairs.length === 0) return [missingPairsFinding(file)];
  return pairs.flatMap((pair) => pairFindings(contract, pair, file));
}
