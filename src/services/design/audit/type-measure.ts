/**
 * Type measurement (S7): font-size and font-weight samples from source.
 *
 * Split from `audit-type.ts` so measurement and judgement are separate
 * responsibilities. Sizes and weights are read only from class contexts and
 * inline `style` / CSS declarations; a value that resolves through `var()` is
 * recorded with the variable's name instead of being dropped, because the
 * pilot overrides `--text-*` in three density blocks.
 */

import {
  classTokens,
  classValueSpans,
  declarationMatches,
  declarationRegions,
  lineAt,
  utilityBody,
  type AuditSource
} from './audit-finding.js';
import { memoBySource, sourceView } from './source-view.js';

/** One measured font size or weight, before the page-level verdict is taken. */
export type TypeSample = {
  kind: 'size' | 'weight';
  file: string;
  line: number;
  raw: string;
  /** Resolved px for a size; null otherwise (or unreadable). */
  px: number | null;
  /** Numeric weight for a weight; null otherwise (or unreadable). */
  weight: number | null;
  variable: string | null;
  reason: string | null;
};

const NAMED_SIZES: Record<string, number> = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  '2xl': 24,
  '3xl': 30,
  '4xl': 36,
  '5xl': 48,
  '6xl': 60,
  '7xl': 72,
  '8xl': 96,
  '9xl': 128
};

const NAMED_WEIGHTS: Record<string, number> = {
  thin: 100,
  extralight: 200,
  light: 300,
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
  black: 900
};

const TYPE_KEYWORDS = new Set([
  'inherit',
  'initial',
  'unset',
  'revert',
  'revert-layer',
  'smaller',
  'larger',
  'caption',
  'icon',
  'menu',
  'message-box',
  'small-caption',
  'status-bar'
]);

const TYPE_PROPERTY = 'fontSize|font-size|fontWeight|font-weight';

/** A 16px rem assumption, stated once (the spike records the same one). */
const REM_PX = 16;

/** Values that are a colour, not a length, and so are not this detector's. */
const COLOUR_LENGTH = /^(?:#|color:|rgba?\(|hsla?\(|oklch\(|oklab\()/i;

export type ParsedSize = { px: number | null; variable: string | null; reason: string | null };

/** A value that resolves only at runtime (`var()`, `calc()`, …), or null. */
function relativeSize(value: string): ParsedSize | null {
  const variable = /\bvar\(\s*(--[\w-]+)/.exec(value)?.[1];
  if (variable !== undefined) return { px: null, variable, reason: `variable ${variable}` };
  const fn = /\b(calc|clamp|min|max|color-mix|env)\(/.exec(value)?.[1];
  return fn === undefined ? null : { px: null, variable: null, reason: `${fn}()` };
}

/** A px/rem value, or a named reason why the value cannot be read. */
function absoluteSize(value: string): ParsedSize {
  const absolute = /^(\d*\.?\d+)(px|rem)?$/i.exec(value);
  if (absolute === null) return { px: null, variable: null, reason: 'unrecognised unit' };
  const amount = Number.parseFloat(absolute[1] ?? '');
  if (!Number.isFinite(amount)) return { px: null, variable: null, reason: 'unparseable number' };
  const rem = (absolute[2] ?? '').toLowerCase() === 'rem';
  return { px: rem ? amount * REM_PX : amount, variable: null, reason: null };
}

/** Parse a font-size value; null means "not a size at all" (a colour, a keyword). */
export function parseFontSize(text: string): ParsedSize | null {
  const value = text.trim().replace(/^length:/i, '');
  if (value === '' || TYPE_KEYWORDS.has(value.toLowerCase())) return null;
  if (COLOUR_LENGTH.test(value)) return null;
  return relativeSize(value) ?? absoluteSize(value);
}

export type ParsedWeight = {
  weight: number | null;
  variable: string | null;
  reason: string | null;
};

/** Parse a font-weight value; null means a font family or an unknown keyword. */
export function parseWeight(text: string): ParsedWeight | null {
  const value = text
    .trim()
    .replace(/^number:/i, '')
    .toLowerCase();
  const variable = /\bvar\(\s*(--[\w-]+)/.exec(value)?.[1];
  if (variable !== undefined) return { weight: null, variable, reason: `variable ${variable}` };
  if (/^[1-9]00$/.test(value)) return { weight: Number(value), variable: null, reason: null };
  const named = NAMED_WEIGHTS[value];
  return named === undefined ? null : { weight: named, variable: null, reason: null };
}

function sizeFromToken(file: string, line: number, token: string): TypeSample | null {
  const body = utilityBody(token);
  if (!body.startsWith('text-')) return null;
  const value = body.slice('text-'.length);
  if (value.startsWith('[')) {
    const parsed = parseFontSize(value.slice(1, -1));
    if (parsed === null) return null;
    return {
      kind: 'size',
      file,
      line,
      raw: token,
      px: parsed.px,
      weight: null,
      variable: parsed.variable,
      reason: parsed.reason
    };
  }
  const px = NAMED_SIZES[value];
  if (px === undefined) return null;
  return {
    kind: 'size',
    file,
    line,
    raw: token,
    px,
    weight: null,
    variable: null,
    reason: null
  };
}

function weightFromToken(file: string, line: number, token: string): TypeSample | null {
  const body = utilityBody(token);
  if (!body.startsWith('font-')) return null;
  const value = body.slice('font-'.length);
  const parsed = parseWeight(value.startsWith('[') ? value.slice(1, -1) : value);
  if (parsed === null) return null;
  return {
    kind: 'weight',
    file,
    line,
    raw: token,
    px: null,
    weight: parsed.weight,
    variable: parsed.variable,
    reason: parsed.reason
  };
}

function measureClassType(file: string, view: string, starts: readonly number[]): TypeSample[] {
  const samples: TypeSample[] = [];
  for (const span of classValueSpans(view)) {
    for (const { token, start } of classTokens(span)) {
      const line = lineAt(starts, start);
      const size = sizeFromToken(file, line, token);
      if (size !== null) samples.push(size);
      const weight = weightFromToken(file, line, token);
      if (weight !== null) samples.push(weight);
    }
  }
  return samples;
}

function measureDeclarationType(
  file: string,
  view: string,
  starts: readonly number[]
): TypeSample[] {
  const samples: TypeSample[] = [];
  for (const region of declarationRegions(file, view)) {
    for (const declaration of declarationMatches(region, TYPE_PROPERTY)) {
      const line = lineAt(starts, declaration.start);
      const property = declaration.property.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
      if (property === 'font-size') {
        const parsed = parseFontSize(declaration.value);
        if (parsed !== null) {
          samples.push({
            kind: 'size',
            file,
            line,
            raw: declaration.value,
            px: parsed.px,
            weight: null,
            variable: parsed.variable,
            reason: parsed.reason
          });
        }
      } else if (property === 'font-weight') {
        const parsed = parseWeight(declaration.value);
        if (parsed !== null) {
          samples.push({
            kind: 'weight',
            file,
            line,
            raw: declaration.value,
            px: null,
            weight: parsed.weight,
            variable: parsed.variable,
            reason: parsed.reason
          });
        }
      }
    }
  }
  return samples;
}

/** Every font-size and font-weight value one source declares. */
function measureSource(source: AuditSource): TypeSample[] {
  const view = sourceView(source);
  return [
    ...measureClassType(source.file, view.comments, view.starts),
    ...measureDeclarationType(source.file, view.comments, view.starts)
  ];
}

/** Every font-size and font-weight value a page's source declares. */
export function measureType(sources: readonly AuditSource[]): TypeSample[] {
  return sources.flatMap((source) => memoBySource(source, 'type', () => measureSource(source)));
}
