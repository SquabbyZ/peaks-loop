/**
 * Shared vocabulary for the S7 design-audit detectors.
 *
 * A finding is the one unit every dimension emits. `value` and `expected` are
 * machine-comparable; `humanText` and `techText` are the bilingual pair the
 * report prints — one plain Chinese sentence a person can act on, and one
 * `file:line property:value …` line an agent can grep. The source primitives
 * below read class *contexts* (`className`, `cn()`, `cva()`) and inline
 * `style={{ … }}` objects, never every string literal: the spike measured that
 * a bare literal (`RADIUS_KEYWORDS = ['radius', 'rounded']`) would otherwise
 * fire a design rule on non-UI code.
 */

import type { DesignTokenScale } from '../paved-road.js';
import type { CssVariableTable } from './css-variables.js';

/** Dimensions this slice implements; later slices extend the union. */
export type AuditDimension =
  'spacing' | 'type' | 'color' | 'contrast' | 'surface' | 'hierarchy' | 'a11y' | 'states';

export type AuditSeverity = 'hard' | 'soft' | 'unmeasured';

/**
 * How many values a value-based detector actually judged, and how many of them
 * stayed on-contract. `measured` counts on-ladder + off-ladder only: an
 * `unmeasured` value is excluded from BOTH sides of the ratio, so "we could not
 * judge it" can never be read as a clean value or as a violation.
 */
export type DimensionJudgement = {
  measured: number;
  onContract: number;
};

/** The zero judgement a detector hands back when it judged no value at all. */
export const NO_JUDGEMENT: DimensionJudgement = { measured: 0, onContract: 0 };

export type AuditFinding = {
  dimension: AuditDimension;
  severity: AuditSeverity;
  file: string;
  line: number;
  value: string;
  expected: string;
  humanText: string;
  techText: string;
};

/** One source file handed to a detector. The path is reported verbatim. */
export type AuditSource = {
  file: string;
  source: string;
};

/** A detector's whole input: the declared oracle and the page's source files. */
export type AuditInput = {
  /** The contract's declared scale — never the built-in default by accident. */
  tokenScale: DesignTokenScale;
  sources: readonly AuditSource[];
  /**
   * The page module on its own, when `sources` ALSO carries the import closure
   * (S7 Task 6d). A value dimension reads `sources` as page + closure, because
   * the values live in the components the page renders; a page-scope rule
   * inside such a dimension — the primary-string rule — reads only this set.
   * Absent means `sources` already is the page module alone.
   */
  pageSources?: readonly AuditSource[];
  /**
   * Custom properties read from the project's stylesheets (S7 Task 3b). A
   * `var()` reference resolves through it when its value is unique; when the
   * definitions differ per state it stays `unmeasured`, naming every state.
   */
  variables?: CssVariableTable;
  /**
   * Markup modules the page imports (S7 Task 5, bounded import closure). The
   * value dimensions read them as part of the page (Task 6d); the states
   * detector searches them for an empty/error branch the page itself does not
   * spell out; the a11y detector uses them as part of its file set.
   */
  imports?: readonly AuditSource[];
  /**
   * The project's stylesheets. The a11y detector consults them only for a
   * `focus-visible` style: a `.css` file has no elements to judge.
   */
  styles?: readonly AuditSource[];
};

/** A slice of a source view, with the absolute index its first character had. */
export type SourceSpan = {
  text: string;
  start: number;
};

/** 1-based line starts of a source, built once; comment stripping keeps indices. */
export function lineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') starts.push(index + 1);
  }
  return starts;
}

/** Binary search over precomputed line starts — never a rescan per finding. */
export function lineAt(starts: readonly number[], index: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if ((starts[mid] ?? 0) <= index) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

/** The index of the bracket matching the one at `open`, or -1 when unclosed. */
function matchingClose(text: string, open: number, openChar: string, closeChar: string): number {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (char === openChar) depth += 1;
    else if (char === closeChar) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

const CLASS_NAME_START = /\bclassName\s*=\s*/g;
const CLASS_HELPER_START = /\b(?:cn|clsx|cva|twMerge)\s*\(/g;
const STYLE_OBJECT_START = /\bstyle\s*=\s*\{\{/g;
const WHITESPACE_TOKEN = /\S+/g;

function quotedSpan(view: string, at: number): SourceSpan | null {
  const quote = view[at];
  if (quote === '"' || quote === "'" || quote === '`') {
    const close = view.indexOf(quote, at + 1);
    return { text: view.slice(at + 1, close === -1 ? view.length : close), start: at + 1 };
  }
  return null;
}

function bracedSpan(view: string, at: number): SourceSpan | null {
  if (view[at] !== '{') return null;
  const close = matchingClose(view, at, '{', '}');
  return { text: view.slice(at + 1, close === -1 ? view.length : close), start: at + 1 };
}

function contains(span: SourceSpan, index: number): boolean {
  return index >= span.start && index < span.start + span.text.length;
}

/**
 * Class-value spans: `className="…"`, `className={'…'}`, `className={…}`, and
 * the argument lists of `cn` / `clsx` / `cva` / `twMerge`. A helper nested in a
 * `className` attribute is already covered by that attribute and is skipped.
 */
export function classValueSpans(view: string): SourceSpan[] {
  const spans: SourceSpan[] = [];
  for (const match of view.matchAll(CLASS_NAME_START)) {
    const at = (match.index ?? 0) + match[0].length;
    const span = quotedSpan(view, at) ?? bracedSpan(view, at);
    if (span !== null) spans.push(span);
  }
  for (const match of view.matchAll(CLASS_HELPER_START)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    const close = matchingClose(view, open, '(', ')');
    const start = open + 1;
    if (spans.some((span) => contains(span, start))) continue;
    spans.push({ text: view.slice(start, close === -1 ? view.length : close), start });
  }
  return spans;
}

/**
 * The inner text of every `style={{ … }}` object. Inline declarations are read
 * only from here, so an unrelated `{ padding: 12 }` config object is not a
 * spacing value.
 */
export function inlineStyleSpans(view: string): SourceSpan[] {
  const spans: SourceSpan[] = [];
  for (const match of view.matchAll(STYLE_OBJECT_START)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    const close = matchingClose(view, open, '{', '}');
    spans.push({ text: view.slice(open + 1, close === -1 ? view.length : close), start: open + 1 });
  }
  return spans;
}

/**
 * Where declarations may be read: the whole file for CSS and SCSS, and only the
 * inline `style` objects for markup. A page's TS/TSX config objects stay out of
 * scope. `.scss` is audit-only too: the G1 scan never reads either extension.
 */
export function declarationRegions(file: string, view: string): SourceSpan[] {
  const lower = file.toLowerCase();
  return lower.endsWith('.css') || lower.endsWith('.scss')
    ? [{ text: view, start: 0 }]
    : inlineStyleSpans(view);
}

/**
 * Whitespace-separated class tokens with their absolute source positions. A
 * helper argument keeps its quotes and separator (`'p-4',`), so both are
 * trimmed; a quoted multi-utility string (`'p-4 m-2'`) then yields its parts.
 */
export function classTokens(span: SourceSpan): Array<{ token: string; start: number }> {
  const tokens: Array<{ token: string; start: number }> = [];
  for (const match of span.text.matchAll(WHITESPACE_TOKEN)) {
    const token = match[0].replace(/^["'`]+/, '').replace(/["'`,;]+$/, '');
    if (token === '') continue;
    tokens.push({ token, start: span.start + (match.index ?? 0) });
  }
  return tokens;
}

/**
 * A utility's own body: the importance marker and every responsive / state
 * variant (`md:`, `dark:`, `data-[x]:`) removed, but a colon inside an
 * arbitrary value (`text-[length:13px]`) kept.
 */
export function utilityBody(token: string): string {
  const body = token.startsWith('!') ? token.slice(1) : token;
  let depth = 0;
  let lastColon = -1;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char === '[') depth += 1;
    else if (char === ']') depth = Math.max(0, depth - 1);
    else if (char === ':' && depth === 0) lastColon = index;
  }
  return lastColon === -1 ? body : body.slice(lastColon + 1);
}

const QUOTED_OR_BARE = String.raw`(["'\x60])([^"'\x60]*)\2|([^;}{,\n]+)`;

/** One `property: value` declaration, with the value's absolute index. */
export type DeclarationMatch = {
  property: string;
  value: string;
  start: number;
};

/**
 * `property: value` declarations inside a region. `propertyPattern` is a regex
 * alternation without anchors (CSS kebab-case and JSX camelCase both). The
 * value is either a quoted literal or everything up to `;`, `}`, `{`, `,` or a
 * newline.
 *
 * The lookbehind keeps a NAME that merely ends in a property from being read as
 * one: `--padding: 13px` is a custom property and `$gap: 12px` is a Sass
 * variable, and neither declares the `padding` / `gap` property. Without it a
 * stylesheet defining `--padding` would manufacture an off-ladder spacing
 * finding for a value that is never applied.
 */
export function declarationMatches(
  region: SourceSpan,
  propertyPattern: string
): DeclarationMatch[] {
  const pattern = new RegExp(
    String.raw`(?<![-\w$])(${propertyPattern})\s*:\s*(?:${QUOTED_OR_BARE})`,
    'g'
  );
  const matches: DeclarationMatch[] = [];
  for (const match of region.text.matchAll(pattern)) {
    const whole = match[0];
    const property = match[1] ?? '';
    const rawValue = match[3] ?? match[4] ?? '';
    const value = rawValue.trim();
    const from = whole.indexOf(rawValue, whole.indexOf(':') + 1);
    const offset = from === -1 ? whole.indexOf(':') + 1 : from;
    matches.push({
      property,
      value,
      start: region.start + (match.index ?? 0) + offset
    });
  }
  return matches;
}

/** Split a declaration value into the values a detector must judge. */
export function splitDeclarationValue(value: string): string[] {
  // A function value (`calc(var(--spacing) * 2)`) is one value; splitting on
  // whitespace would tear it into fragments and report garbage.
  return value.includes('(') ? [value] : value.trim().split(/\s+/).filter(Boolean);
}
