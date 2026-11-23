/**
 * Comment and string stripping for the G1 source scanner.
 *
 * A symptom written in a comment must never fail a file, so every scan view
 * removes comment text first. Blanking is space-for-character (newlines and
 * carriage returns excepted), which keeps every index and line number
 * identical to the original source.
 *
 * One pass collects the comment and string-literal spans, and both views are
 * then built by blanking a subset of those spans: `comments` keeps string
 * bodies intact so attribute values and import specifiers stay readable, and
 * `code` blanks the bodies but keeps the quote characters, so a sentence that
 * merely contains `style={{` inside a literal does not fire a code-shape rule
 * while a real `style="..."` attribute still shows the quote that marks it.
 */

type QuoteState = 'single' | 'double' | 'template';

/** A half-open `[from, to)` range of characters to blank. */
type Span = { readonly from: number; readonly to: number };

export type StrippedViews = {
  /** Comments blanked; string literals intact. */
  comments: string;
  /** Comments and string-literal bodies blanked. */
  code: string;
};

const CLOSING_QUOTE: Record<QuoteState, string> = {
  single: "'",
  double: '"',
  template: '`'
};

function quoteStateFor(char: string | undefined): QuoteState | null {
  if (char === "'") return 'single';
  if (char === '"') return 'double';
  if (char === '`') return 'template';
  return null;
}

function lineCommentEnd(source: string, from: number): number {
  const newline = source.indexOf('\n', from + 2);
  return newline === -1 ? source.length : newline;
}

function blockCommentEnd(source: string, from: number): number {
  const close = source.indexOf('*/', from + 2);
  return close === -1 ? source.length : close + 2;
}

/** A plain string ends at its closing quote or at a newline; a template spans both. */
function stringEnd(
  source: string,
  from: number,
  quote: QuoteState
): { to: number; terminated: boolean } {
  const closing = CLOSING_QUOTE[quote];
  for (let index = from + 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === '\\') {
      index += 1;
      continue;
    }
    if (char === closing) return { to: index + 1, terminated: true };
    if (quote !== 'template' && (char === '\n' || char === '\r')) {
      return { to: index, terminated: false };
    }
  }
  return { to: source.length, terminated: false };
}

/** The body of a string literal: everything between, but not including, its quotes. */
function stringBody(from: number, end: { to: number; terminated: boolean }): Span {
  return { from: from + 1, to: end.terminated ? end.to - 1 : end.to };
}

function collectSpans(source: string): { comments: Span[]; strings: Span[] } {
  const comments: Span[] = [];
  const strings: Span[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === '/' && next === '/') {
      const to = lineCommentEnd(source, index);
      comments.push({ from: index, to });
      index = to;
      continue;
    }
    if (char === '/' && next === '*') {
      const to = blockCommentEnd(source, index);
      comments.push({ from: index, to });
      index = to;
      continue;
    }
    const quote = quoteStateFor(char);
    if (quote === null) {
      index += 1;
      continue;
    }
    const end = stringEnd(source, index, quote);
    strings.push(stringBody(index, end));
    index = end.to;
  }
  return { comments, strings };
}

function blank(text: string): string {
  return text.replace(/[^\r\n]/g, ' ');
}

/** Replace every span with spaces in one pass over the source, never a char array. */
function blankSpans(source: string, spans: readonly Span[]): string {
  if (spans.length === 0) return source;
  const parts: string[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.to <= cursor) continue;
    const from = Math.max(span.from, cursor);
    parts.push(source.slice(cursor, from), blank(source.slice(from, span.to)));
    cursor = span.to;
  }
  parts.push(source.slice(cursor));
  return parts.join('');
}

export function stripViews(source: string): StrippedViews {
  const { comments, strings } = collectSpans(source);
  const codeSpans = [...comments, ...strings].sort((left, right) => left.from - right.from);
  return {
    comments: blankSpans(source, comments),
    code: blankSpans(source, codeSpans)
  };
}
