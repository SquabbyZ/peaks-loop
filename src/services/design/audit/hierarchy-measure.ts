/**
 * Hierarchy measurement for the S7 audit (Task 5): headings and type levels.
 *
 * A "type level" is a distinct combination of the three axes a person actually
 * sees — font size, font weight and text colour — read from one element's class
 * context. The element's axes are combined as a product because that is what
 * the rendered element offers: `text-base` alone is one level, while
 * `text-base font-normal` and `text-base font-bold` are two. An element with no
 * readable type token contributes nothing; a page whose text is styled by
 * hand-written class names therefore measures ZERO levels, which the hierarchy
 * detector reports as `unmeasured`, never as "too few levels".
 */

import {
  classTokens,
  classValueSpans,
  type AuditSource,
  type SourceSpan
} from './audit-finding.js';
import { classSpanOf, isMarkupFile, scanElements } from './markup-scan.js';
import { memoBySource, sourceView } from './source-view.js';

/** One distinguishable text level, with the axes that produced it. */
export type TypeLevel = {
  key: string;
  size: string | null;
  weight: string | null;
  color: string | null;
};

/** A utility's combinable levels are capped so one dense class list stays cheap. */
const MAX_LEVELS = 16;

const SIZE = /^text-(?:xs|sm|base|lg|xl|[2-9]xl)$/;
const SIZE_ARBITRARY = /^text-\[(?:length:)?-?[\d.]+(?:px|rem)\]$/;
const WEIGHT = /^font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/;
const WEIGHT_ARBITRARY = /^font-\[[1-9]00\]$/;
const COLOUR_ARBITRARY = /^text-\[(?:#|rgb|rgba|hsl|oklch|color)/;

/** Utility suffixes that start with `text-` but are not a colour. */
const NOT_COLOUR = new Set([
  'left',
  'center',
  'right',
  'justify',
  'start',
  'end',
  'wrap',
  'nowrap',
  'balance',
  'pretty',
  'ellipsis',
  'clip',
  'truncate'
]);

type Axis = { axis: 'size' | 'weight' | 'colour'; value: string };

/** What one utility token contributes, or null when it names no type axis. */
export function typeAxis(token: string): Axis | null {
  if (SIZE.test(token) || SIZE_ARBITRARY.test(token)) return { axis: 'size', value: token };
  if (WEIGHT.test(token) || WEIGHT_ARBITRARY.test(token)) return { axis: 'weight', value: token };
  if (!token.startsWith('text-')) return null;
  if (COLOUR_ARBITRARY.test(token)) return { axis: 'colour', value: token };
  const suffix = token.slice('text-'.length);
  if (suffix === '' || NOT_COLOUR.has(suffix)) return null;
  return { axis: 'colour', value: token };
}

type Axes = { sizes: Set<string>; weights: Set<string>; colors: Set<string> };

/** The distinct values each type axis carries in one class context. */
function axesOfSpan(span: SourceSpan): Axes {
  const axes: Axes = { sizes: new Set(), weights: new Set(), colors: new Set() };
  for (const { token } of classTokens(span)) {
    const axis = typeAxis(token.replace(/^["'`]+/, '').replace(/[,;]+$/, ''));
    if (axis === null) continue;
    if (axis.axis === 'size') axes.sizes.add(axis.value);
    else if (axis.axis === 'weight') axes.weights.add(axis.value);
    else axes.colors.add(axis.value);
  }
  return axes;
}

/** Every combination of the axes one element carries, placeholders included. */
function combineLevels(axes: Axes): TypeLevel[] {
  const levels: TypeLevel[] = [];
  const sizes = axes.sizes.size === 0 ? [null] : axes.sizes;
  const weights = axes.weights.size === 0 ? [null] : axes.weights;
  const colors = axes.colors.size === 0 ? [null] : axes.colors;
  for (const size of sizes) {
    for (const weight of weights) {
      for (const color of colors) {
        levels.push({
          key: `${size ?? '-'}|${weight ?? '-'}|${color ?? '-'}`,
          size,
          weight,
          color
        });
      }
    }
  }
  return levels;
}

function levelsOfSpan(span: SourceSpan): TypeLevel[] {
  const axes = axesOfSpan(span);
  if (axes.sizes.size + axes.weights.size + axes.colors.size === 0) return [];
  return combineLevels(axes);
}

/** Every distinguishable type level one markup source declares. */
function levelsOfSource(source: AuditSource): TypeLevel[] {
  const found = new Map<string, TypeLevel>();
  const view = sourceView(source);
  const spans = classValueSpans(view.comments);
  for (const element of scanElements(view.comments, view.starts)) {
    const span = classSpanOf(element, spans);
    if (span === null) continue;
    for (const level of levelsOfSpan(span)) {
      if (!found.has(level.key)) found.set(level.key, level);
    }
  }
  return [...found.values()];
}

/** Every distinguishable type level across a page's markup sources. */
export function markupTypeLevels(sources: readonly AuditSource[]): TypeLevel[] {
  const levels = new Map<string, TypeLevel>();
  for (const source of sources) {
    if (!isMarkupFile(source.file)) continue;
    const found = memoBySource(source, 'type-levels', () => levelsOfSource(source));
    for (const level of found) {
      if (levels.size >= MAX_LEVELS) return [...levels.values()];
      if (!levels.has(level.key)) levels.set(level.key, level);
    }
  }
  return [...levels.values()];
}

/** True when one markup source renders an `<h1>`. */
function headingOfSource(source: AuditSource): boolean {
  const view = sourceView(source);
  return scanElements(view.comments, view.starts).some((element) => element.lowerTag === 'h1');
}

/** True when any markup source in the set renders an `<h1>`. */
export function hasHeading(sources: readonly AuditSource[]): boolean {
  return sources.some(
    (source) =>
      isMarkupFile(source.file) &&
      memoBySource(source, 'has-heading', () => headingOfSource(source))
  );
}

/** The first markup file of a set, for anchoring a page-level finding. */
export function firstMarkupFile(sources: readonly AuditSource[]): AuditSource | null {
  return sources.find((source) => isMarkupFile(source.file)) ?? null;
}

/** A level's readable description, used by the finding's bilingual pair. */
export function describeLevel(level: TypeLevel): string {
  return [level.size, level.weight, level.color]
    .filter((part): part is string => part !== null)
    .join(' ');
}
