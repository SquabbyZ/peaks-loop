/**
 * Markup scanner for the S7 Task 5 detectors (surface / hierarchy / a11y /
 * states).
 *
 * The audit's other detectors read class strings and declarations; these four
 * need the ELEMENT a class or attribute belongs to — is this `<h1>` missing, is
 * this `<div>` carrying an `onClick` without a role, is this the second primary
 * action on the page. This scanner is deliberately small and dependency-free:
 * opening tags only, with quote- and brace-aware attribute values so
 * `onClick={() => a > b}` is one attribute rather than a broken tag.
 *
 * It is a SOURCE heuristic, not a parser: a closing tag is skipped (its name is
 * never needed — a run is judged from its opening tags), a generic `<T>` scans
 * as a tag named `T` with no attributes (harmless for every rule here), and an
 * unterminated tag is dropped rather than guessed at. `isMarkupFile` scopes
 * every caller, so a `.css` or `.ts` file is never read as markup.
 */

import { lineAt, lineStarts, type SourceSpan } from './audit-finding.js';

/** One attribute of an opening tag; `value` is the raw inner text, unquoted. */
export type MarkupAttribute = {
  name: string;
  value: string | null;
  start: number;
};

/** One opening tag, with its absolute `[start, end)` range in the source. */
export type MarkupElement = {
  tag: string;
  lowerTag: string;
  attributes: MarkupAttribute[];
  start: number;
  end: number;
  /** 1-based line of the tag's `<`. */
  line: number;
};

/** Extensions the markup rules read. A `.css` file has no elements. */
const MARKUP_EXTENSIONS = ['.tsx', '.jsx', '.vue', '.svelte'] as const;

/** Attribute / tag name characters, including Vue and Svelte markers. */
const NAME_CHAR = /[\w.:@-]/;
const LETTER = /[A-Za-z]/;
const WHITESPACE = /\s/;
const QUOTES = new Set(['"', "'", '`']);

/** True when a source file is a markup document the element rules can read. */
export function isMarkupFile(file: string): boolean {
  const lower = file.toLowerCase();
  return MARKUP_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/** The markup sources of a detector's input set. */
export function markupSources<T extends { file: string }>(sources: readonly T[]): T[] {
  return sources.filter((source) => isMarkupFile(source.file));
}

function isLetter(char: string | undefined): boolean {
  return char !== undefined && LETTER.test(char);
}

function isNameChar(char: string | undefined): boolean {
  return char !== undefined && NAME_CHAR.test(char);
}

/** The index after a quoted string starting at `at` (unterminated runs to EOF). */
function skipString(view: string, at: number): number {
  const quote = view[at];
  for (let index = at + 1; index < view.length; index += 1) {
    const char = view[index];
    if (char === '\\') {
      index += 1;
      continue;
    }
    if (char === quote) return index + 1;
  }
  return view.length;
}

/** The index after a balanced `{ … }` starting at `at`, strings respected. */
function skipBraces(view: string, at: number): number {
  let depth = 0;
  for (let index = at; index < view.length; index += 1) {
    const char = view[index];
    if (char !== undefined && QUOTES.has(char)) {
      index = skipString(view, index) - 1;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return view.length;
}

/** A quoted, braced or bare attribute value; null when the value is empty. */
function readAttributeValue(view: string, at: number): { value: string; to: number } | null {
  const char = view[at];
  if (char !== undefined && QUOTES.has(char)) {
    const to = skipString(view, at);
    return { value: view.slice(at + 1, Math.max(at + 1, to - 1)), to };
  }
  if (char === '{') {
    const to = skipBraces(view, at);
    return { value: view.slice(at + 1, Math.max(at + 1, to - 1)), to };
  }
  let to = at;
  while (to < view.length && !WHITESPACE.test(view[to] ?? '') && view[to] !== '>') to += 1;
  return to === at ? null : { value: view.slice(at, to), to };
}

type OpeningTag = { tag: string; attributes: MarkupAttribute[]; end: number };

type AttributeList = { attributes: MarkupAttribute[]; end: number };

/** The index of the first non-whitespace character at or after `at`. */
function skipSpace(view: string, at: number): number {
  let index = at;
  while (index < view.length && WHITESPACE.test(view[index] ?? '')) index += 1;
  return index;
}

/**
 * The attributes after a tag name, up to and including the closing `>` (or the
 * self-closing `/>`). Null on an unterminated tag.
 */
function readAttributes(view: string, from: number): AttributeList | null {
  const attributes: MarkupAttribute[] = [];
  let index = from;
  while (index < view.length) {
    index = skipSpace(view, index);
    if (index >= view.length) return null;
    const char = view[index];
    if (char === '>') return { attributes, end: index + 1 };
    if (char === '/' && view[index + 1] === '>') return { attributes, end: index + 2 };
    const attributeStart = index;
    while (isNameChar(view[index])) index += 1;
    if (index === attributeStart) {
      index += 1;
      continue;
    }
    const name = view.slice(attributeStart, index);
    const read = readValueAfterEquals(view, index);
    attributes.push({ name, value: read.value, start: attributeStart });
    index = read.to;
  }
  return null;
}

/**
 * One opening tag at `at` (where `view[at] === '<'`). Null on a malformed or
 * unterminated tag: the caller skips it rather than inventing attributes.
 */
function readOpeningTag(view: string, at: number): OpeningTag | null {
  let index = at + 1;
  const nameStart = index;
  while (isNameChar(view[index])) index += 1;
  if (index === nameStart) return null;
  const tag = view.slice(nameStart, index);
  const read = readAttributes(view, index);
  return read === null ? null : { tag, attributes: read.attributes, end: read.end };
}

/** The attribute value that follows the whitespace and optional `=` at `at`. */
function readValueAfterEquals(view: string, at: number): { value: string | null; to: number } {
  let cursor = at;
  while (cursor < view.length && WHITESPACE.test(view[cursor] ?? '')) cursor += 1;
  if (view[cursor] !== '=') return { value: null, to: at };
  cursor += 1;
  while (cursor < view.length && WHITESPACE.test(view[cursor] ?? '')) cursor += 1;
  const read = readAttributeValue(view, cursor);
  return read === null ? { value: null, to: cursor } : { value: read.value, to: read.to };
}

/** Every opening tag in a comment-stripped markup view, in source order. */
export function scanElements(view: string, starts: readonly number[]): MarkupElement[] {
  const elements: MarkupElement[] = [];
  let index = 0;
  while (index < view.length) {
    if (view[index] !== '<' || !isLetter(view[index + 1])) {
      index += 1;
      continue;
    }
    const parsed = readOpeningTag(view, index);
    if (parsed === null) {
      index += 1;
      continue;
    }
    elements.push({
      ...parsed,
      lowerTag: parsed.tag.toLowerCase(),
      start: index,
      line: lineAt(starts, index)
    });
    index = parsed.end;
  }
  return elements;
}

/** The first attribute whose name matches (case-insensitive), or null. */
export function attributeOf(
  element: MarkupElement,
  names: readonly string[]
): MarkupAttribute | null {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  return element.attributes.find((attribute) => wanted.has(attribute.name.toLowerCase())) ?? null;
}

/** True when the element carries any of the named attributes. */
export function hasAttributeOf(element: MarkupElement, names: readonly string[]): boolean {
  return attributeOf(element, names) !== null;
}

/** The class-value span that belongs to one element, when it has one. */
export function classSpanOf(
  element: MarkupElement,
  spans: readonly SourceSpan[]
): SourceSpan | null {
  return spans.find((span) => span.start >= element.start && span.start < element.end) ?? null;
}

/**
 * A region with every `{ … }` expression blanked, so a `{title}` child is not
 * mistaken for static text.
 */
function withoutExpressions(region: string): string {
  let depth = 0;
  let text = '';
  for (const char of region) {
    if (char === '{') depth += 1;
    else if (char === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0) text += char;
  }
  return text;
}

/**
 * True when a markup view renders static text a person can read. Only the
 * region between an opening tag and the first closing tag of the same name is
 * read: identifiers and punctuation in the surrounding TypeScript are not text,
 * and a self-closing root (`<div />`) renders none. Expressions (`{title}`) are
 * removed before the test — source cannot know what they render, so the page is
 * treated as text-free rather than guessed at. This is the guard behind "the
 * hierarchy rule never fires on a page with no rendered text".
 */
export function hasRenderedText(view: string): boolean {
  const lower = view.toLowerCase();
  for (const element of scanElements(view, lineStarts(view))) {
    const source = view.slice(element.start, element.end);
    if (source.trimEnd().endsWith('/>')) continue;
    const close = lower.indexOf(`</${element.lowerTag}`, element.end);
    if (close === -1) continue;
    if (/[\p{L}\p{N}]/u.test(withoutExpressions(view.slice(element.end, close)))) return true;
  }
  return false;
}
