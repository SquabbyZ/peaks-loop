/**
 * Spacing measurement (S7): source text turned into samples, before a verdict.
 *
 * Split from `audit-spacing.ts` so measurement and judgement are separate
 * responsibilities. Utilities are read only from class contexts (`className`,
 * `cn()`, `cva()`); absolute values only from inline `style` objects or CSS
 * files. A value that resolves through `var()` is recorded with the variable's
 * name, never dropped and never counted as a violation.
 */

import {
  classTokens,
  classValueSpans,
  declarationMatches,
  declarationRegions,
  lineAt,
  splitDeclarationValue,
  utilityBody,
  type AuditSource
} from './audit-finding.js';
import { sourceView, memoBySource } from './source-view.js';

/** One measured spacing value, before a verdict is taken. */
export type SpacingSample = {
  file: string;
  line: number;
  /** The CSS property the value belongs to (`padding`, `gap`, …). */
  property: string;
  /** The source spelling: a class (`p-4`), a px value (`20px`), a var call. */
  raw: string;
  /** Resolved px when the value is absolute; null otherwise. */
  px: number | null;
  /** Tailwind step multiplier for a numeric utility; null otherwise. */
  step: number | null;
  /** Named variable the value depends on, when it resolves through one. */
  variable: string | null;
  /** Why the value is unreadable, when it is. */
  reason: string | null;
};

const SPACING_UTILITY =
  /^(-?)(p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|gap|gap-x|gap-y|space-x|space-y)-(auto|\d+(?:\.\d+)?|\[[^\]]+\])$/;

const SPACING_PROPERTY =
  'padding(?:Top|Right|Bottom|Left|Inline|Block)?' +
  '|padding-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?' +
  '|margin(?:Top|Right|Bottom|Left|Inline|Block)?' +
  '|margin-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?' +
  '|gap|row-?Gap|column-?Gap';

const PROPERTY_BY_UTILITY: Record<string, string> = {
  p: 'padding',
  px: 'padding-inline',
  py: 'padding-block',
  pt: 'padding-top',
  pr: 'padding-right',
  pb: 'padding-bottom',
  pl: 'padding-left',
  ps: 'padding-inline-start',
  pe: 'padding-inline-end',
  m: 'margin',
  mx: 'margin-inline',
  my: 'margin-block',
  mt: 'margin-top',
  mr: 'margin-right',
  mb: 'margin-bottom',
  ml: 'margin-left',
  ms: 'margin-inline-start',
  me: 'margin-inline-end',
  gap: 'gap',
  'gap-x': 'column-gap',
  'gap-y': 'row-gap',
  'space-x': 'space-x',
  'space-y': 'space-y'
};

const SPACING_KEYWORDS = new Set([
  'auto',
  'inherit',
  'initial',
  'unset',
  'revert',
  'revert-layer',
  'none',
  'normal'
]);

export type ParsedValue = { px: number | null; variable: string | null; reason: string | null };

/** A 16px rem assumption, stated once (the spike records the same one). */
const REM_PX = 16;

/**
 * Parse one absolute value; null means a deliberate keyword, not a finding.
 * Exported because the variable resolver replays the same interpretation on a
 * value that came from a `--name` definition.
 */
export function parseSpacingValue(text: string): ParsedValue | null {
  const value = text.trim();
  if (value === '' || SPACING_KEYWORDS.has(value.toLowerCase())) return null;
  const variable = /\bvar\(\s*(--[\w-]+)/.exec(value)?.[1];
  if (variable !== undefined) return { px: null, variable, reason: `variable ${variable}` };
  const fn = /\b(calc|clamp|min|max|color-mix|env)\(/.exec(value)?.[1];
  if (fn !== undefined) return { px: null, variable: null, reason: `${fn}()` };
  const absolute = /^(-?\d*\.?\d+)(px|rem)?$/i.exec(value);
  if (absolute === null) return { px: null, variable: null, reason: 'unrecognised unit' };
  const amount = Number.parseFloat(absolute[1] ?? '');
  if (!Number.isFinite(amount)) return { px: null, variable: null, reason: 'unparseable number' };
  const rem = (absolute[2] ?? '').toLowerCase() === 'rem';
  return { px: rem ? amount * REM_PX : amount, variable: null, reason: null };
}

function utilitySample(
  file: string,
  line: number,
  token: string,
  match: RegExpExecArray
): SpacingSample | null {
  const sign = match[1] ?? '';
  const prefix = match[2] ?? '';
  const body = match[3] ?? '';
  const property = PROPERTY_BY_UTILITY[prefix] ?? prefix;
  if (body === 'auto') return null;
  if (body.startsWith('[')) {
    const parsed = parseSpacingValue(body.slice(1, -1));
    if (parsed === null) return null;
    return {
      file,
      line,
      property,
      raw: token,
      px: parsed.px,
      step: null,
      variable: parsed.variable,
      reason: parsed.reason
    };
  }
  const step = Number.parseFloat(body);
  if (!Number.isFinite(step)) return null;
  return {
    file,
    line,
    property,
    raw: token,
    px: null,
    step: sign === '-' ? -step : step,
    variable: null,
    reason: null
  };
}

function measureClassSpacing(
  file: string,
  view: string,
  starts: readonly number[]
): SpacingSample[] {
  const samples: SpacingSample[] = [];
  for (const span of classValueSpans(view)) {
    for (const { token, start } of classTokens(span)) {
      const match = SPACING_UTILITY.exec(utilityBody(token));
      if (match === null) continue;
      const sample = utilitySample(file, lineAt(starts, start), token, match);
      if (sample !== null) samples.push(sample);
    }
  }
  return samples;
}

function measureDeclarationSpacing(
  file: string,
  view: string,
  starts: readonly number[]
): SpacingSample[] {
  const samples: SpacingSample[] = [];
  for (const region of declarationRegions(file, view)) {
    for (const declaration of declarationMatches(region, SPACING_PROPERTY)) {
      const line = lineAt(starts, declaration.start);
      for (const raw of splitDeclarationValue(declaration.value)) {
        const parsed = parseSpacingValue(raw);
        if (parsed === null) continue;
        samples.push({
          file,
          line,
          property: declaration.property,
          raw,
          px: parsed.px,
          step: null,
          variable: parsed.variable,
          reason: parsed.reason
        });
      }
    }
  }
  return samples;
}

/** Every spacing value one source declares, in source order. */
function measureSource(source: AuditSource): SpacingSample[] {
  const view = sourceView(source);
  return [
    ...measureClassSpacing(source.file, view.comments, view.starts),
    ...measureDeclarationSpacing(source.file, view.comments, view.starts)
  ];
}

/** Every spacing value a page's source declares, in source order. */
export function measureSpacing(sources: readonly AuditSource[]): SpacingSample[] {
  return sources.flatMap((source) => memoBySource(source, 'spacing', () => measureSource(source)));
}
