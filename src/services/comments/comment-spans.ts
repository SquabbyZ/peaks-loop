// src/services/comments/comment-spans.ts
//
// WHERE THE COMMENTS ACTUALLY ARE, read from the text the way a lexer reads it.
//
// WHY THIS FILE EXISTS (rid `2026-10-05-comment-scan-string-awareness`). The first
// version of this reader was line-local: a line was a comment if it began with `//`, a
// block opener, or `*`, and a code line's trailing comment was `raw.indexOf('//')`
// guarded by a quote-count parity check. Applying the pruner to the real tree then wrote
// a corrupted file. `feedback-promotion-service.ts` holds a one-line template literal
// whose CONTENT starts with a double slash — it is a snippet the CLI prints for users:
//
//     snippet: `// src/services/code/mode-gate.ts\n// 1. Add to HardFloorCategory union…`,
//
// The reader saw code + trailing comment, the pruner cut at the first double slash, and
// the result was an unterminated template literal committed into `src/`. The quote parity
// guard could not have caught it: the text before the cut contains NO quotes at all, so
// its count is even, and "even" looked safe. Parity of a count is not the same as knowing
// what character you are inside of.
//
// So this walks the file as ONE stream with an explicit notion of where it is: code, a
// single- or double-quoted string, a template literal (whose `${ … }` re-enters code, so
// a nested template, or a real comment, inside an interpolation follows the same rules),
// a regex literal, a line comment, or a block comment.
//
// REGEX IS NOT OPTIONAL DETAIL, and finding that out is why this file is bigger than the
// bug it fixes. `/https?:\/\//g` — a shape this repository has a hundred files of —
// carries a real adjacent pair of slashes, made of an escaped one next to the closing
// delimiter. A stream that does not know it is inside a regex reads that pair as a
// comment and would cut code through it: the same accident as the template literal above,
// reached from a different direction. Whether a `/` opens a regex or divides is decided by
// what could end a value before it, which is the standard test; a word is only a value if
// it is not `return`/`typeof`/`case`/…, because `return /x/` is the one place the naive
// version of that test is wrong.
//
// ONE MACHINE, TWO QUESTIONS. `commentSpans` asks "where are the comments";
// `endsInsideLiteral` asks "does this text stop inside something open". Both run the same
// walk below, because two copies of a state machine is the defect class this repository
// files most often — and the second question is the one the prune proof had to learn to
// ask: `startsWith` is true of every truncation, so it cannot tell a revealed comment
// from a string cut in half.
//
// A HANDLER PER REGION, not one function of nested ifs: the first working version was a
// 126-line loop that both `max-lines-per-function` and `complexity` refused, and they were
// right — `HANDLERS` below is the state diagram, where a single else-chain was not.
//
// NOT A PARSER, AND DELIBERATELY SO: `typescript` is a devDependency, so product code
// cannot import it without handing the shipped CLI a runtime dependency. The parity
// between this walk and the real TypeScript lexer is asserted in
// `tests/unit/comments/comment-scan-parity.test.ts`, which MAY use `ts` — the check lives
// where the dependency already is, instead of the dependency following the check into
// every user's `node_modules`.

/** One comment in the file, in character offsets and in the lines it covers. */
export type CommentSpan = {
  /** Index of the slash that opens it. */
  start: number;
  /** One past the comment's last character, its closing delimiter included. */
  end: number;
  /** 1-based line the comment opens on. */
  line: number;
  /** 1-based line the comment ends on — equal to `line` unless it is a block comment. */
  endLine: number;
  /** The comment's own text, opening marker included. */
  text: string;
};

type Region = 'code' | 'single' | 'double' | 'template' | 'regex' | 'class' | 'line' | 'block';

/**
 * Words after which a `/` is a regex, not division. `return /x/` is the case that makes
 * "an identifier ends a value" wrong often enough to matter.
 */
const VALUE_ENDING_BEFORE_REGEX =
  /^(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;

/** The whole state of one walk. The handlers below mutate it; nothing else owns it. */
type Walk = {
  source: string;
  /** The character being read. The driver advances it by one after each handler. */
  at: number;
  line: number;
  region: Region;
  /** Could the last significant character END a value? That is what decides `/`. */
  afterValue: boolean;
  /** The identifier being accumulated, so a keyword can veto the regex reading. */
  word: string;
  /** Offsets of open `${`. A `}` returns to the template only while this is non-empty. */
  interpolations: number[];
  spanStart: number;
  spanLine: number;
  emit: (span: CommentSpan) => void;
};

const char = (w: Walk, offset = 0): string => w.source.charAt(w.at + offset);

/** Report the comment that opened at `spanStart`. */
function emitSpan(w: Walk, end: number, endLine: number): void {
  w.emit({
    start: w.spanStart,
    end,
    line: w.spanLine,
    endLine,
    text: w.source.slice(w.spanStart, end)
  });
}

/** A finished word: only a non-keyword one can end a value. */
function endWord(w: Walk): void {
  if (w.word === '') return;
  w.afterValue = !VALUE_ENDING_BEFORE_REGEX.test(w.word);
  w.word = '';
}

function inLineComment(w: Walk): void {
  if (char(w) !== '\n') return;
  emitSpan(w, w.at, w.line - 1);
  w.region = 'code';
  w.afterValue = false;
}

function inBlockComment(w: Walk): void {
  if (char(w) !== '*' || char(w, 1) !== '/') return;
  emitSpan(w, w.at + 2, w.line);
  w.at += 1;
  w.region = 'code';
  w.afterValue = false;
}

function inString(w: Walk): void {
  const c = char(w);
  if (c === '\\') w.at += 1;
  else if (c === (w.region === 'single' ? "'" : '"')) {
    w.region = 'code';
    w.afterValue = true;
  } else if (c === '\n') {
    // An unterminated string cannot survive to a newline in valid source. Resuming as
    // code keeps one stray quote from deciding that the rest of the FILE is a string,
    // which is the failure mode that turns every later comment invisible.
    w.region = 'code';
    w.afterValue = false;
  }
}

function inTemplate(w: Walk): void {
  const c = char(w);
  if (c === '\\') w.at += 1;
  else if (c === '`') {
    w.region = 'code';
    w.afterValue = true;
  } else if (c === '$' && char(w, 1) === '{') {
    w.interpolations.push(w.at);
    w.at += 1;
    w.region = 'code';
    w.afterValue = false;
  }
}

/** A regex, or the inside of its `[…]` class where `/` is an ordinary character. */
function inRegex(w: Walk): void {
  const c = char(w);
  if (c === '\\') w.at += 1;
  else if (c === '[') w.region = 'class';
  else if (c === ']' && w.region === 'class') w.region = 'regex';
  else if (c === '/' && w.region === 'regex') {
    w.region = 'code';
    w.afterValue = true;
  } else if (c === '\n') {
    // No regex crosses a line, so a newline means the `/` was division after all.
    w.region = 'code';
    w.afterValue = false;
  }
}

/** A `}` in code: it closes the innermost open `${`, and only that one. */
function closeInterpolation(w: Walk): void {
  w.afterValue = true;
  if (w.interpolations.length === 0) return;
  w.interpolations.pop();
  w.region = 'template';
}

/** Enter a string or template region, or report that this character starts none. */
function enterLiteral(w: Walk, c: string): boolean {
  if (c !== "'" && c !== '"' && c !== '`') return false;
  w.region = c === "'" ? 'single' : c === '"' ? 'double' : 'template';
  w.afterValue = false;
  return true;
}

/**
 * A slash in code. A comment opens on `//` or a block opener; a lone slash is a regex
 * exactly where a value cannot have just ended, and division everywhere else.
 */
function readSlash(w: Walk, next: string): void {
  if (next === '/' || next === '*') {
    w.region = next === '/' ? 'line' : 'block';
    w.spanStart = w.at;
    w.spanLine = w.line;
    w.afterValue = false;
    return;
  }
  w.region = w.afterValue ? 'code' : 'regex';
  w.afterValue = false;
}

/**
 * What each bracket says about "has a value just ended": an opener means the next slash
 * cannot be division, a closer means it can. A table so `inCode` stays a reader's size.
 */
const BRACKET_ENDS_VALUE: Readonly<Record<string, boolean>> = {
  '(': false,
  '[': false,
  ')': true,
  ']': true
};

function inCode(w: Walk): void {
  const c = char(w);
  if (/[A-Za-z0-9_$]/.test(c)) {
    w.word += c;
    return;
  }
  endWord(w);
  if (enterLiteral(w, c)) return;
  if (c === '{') w.afterValue = false;
  else if (c === '}') closeInterpolation(w);
  else if (c in BRACKET_ENDS_VALUE) w.afterValue = BRACKET_ENDS_VALUE[c] ?? false;
  else if (c === '/') readSlash(w, char(w, 1));
  else if (!/\s/.test(c)) w.afterValue = false;
}

/** One handler per state. THIS TABLE IS THE STATE DIAGRAM — read the regions off it. */
const HANDLERS: Record<Region, (w: Walk) => void> = {
  code: inCode,
  single: inString,
  double: inString,
  template: inTemplate,
  regex: inRegex,
  class: inRegex,
  line: inLineComment,
  block: inBlockComment
};

/**
 * Walk `source`, report every comment, and return the region the text ENDED in.
 *
 * The return value is what makes `endsInsideLiteral` possible without a second machine: a
 * caller that truncated some text wants to know whether the survivor is complete.
 */
function walkCode(source: string, onComment: (span: CommentSpan) => void): Region {
  const w: Walk = {
    source,
    at: 0,
    line: 1,
    region: 'code',
    afterValue: false,
    word: '',
    interpolations: [],
    spanStart: 0,
    spanLine: 1,
    emit: onComment
  };
  while (w.at < source.length) {
    // Counted BEFORE dispatch, so a line comment closing on a newline reports the line
    // it was written on, not the one after it. A handler that consumes a second character
    // (an escape, a `*/`) advances `at` itself and the driver's step lands past it.
    if (source.charAt(w.at) === '\n') w.line += 1;
    HANDLERS[w.region](w);
    w.at += 1;
  }
  endWord(w);
  if (w.region === 'block' || w.region === 'line') emitSpan(w, source.length, w.line);
  return w.region;
}

/**
 * Every comment in `source`, in order.
 *
 * `text` is sliced from the original so a caller can cut at `start` and keep the code
 * that was already there — which is the operation the pruner must get exactly right.
 */
export function commentSpans(source: string): CommentSpan[] {
  const spans: CommentSpan[] = [];
  walkCode(source, (span) => spans.push(span));
  return spans;
}

/**
 * Does this code stop INSIDE something open?
 *
 * The question the comment-only proof had to learn to ask. `original.startsWith(kept)` is
 * true of EVERY truncation, so it cannot tell a revealed comment from a string cut in
 * half; a prefix that ends inside a quote, a template or a regex is a different program,
 * whatever it starts with. This is what would have refused the write that left
 * `snippet: \`` in `src/`.
 */
export function endsInsideLiteral(code: string): boolean {
  return walkCode(code, () => {}) !== 'code';
}
