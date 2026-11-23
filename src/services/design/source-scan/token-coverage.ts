/**
 * Token coverage — the Q7 ratio for `DESIGN_TOKEN_COVERAGE`.
 *
 * Counts hardcoded colour / spacing / font / radius literals in the scanned
 * page files. A literal is covered when its value equals a token value or
 * when it references a token variable (`var(--…)`). Named CSS colours are not
 * counted: the same literal vocabulary the scan-file rules detect (hex /
 * rgb / hsl / oklch plus Tailwind arbitrary values) is the one measured here,
 * so the two cannot disagree about what a hardcoded value is.
 */

import type { DesignTokensFile } from '../token-contract.js';

export type TokenCoverage = {
  covered: number;
  total: number;
  ratio: number;
};

/**
 * One pass, three ordered alternatives, so a literal inside a Tailwind
 * arbitrary value is counted once: `w-[123px]` is reached as the whole token
 * (alternative 1) before its inner `123px` could be re-read as anything else.
 */
const COVERAGE_LITERAL =
  /(\b[\w-]+-\[[^\]\s]+\])|(var\(\s*--[\w-]+[^)]*\))|(#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab)\([^)]*\))/g;

const DIMENSION_LITERAL = /^-?\d*\.?\d+(?:px|rem|em|%|vh|vw|pt|ch|ex)?$/i;
const COLOR_LITERAL = /^#|^(?:rgba?|hsla?|oklch|oklab)\(/i;

function tokenValues(tokens: DesignTokensFile): Set<string> {
  const values = new Set<string>();
  for (const group of [tokens.color, tokens.space, tokens.font, tokens.radius]) {
    for (const token of Object.values(group)) values.add(token.$value.trim().toLowerCase());
  }
  return values;
}

function innerValue(arbitrary: string): string | null {
  const open = arbitrary.indexOf('[');
  if (open === -1) return null;
  const inner = arbitrary.slice(open + 1, -1);
  return inner.length > 0 ? inner : null;
}

type Tally = { covered: number; total: number };

function tally(covered: boolean): Tally {
  return { covered: covered ? 1 : 0, total: 1 };
}

function arbitraryTally(arbitrary: string, values: Set<string>): Tally | null {
  const inner = innerValue(arbitrary);
  if (inner === null) return null;
  // `grid-cols-[1fr_2fr]` is layout, not a colour/space/font/radius literal.
  if (!DIMENSION_LITERAL.test(inner) && !COLOR_LITERAL.test(inner)) return null;
  return tally(values.has(inner.toLowerCase()));
}

function matchTally(match: RegExpMatchArray, values: Set<string>): Tally | null {
  const arbitrary = match[1];
  const variable = match[2];
  const literal = match[3];
  if (arbitrary !== undefined) return arbitraryTally(arbitrary, values);
  if (variable !== undefined) return tally(true);
  if (literal !== undefined) return tally(values.has(literal.toLowerCase()));
  return null;
}

export function measureTokenCoverage(source: string, tokens: DesignTokensFile): TokenCoverage {
  const values = tokenValues(tokens);
  const result: Tally = { covered: 0, total: 0 };

  for (const match of source.matchAll(COVERAGE_LITERAL)) {
    const add = matchTally(match, values);
    if (add === null) continue;
    result.covered += add.covered;
    result.total += add.total;
  }

  return {
    ...result,
    ratio: result.total === 0 ? 1 : result.covered / result.total
  };
}
