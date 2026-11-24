/**
 * The contract's primary colour, derived from the scanned tokens.
 *
 * A token whose name carries `primary` / `brand` as a role segment wins;
 * otherwise the colour value carried by the most tokens wins. A foreground
 * token is the colour placed ON a role, never the role itself, so it is never a
 * candidate — with nothing else to choose, the caller records the gap instead
 * of inventing a colour.
 *
 * Provenance first: the derived value is the token's own literal value and the
 * token key travels with it. A hard-coded hex is never a fallback.
 */

import { classifyToken } from '../scan/existing-system-visual-tokens.js';
import type { VisualToken } from '../scan/scan-types.js';
import { toRenderableColor } from './css-color.js';

/** Which precedence rule selected the token. */
export type PrimaryColorOrigin = 'primary-named' | 'most-frequent';

export type PrimaryColor = {
  /** The token's literal value as the contract stores it. */
  readonly value: string;
  /** The token key as the contract spells it — a leading `--` is stripped. */
  readonly token: string;
  /** How the token was chosen, so a reader can re-derive the decision. */
  readonly origin: PrimaryColorOrigin;
};

/** A named gap: what was missing, in the terms the caller records it with. */
export type PrimaryColorGap = {
  readonly code: 'DESIGN_PRIMARY_COLOR_MISSING' | 'DESIGN_PRIMARY_COLOR_UNREADABLE';
  readonly message: string;
};

export type PrimaryColorReport = {
  readonly color: PrimaryColor | null;
  /** A one-line provenance string, or null when no colour was derived. */
  readonly source: string | null;
  readonly gaps: readonly PrimaryColorGap[];
};

/** Role segments that name the brand colour itself; `primary` outranks `brand`. */
const PRIMARY_SEGMENTS = ['primary', 'brand'] as const;

/** The colour placed ON a role, never the role: never a primary candidate. */
const FOREGROUND_SEGMENTS = ['foreground', 'contrast'] as const;

/** A key with no role segment at all. */
const NO_ROLE = 3;

function tokenKey(name: string): string {
  return name.startsWith('--') ? name.slice(2) : name;
}

/**
 * A role segment is delimited by any of `-`, `_`, `.`, whitespace or `/`, so a
 * CSS-variable name (`color-primary`) and a DTCG dotted path (`color.primary`,
 * `color.brand.primary`) read the same way.
 */
function segments(key: string): string[] {
  return key
    .toLowerCase()
    .split(/[-_.\s/]+/)
    .filter((part) => part.length > 0);
}

function isForegroundish(key: string): boolean {
  const parts = segments(key);
  return parts.some((part) => (FOREGROUND_SEGMENTS as readonly string[]).includes(part));
}

/** 0 = the role itself, `NO_ROLE` = not a role name at all. */
function roleRank(parts: readonly string[]): number {
  const last = parts[parts.length - 1] ?? '';
  if (last === PRIMARY_SEGMENTS[0]) return 0;
  if (last === PRIMARY_SEGMENTS[1]) return 1;
  return parts.some((part) => (PRIMARY_SEGMENTS as readonly string[]).includes(part)) ? 2 : NO_ROLE;
}

/** Locale-free, so the same token list selects the same token on every host. */
function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Role names first, then the shallowest key, then the shortest, then A-Z. */
function compareCandidates(a: VisualToken, b: VisualToken): number {
  const keyA = tokenKey(a.name);
  const keyB = tokenKey(b.name);
  const partsA = segments(keyA);
  const partsB = segments(keyB);
  const rank = roleRank(partsA) - roleRank(partsB);
  if (rank !== 0) return rank;
  const depth = partsA.length - partsB.length;
  if (depth !== 0) return depth;
  const length = keyA.length - keyB.length;
  if (length !== 0) return length;
  return compareText(keyA, keyB);
}

/** The contract keeps the first value per key, so this does too. */
function collapseByName(tokens: readonly VisualToken[]): VisualToken[] {
  const byKey = new Map<string, VisualToken>();
  for (const token of tokens) {
    const key = tokenKey(token.name);
    if (!byKey.has(key)) byKey.set(key, token);
  }
  return [...byKey.values()];
}

function pickNamed(tokens: readonly VisualToken[]): VisualToken | null {
  const candidates = tokens.filter(
    (token) =>
      !isForegroundish(tokenKey(token.name)) && roleRank(segments(tokenKey(token.name))) < NO_ROLE
  );
  if (candidates.length === 0) return null;
  return [...candidates].sort(compareCandidates)[0] ?? null;
}

/** Identical literal values (case-insensitive) all count toward one total. */
function normalizeValue(value: string): string {
  return value.trim().toLowerCase();
}

function pickMostFrequent(tokens: readonly VisualToken[]): VisualToken | null {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    const value = normalizeValue(token.value);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best: VisualToken | null = null;
  let bestCount = 0;
  for (const token of tokens) {
    const count = counts.get(normalizeValue(token.value)) ?? 0;
    const beatsBest = count > bestCount;
    const tiesBetter = count === bestCount && best !== null && compareCandidates(token, best) < 0;
    if (beatsBest || tiesBetter) {
      best = token;
      bestCount = count;
    }
  }
  return best;
}

export function derivePrimaryColor(tokens: readonly VisualToken[]): PrimaryColor | null {
  const colors = collapseByName(tokens.filter((token) => classifyToken(token.name) === 'color'));
  const named = pickNamed(colors);
  const remaining = colors.filter((token) => !isForegroundish(tokenKey(token.name)));
  const chosen = named ?? pickMostFrequent(remaining);
  if (chosen === null) return null;
  return {
    value: chosen.value.trim(),
    token: tokenKey(chosen.name),
    origin: named === null ? 'most-frequent' : 'primary-named'
  };
}

/**
 * The report the init envelope records: the colour, its provenance, and the gap
 * when the contract cannot carry a readable primary.
 */
export function reportPrimaryColor(tokens: readonly VisualToken[]): PrimaryColorReport {
  const color = derivePrimaryColor(tokens);
  if (color === null) {
    return {
      color: null,
      source: null,
      gaps: [
        {
          code: 'DESIGN_PRIMARY_COLOR_MISSING',
          message:
            'No colour token was found, so contract.md carries no primary colour and designlang verify-ui stays blocked.'
        }
      ]
    };
  }
  const source = `token ${color.token} (${color.origin})`;
  if (toRenderableColor(color.value) === null) {
    return {
      color,
      source,
      gaps: [
        {
          code: 'DESIGN_PRIMARY_COLOR_UNREADABLE',
          message: `Token ${color.token} is ${color.value}; designlang verify-ui reads only hex or rgb colours.`
        }
      ]
    };
  }
  return { color, source, gaps: [] };
}
