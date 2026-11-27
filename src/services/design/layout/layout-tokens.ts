/**
 * Reads the `space` group of `design/tokens.json`. Only literal pixel values are
 * usable and relative values are skipped. The strict reader reports why a
 * contract could not be read; the tolerant one yields no tokens, which a caller
 * must not mistake for a contract that changed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type SpacingToken = {
  /** The DTCG path this reader reports, e.g. `space.section`. */
  name: string;
  /** The declared value verbatim, e.g. `16px`. */
  value: string;
  /** The same value in computed pixels; the attribution key. */
  px: number;
};

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function pixelValue(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(-?\d+(?:\.\d+)?)px$/.exec(value.trim());
  const digits = match?.[1];
  return digits === undefined ? null : Number(digits);
}

export type SpacingRead = { ok: true; tokens: SpacingToken[] } | { ok: false; reason: string };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function tokensOf(raw: unknown): SpacingToken[] {
  const space = recordOf(recordOf(raw).space);
  const tokens: SpacingToken[] = [];
  for (const key of Object.keys(space).sort((left, right) => left.localeCompare(right))) {
    const declared = recordOf(space[key]).$value;
    if (typeof declared !== 'string') continue;
    const px = pixelValue(declared);
    if (px === null) continue;
    tokens.push({ name: `space.${key}`, value: declared.trim(), px });
  }
  return tokens;
}

/** The declared tokens, or why the contract file could not be read. */
export function readSpacingTokensStrict(designRoot: string): SpacingRead {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(designRoot, 'tokens.json'), 'utf8'));
  } catch (error) {
    return {
      ok: false,
      reason: `the spacing token contract could not be read (${errorText(error)})`
    };
  }
  return { ok: true, tokens: tokensOf(raw) };
}

/** The declared `space` tokens of one design root; never throws, never guesses. */
export function readSpacingTokens(designRoot: string): SpacingToken[] {
  const read = readSpacingTokensStrict(designRoot);
  return read.ok ? read.tokens : [];
}
