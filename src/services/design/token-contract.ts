/**
 * DTCG token contract — the `design/tokens.json` shape built from scanned
 * visual tokens.
 *
 * Groups mirror the four categories `classifyToken` already recognises:
 * color → `color`, spacing → `space`, typography → `font`, radius →
 * `radius`. A value's `$type` stays inside the DTCG value vocabulary;
 * a typography token only becomes `fontFamily` when its value is a font
 * stack (a comma or a quote), otherwise it is a `dimension`.
 */

import { classifyToken } from '../scan/existing-system-visual-tokens.js';
import type { VisualToken } from '../scan/scan-types.js';

export type DesignTokenValue = {
  $value: string;
  $type: 'color' | 'dimension' | 'fontFamily';
};

export type DesignTokensFile = {
  $schema: string;
  color: Record<string, DesignTokenValue>;
  space: Record<string, DesignTokenValue>;
  font: Record<string, DesignTokenValue>;
  radius: Record<string, DesignTokenValue>;
};

const DTCG_SCHEMA = 'https://design-tokens.org/schema.json';

const GROUP_BY_CLASS = {
  color: 'color',
  spacing: 'space',
  typography: 'font',
  radius: 'radius'
} as const;

type TokenClass = keyof typeof GROUP_BY_CLASS;
type TokenGroup = (typeof GROUP_BY_CLASS)[TokenClass];

function tokenKey(name: string): string {
  return name.startsWith('--') ? name.slice(2) : name;
}

function dtcgType(kind: TokenClass, value: string): DesignTokenValue['$type'] {
  if (kind === 'color') return 'color';
  if (
    kind === 'typography' &&
    (value.includes(',') || value.includes("'") || value.includes('"'))
  ) {
    return 'fontFamily';
  }
  return 'dimension';
}

function sortedRecord(
  group: ReadonlyMap<string, DesignTokenValue>
): Record<string, DesignTokenValue> {
  const out: Record<string, DesignTokenValue> = {};
  for (const key of [...group.keys()].sort((a, b) => a.localeCompare(b))) {
    const value = group.get(key);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export function buildTokenContract(tokens: readonly VisualToken[]): DesignTokensFile {
  const groups: Record<TokenGroup, Map<string, DesignTokenValue>> = {
    color: new Map(),
    space: new Map(),
    font: new Map(),
    radius: new Map()
  };

  for (const token of tokens) {
    const kind = classifyToken(token.name);
    if (kind === null) continue;
    const key = tokenKey(token.name);
    const group = groups[GROUP_BY_CLASS[kind]];
    // First value per key wins; a later source never overwrites it.
    if (group.has(key)) continue;
    group.set(key, { $value: token.value, $type: dtcgType(kind, token.value) });
  }

  return {
    $schema: DTCG_SCHEMA,
    color: sortedRecord(groups.color),
    space: sortedRecord(groups.space),
    font: sortedRecord(groups.font),
    radius: sortedRecord(groups.radius)
  };
}
