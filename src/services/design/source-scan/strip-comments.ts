/**
 * Comment stripping for the G1 source scanner.
 *
 * A symptom written in a comment must never fail a file, so every scan view
 * removes comment text first. The replacement is space-for-character (except
 * newlines), which keeps every index and line number identical to the
 * original source.
 *
 * `blankStrings` additionally blanks string-literal bodies. It is used for
 * the checks that judge *code* shapes (an inline style attribute, a raw
 * element), so a sentence that merely contains `style={{` inside a string
 * does not fire. Checks that read attribute values or import specifiers use
 * the comment-only view instead.
 */

export type StripCommentsOptions = {
  /** Replace string-literal bodies with spaces as well as comments. */
  blankStrings?: boolean;
};

type QuoteState = 'single' | 'double' | 'template';
type State = 'code' | 'line-comment' | 'block-comment' | QuoteState;

type Cursor = {
  index: number;
  state: State;
};

type ScanContext = {
  source: string;
  output: string[];
  cursor: Cursor;
  blankStrings: boolean;
};

const CLOSING_QUOTE: Record<QuoteState, string> = {
  single: "'",
  double: '"',
  template: '`'
};

function blankChar(output: string[], index: number): void {
  const char = output[index];
  if (char !== undefined && char !== '\n' && char !== '\r') output[index] = ' ';
}

function isQuoteState(state: State): state is QuoteState {
  return state === 'single' || state === 'double' || state === 'template';
}

function quoteStateFor(char: string | undefined): QuoteState | null {
  if (char === "'") return 'single';
  if (char === '"') return 'double';
  if (char === '`') return 'template';
  return null;
}

function walkLineComment(context: ScanContext): void {
  if (context.source[context.cursor.index] === '\n') context.cursor.state = 'code';
  else blankChar(context.output, context.cursor.index);
}

function walkBlockComment(context: ScanContext): void {
  const { source, output, cursor } = context;
  const closes = source[cursor.index] === '*' && source[cursor.index + 1] === '/';
  blankChar(output, cursor.index);
  if (!closes) return;
  blankChar(output, cursor.index + 1);
  cursor.index += 1;
  cursor.state = 'code';
}

function blankEscape(context: ScanContext): void {
  if (context.blankStrings) {
    blankChar(context.output, context.cursor.index);
    blankChar(context.output, context.cursor.index + 1);
  }
  context.cursor.index += 1;
}

function walkString(context: ScanContext): void {
  const { cursor } = context;
  if (!isQuoteState(cursor.state)) return;
  const char = context.source[cursor.index];
  const plain = cursor.state === 'single' || cursor.state === 'double';
  if (plain && (char === '\n' || char === '\r')) {
    cursor.state = 'code';
    return;
  }
  if (char === '\\') {
    blankEscape(context);
    return;
  }
  if (char === CLOSING_QUOTE[cursor.state]) {
    if (context.blankStrings) blankChar(context.output, cursor.index);
    cursor.state = 'code';
    return;
  }
  if (context.blankStrings) blankChar(context.output, cursor.index);
}

function startComment(context: ScanContext): boolean {
  const { source, output, cursor } = context;
  if (source[cursor.index] !== '/') return false;
  const next = source[cursor.index + 1];
  if (next !== '/' && next !== '*') return false;
  blankChar(output, cursor.index);
  blankChar(output, cursor.index + 1);
  cursor.index += 1;
  cursor.state = next === '/' ? 'line-comment' : 'block-comment';
  return true;
}

function startString(context: ScanContext): void {
  const quote = quoteStateFor(context.source[context.cursor.index]);
  if (quote === null) return;
  context.cursor.state = quote;
  if (context.blankStrings) blankChar(context.output, context.cursor.index);
}

function walkCode(context: ScanContext): void {
  if (startComment(context)) return;
  startString(context);
}

export function stripComments(source: string, options: StripCommentsOptions = {}): string {
  const context: ScanContext = {
    source,
    output: [...source],
    cursor: { index: 0, state: 'code' },
    blankStrings: options.blankStrings === true
  };

  while (context.cursor.index < source.length) {
    const { state } = context.cursor;
    if (state === 'line-comment') walkLineComment(context);
    else if (state === 'block-comment') walkBlockComment(context);
    else if (isQuoteState(state)) walkString(context);
    else walkCode(context);
    context.cursor.index += 1;
  }

  return context.output.join('');
}
