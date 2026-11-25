/**
 * Surface measurement for the S7 audit (Task 5): radius tiers and shadow blur.
 *
 * A radius tier is a distinct value the page uses — a Tailwind keyword
 * (`rounded-lg`), an arbitrary/declared length (`rounded-[6px]`,
 * `border-radius: 8px`), or a percentage. Keyword tiers are counted by NAME,
 * because the contract declares a numeric `tokenScale.radius` and inventing a
 * keyword→px map (Tailwind's default scale) would judge the page against a
 * ladder its own project never declared. Numeric tiers carry their px so the
 * verdict can say which ones are off the declared ladder.
 *
 * A shadow's blur is the third length of a `box-shadow` (`x y blur [spread]`).
 * A variable or `calc()` shadow is `null`: the audit cannot know the blur, so
 * it is not judged (the spike's rule — elevation has no declared scale).
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
import { memoBySource, sourceView } from './source-view.js';

/** One radius value found in a source, before any tier verdict. */
export type RadiusSample = {
  file: string;
  line: number;
  /** The value as written (`rounded-lg`, `8px`, `50%`, `var(--radius)`). */
  raw: string;
  /** The tier this value contributes (`rounded-lg`, `8`, `50%`). */
  tier: string;
  /** Resolved px when the value is an absolute length; null otherwise. */
  px: number | null;
  /** True when the value is a `var()` / `calc()` the audit cannot read. */
  unreadable: boolean;
};

/** One shadow declaration, with its maximum blur radius. */
export type ShadowSample = {
  file: string;
  line: number;
  raw: string;
  /** Blur in px; null when the value is runtime-only. */
  blurPx: number | null;
};

/** The 16px rem assumption, stated once (the spacing reader records the same). */
const REM_PX = 16;

/** A bare length (`0`, `4px`, `0.5rem`). Bare values are px by CSS convention. */
const LENGTH = /^(-?\d*\.?\d+)(px|rem)?$/i;

/** A Tailwind radius utility, with an optional side and value suffix. */
const RADIUS_UTILITY = /^rounded(?:-(.+))?$/;

/** Side-only radius utilities carry the default value. */
const SIDE_ONLY = new Set(['t', 'r', 'b', 'l', 'tl', 'tr', 'br', 'bl', 's', 'e', 'ss', 'se', 'es']);

function display(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

/** A CSS length in px; null when the text is not a readable length. */
export function parseLength(text: string): number | null {
  const match = LENGTH.exec(text.trim());
  if (match === null) return null;
  const amount = Number.parseFloat(match[1] ?? '');
  if (!Number.isFinite(amount)) return null;
  return (match[2] ?? '').toLowerCase() === 'rem' ? amount * REM_PX : amount;
}

/** A radius value: its tier, its px when readable, and whether it is runtime-only. */
export function radiusValue(raw: string): { tier: string; px: number | null; unreadable: boolean } {
  const value = raw.trim();
  if (/\b(?:var|calc|clamp|min|max|env)\s*\(/.test(value)) {
    return { tier: value, px: null, unreadable: true };
  }
  const px = parseLength(value);
  if (px !== null) return { tier: display(px), px, unreadable: false };
  return { tier: value, px: null, unreadable: false };
}

/** A Tailwind `rounded-*` body as a tier, or null for `rounded-none`. */
export function radiusUtility(body: string): { tier: string; px: number | null } | null {
  const match = RADIUS_UTILITY.exec(body);
  if (match === null) return null;
  const suffix = match[1];
  if (suffix === undefined) return { tier: 'rounded', px: null };
  if (suffix === 'none') return null;
  if (suffix.startsWith('[') && suffix.endsWith(']')) {
    const px = parseLength(suffix.slice(1, -1));
    return px === null ? { tier: suffix, px: null } : { tier: display(px), px };
  }
  if (SIDE_ONLY.has(suffix)) return { tier: 'rounded', px: null };
  return { tier: `rounded-${suffix}`, px: null };
}

/** Split on a separator at parenthesis depth zero (comma-separated shadows). */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '(') depth += 1;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (char === separator && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/** A shadow's blur is the third length: `offset-x offset-y blur [spread]`. */
const BLUR_LENGTH_INDEX = 2;

/** One shadow's blur: the third length before the colour. */
function blurOfShadow(shadow: string): number | null {
  const lengths: number[] = [];
  for (const part of shadow.trim().split(/\s+/)) {
    if (part === '' || part === 'inset') continue;
    if (part.includes('(') || part.startsWith('#')) break;
    const length = parseLength(part);
    if (length === null) break;
    lengths.push(Math.abs(length));
  }
  if (lengths.length === 0) return null;
  return lengths.length > BLUR_LENGTH_INDEX ? (lengths[BLUR_LENGTH_INDEX] ?? 0) : 0;
}

/**
 * The maximum blur across a shadow's comma-separated layers, or null when the
 * value is a runtime variable the audit cannot resolve.
 */
export function shadowBlur(raw: string): number | null {
  const cleaned = raw.replace(/_/g, ' ').trim();
  if (/\bvar\s*\(/.test(cleaned)) return null;
  const blurs = splitTopLevel(cleaned, ',')
    .map((layer) => blurOfShadow(layer))
    .filter((blur): blur is number => blur !== null);
  return blurs.length === 0 ? null : Math.max(...blurs);
}

/** Every `border-radius` / `borderRadius` value a source declares. */
function declarationRadii(
  source: AuditSource,
  view: string,
  starts: readonly number[]
): RadiusSample[] {
  const samples: RadiusSample[] = [];
  for (const region of declarationRegions(source.file, view)) {
    for (const declaration of declarationMatches(region, 'border-radius|borderRadius')) {
      const line = lineAt(starts, declaration.start);
      for (const raw of splitDeclarationValue(declaration.value)) {
        samples.push({ file: source.file, line, raw, ...radiusValue(raw) });
      }
    }
  }
  return samples;
}

/** Every `rounded-*` utility a source's class contexts carry. */
function classRadii(source: AuditSource, view: string, starts: readonly number[]): RadiusSample[] {
  const samples: RadiusSample[] = [];
  for (const span of classValueSpans(view)) {
    for (const { token, start } of classTokens(span)) {
      const parsed = radiusUtility(utilityBody(token));
      if (parsed === null) continue;
      samples.push({
        file: source.file,
        line: lineAt(starts, start),
        raw: token,
        tier: parsed.tier,
        px: parsed.px,
        unreadable: false
      });
    }
  }
  return samples;
}

/** Every radius value a source declares, in source order. */
/** Every radius value one source declares, in source order. */
function radiusOfSource(source: AuditSource): RadiusSample[] {
  const view = sourceView(source);
  return [
    ...declarationRadii(source, view.comments, view.starts),
    ...classRadii(source, view.comments, view.starts)
  ];
}

/** Every radius value a source declares, in source order. */
export function measureRadius(sources: readonly AuditSource[]): RadiusSample[] {
  return sources.flatMap((source) => memoBySource(source, 'radius', () => radiusOfSource(source)));
}

/** Every shadow declaration one source carries. */
function shadowsOfSource(source: AuditSource): ShadowSample[] {
  const samples: ShadowSample[] = [];
  const view = sourceView(source);
  for (const region of declarationRegions(source.file, view.comments)) {
    for (const declaration of declarationMatches(region, 'box-shadow|boxShadow')) {
      samples.push({
        file: source.file,
        line: lineAt(view.starts, declaration.start),
        raw: declaration.value,
        blurPx: shadowBlur(declaration.value)
      });
    }
  }
  for (const span of classValueSpans(view.comments)) {
    for (const { token, start } of classTokens(span)) {
      const body = utilityBody(token);
      const match = /^shadow-\[(.+)\]$/.exec(body);
      if (match === null) continue;
      samples.push({
        file: source.file,
        line: lineAt(view.starts, start),
        raw: token,
        blurPx: shadowBlur(match[1] ?? '')
      });
    }
  }
  return samples;
}

/** Every shadow declaration (CSS/inline, and Tailwind arbitrary shadows). */
export function measureShadows(sources: readonly AuditSource[]): ShadowSample[] {
  return sources.flatMap((source) => memoBySource(source, 'shadow', () => shadowsOfSource(source)));
}
