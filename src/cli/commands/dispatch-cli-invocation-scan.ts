/**
 * The `peaks …` runs a dispatch prompt carries, cut out of prose.
 *
 * Extraction only: it finds the runs, keeps the quotation boundaries that make a
 * quoted command quoted, and hands back tokens. It knows nothing about which
 * commands exist — that half lives in `./dispatch-cli-invocation-check.ts`. The
 * split is the repository's file-cap rule rather than a design statement.
 *
 * THE RUN BOUNDARY. A run ends at the backtick that closed its quotation, or at
 * a line break no continuation follows. Both ends matter: without the backtick
 * the sentence after a quoted command would be read as its arguments, and
 * without the continuation rule a wrapped invocation is read only to its first
 * line — a FALSE NEGATIVE that still reports clean, measured on the real corpus
 * text `peaks workflow verify-pipeline --rid <rid>` wrapping onto
 * `--project <root> --type <type>`.
 *
 * THE CASE IS DELIBERATE. Matching is case-sensitive, and the decision is
 * measured: the corpus carries 51 lines using `Peaks` as this project's own name
 * in prose (`… bypassed Peaks worktree governance`, `the active Peaks skill`) and
 * NOT ONE of them is an invocation. Matching them case-insensitively would add 51
 * findings — 47 that happen to resolve onto a command word and read clean, and 4
 * that resolve onto nothing and would warn — every one of them on prose.
 *
 * COST IS BOUNDED IN TWO PLACES, both put there by a measurement on
 * caller-supplied text, and both recorded on the functions that carry them.
 *
 * CITATIONS. This file names the SHAPE of a corpus record rather than the record;
 * the tests name the record in full. That is not tidiness, it is a collision
 * between two of this campaign's own rules, and it has now bitten twice in one
 * night on two different slices. The rule that a red-direction case be built from
 * the REAL input makes a source comment want to cite the record it came from, and
 * real records are named with a request-id prefix — the very substring the
 * comment-hygiene marker for a request id matches. So the citation that gives a
 * reader the evidence is the line that raises a ceiling. Putting it in the test
 * file resolves it in the right direction: `tests/**` is outside the
 * comment-hygiene scope, the case is built from that record anyway, and the
 * source keeps the shape. A wording bent around the detector would have lowered
 * the ceiling by making the guard unable to see the case that raised it.
 */

/** The word an invocation starts with. `peaks-loop` cannot match: the run must follow a space. */
const CLI_START = /\bpeaks\b[ \t]+/g;

/** Ends a run: the backtick that closed the quotation, or a line break nothing continues. */
const RUN_END = new Set(['`', '\n', '\r']);

/**
 * How much of a run is read, in characters.
 *
 * Without it a prompt carrying many invocations on one long line makes the scan
 * quadratic, because a run ends only at a delimiter: the 1772 runs in the corpus
 * never exceed 167 characters (mean 36.4), but a synthetic 123 KB prompt with
 * 5024 invocations on a single line took 7.2 seconds and an 800 KB one exhausted
 * a 4 GB heap. Its cost is stated rather than hidden: a run longer than this is
 * read only to the bound, so a flag spelled past it is not seen.
 */
export const PROMPT_CLI_RUN_LIMIT = 512;

/** Bound on the text a finding quotes back, so one long run cannot flood an envelope. */
const QUOTED_LIMIT = 200;

/** Punctuation that ends a sentence rather than a token, and so is not part of an option name. */
const TRAILING_PUNCTUATION = new Set(['.', ',', ';', ':', ')', ']', '}', "'", '"']);

/** One `peaks …` run found in a prompt. */
export interface PromptCliInvocation {
  /** The run with the command word restored, as the prompt spells it. */
  readonly text: string;
  /** The run's whitespace-separated tokens, each with trailing sentence punctuation trimmed. */
  readonly tokens: readonly string[];
}

/**
 * Drop the sentence punctuation a run's final token carries.
 *
 * A `…+$` regex reads better but is quadratic on a long punctuation run that
 * does not reach the end of its token: measured here, `'.'.repeat(n) + 'x'`
 * costs 0.4 ms at n=1000 and 94.8 ms at n=16000. The prompt is caller-supplied
 * text, so a crafted run would turn a dispatch into a stall. A backwards scan
 * is linear and charges nothing for the ordinary case.
 */
function trimTrailingPunctuation(token: string): string {
  let end = token.length;
  while (end > 0) {
    const last = token[end - 1];
    if (last === undefined || !TRAILING_PUNCTUATION.has(last)) break;
    end -= 1;
  }
  return token.slice(0, end);
}

/** Split a run into tokens, dropping the punctuation that ends a sentence. */
function tokenize(run: string): string[] {
  const tokens: string[] = [];
  for (const raw of run.split(/[ \t\r\n]+/)) {
    const token = trimTrailingPunctuation(raw);
    if (token.length > 0) tokens.push(token);
  }
  return tokens;
}

function shorten(text: string): string {
  return text.length <= QUOTED_LIMIT ? text : `${text.slice(0, QUOTED_LIMIT)}…`;
}

/**
 * True when the line beginning at `at` continues the invocation above it.
 *
 * A wrapped invocation puts the rest of its flags on the next line opening with
 * a long option. The corpus carries that shape — a `workflow verify-pipeline`
 * run whose `--project` and `--type` sit on the following line — and without this
 * rule every flag after the break goes unchecked while the invocation still
 * reports CLEAN. The case that pins it,
 * `tests/unit/cli/commands/dispatch-cli-invocation-scan.test.ts`, quotes the
 * record it was taken from; this comment does not, on purpose: see the note on
 * citations below the exports.
 *
 * Requiring two dashes is what separates a continuation from a markdown bullet,
 * which opens with one, so a prose list under a command is still not read as its
 * arguments.
 */
function continuesAfterBreak(text: string, at: number): boolean {
  let index = at;
  while (index < text.length) {
    const character = text[index];
    if (character !== '\n' && character !== '\r' && character !== ' ' && character !== '\t') break;
    index += 1;
  }
  return text.startsWith('--', index) && /[A-Za-z]/.test(text[index + 2] ?? '');
}

/**
 * Where the run starting at `from` ends.
 *
 * The scan stops at {@link PROMPT_CLI_RUN_LIMIT} characters, and that bound is
 * what makes it linear. Scanning to the next line break instead costs a walk to
 * the END OF THE TEXT per match, so a prompt of many short lines is quadratic in
 * the number of lines: measured on that shape, `'peaks test --json\n'.repeat(n)`
 * took 2.7 ms at 2000 lines / 35 KB, 26.4 ms at 8000, 101.0 ms at 16000 / 281 KB,
 * 493 ms at 32000, and 109.9 s at 200000 / 3.5 MB — synchronously, inside
 * `composeDispatchPrompt`, on caller-supplied text.
 */
function runEnd(text: string, from: number): number {
  const limit = Math.min(text.length, from + PROMPT_CLI_RUN_LIMIT);
  let index = from;
  while (index < limit) {
    const character = text[index];
    if (character === undefined) break;
    if (RUN_END.has(character) && !continuesAfterBreak(text, index)) return index;
    index += 1;
  }
  return limit;
}

/**
 * Every invocation of this CLI that `text` carries, in the order it carries them.
 *
 * A run end already found is reused by every later match inside it, because the
 * first delimiter after a later start is the same one. That reuse is the second
 * half of the cost bound: measured, 50024 invocations on one 958 KB line took
 * 4216 ms without it and 53 ms with it.
 */
export function extractPromptCliInvocations(text: string): PromptCliInvocation[] {
  const invocations: PromptCliInvocation[] = [];
  let runEndsAt = -1;
  for (const match of text.matchAll(CLI_START)) {
    const start = (match.index ?? 0) + match[0].length;
    if (start >= runEndsAt) runEndsAt = runEnd(text, start);
    const run = text.slice(start, runEndsAt);
    const tokens = tokenize(run);
    if (tokens.length > 0) invocations.push({ text: shorten(`peaks ${run.trim()}`), tokens });
  }
  return invocations;
}
