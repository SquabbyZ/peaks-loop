/**
 * The line mechanics of a comment prune, and the proof that gates every write.
 *
 * Split from `comment-prune.ts` because the two change for different reasons: that
 * module decides WHAT is debt (and follows the classifier), this one decides how a
 * line is removed from a file without damaging the file (and follows the language).
 * Keeping them apart is also what lets the proof be tested on a text array, with no
 * filesystem and no scan in the room.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { PruneAction, PruneSkip } from './comment-prune.js';
import { endsInsideLiteral } from './comment-spans.js';

/** What the write phase decided, per file. */
export type WriteOutcome = {
  touched: string[];
  notWritten: string[];
  fileSkips: PruneSkip[];
};

/**
 * Read a file, or report that it is not there — a prune never creates one.
 *
 * `existsSync` first, and NO catch: a `catch { return null }` answers "present but
 * unreadable" (permissions, a locked handle, a directory named as a file) with the same
 * `null` as "absent", and that conflation is the defect this repository already
 * ratchets under `silentWarningCatchReturnNull` — this very helper was counted by it.
 * An absent path is a state the caller handles; an unreadable one should be a crash an
 * operator sees.
 */
export function readFileSafe(root: string, rel: string): string | null {
  const abs = join(root, rel);
  return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
}

/**
 * Split a source into lines, remembering what separated them.
 *
 * `mixed` is the signal to leave a file alone rather than a detail to paper over: a
 * file with both CRLF and LF endings cannot be re-joined from one delimiter without
 * rewriting every line, and a rewrite of every line is not a comment edit — it would
 * also make the proof below vacuous, because all the lines would differ.
 */
export function splitLines(source: string): { lines: string[]; eol: string; mixed: boolean } {
  const crlf = source.includes('\r\n');
  const lfOnly = /\n(?!\r)/.test(source.replace(/\r\n/g, '\n')) || /\n[^\r]/.test(source);
  return {
    lines: source.split(/\r?\n/),
    eol: crlf ? '\r\n' : '\n',
    mixed: crlf && lfOnly
  };
}

/** Group a plan by file, in first-seen order. */
export function actionsByFile(actions: readonly PruneAction[]): Map<string, PruneAction[]> {
  const byFile = new Map<string, PruneAction[]>();
  for (const action of actions) {
    const list = byFile.get(action.file);
    if (list === undefined) byFile.set(action.file, [action]);
    else list.push(action);
  }
  return byFile;
}

/**
 * The proof, as data: compare kept lines against the original.
 *
 * One string per violation; empty means every difference between the two texts is a
 * line this plan named, and every line it named that was kept is byte-identical to
 * what was there before. This is computed whether or not the caller intends to write,
 * so a dry run reports the refusals a real run would hit.
 */
export function proofViolations(
  before: readonly string[],
  after: readonly string[],
  actions: readonly PruneAction[]
): string[] {
  const dropped = new Set(actions.filter((a) => a.mode === 'drop-line').map((a) => a.line));
  // The blanks the drops orphan are removed on purpose too — the SAME function the writer
  // uses decides, so the proof can never be persuaded to allow more than the writer does.
  const removed = new Set(dropped);
  for (const blank of orphanedBlanks(before, dropped)) removed.add(blank);
  const stripped = new Set(actions.filter((a) => a.mode === 'strip-trailing').map((a) => a.line));
  const violations: string[] = [];
  let afterAt = 0;
  before.forEach((original, index) => {
    const line = index + 1;
    if (removed.has(line)) return; // deleted on purpose
    if (stripped.has(line)) {
      // The only thing a strip may do is reveal the code that was already there, so
      // what survives must be a PREFIX of the original line — that is what makes it a
      // comment edit, and anything else is a code edit wearing its clothes.
      const kept = after[afterAt] ?? '';
      afterAt += 1;
      if (!original.startsWith(kept)) violations.push(`line ${line}: code text changed`);
      // The prefix test above is true of EVERY truncation, which is how a strip that
      // cut a template literal in half passed it. `startsWith` says nothing about
      // whether what survives is still complete code, so that is asked separately.
      // refused the write that left `snippet: \`` in `src/`.)
      else if (endsInsideLiteral(kept)) {
        violations.push(`line ${line}: strip left an unterminated literal — the code changed`);
      }
      return;
    }
    if (after[afterAt] !== original) violations.push(`line ${line}: untouched line differs`);
    afterAt += 1;
  });
  if (afterAt !== after.length) violations.push(`produced ${after.length - afterAt} extra line(s)`);
  return violations;
}

/**
 * The blank lines a set of drops ORPHANS.
 *
 * A comment standing alone between two blanks is the only thing separating two blocks:
 *
 *     }
 *                    ← blank
 *     // M-… internal: AC-1 markdown parse   ← the dropped line
 *                    ← blank
 *     type AuditEnvelopeGuard<T> = …
 *
 * Deleting the comment joins the two blanks into a double blank, which is not what the
 * file said before and not what any formatter will keep. So the drop owns that blank line
 * — it is the residue of a comment removal, not an edit of someone's whitespace. Only a
 * blank that becomes adjacent to another blank THROUGH a drop is claimed here: a double
 * blank the repository already carries is left exactly where it is, because the pruner did
 * not make it and has no business "fixing" it.
 *
 * ONE HELPER, BOTH CALLERS: `pruneFileLines` removes these and `proofViolations` allows
 * them. A second copy of this rule is the defect class this whole feature answers, so the
 * writer and the checker ask the same function the same question.
 */
export function orphanedBlanks(
  before: readonly string[],
  dropped: ReadonlySet<number>
): Set<number> {
  const orphaned = new Set<number>();
  let lastKept = 0; // 1-based line number of the last line that survived
  for (let index = 0; index < before.length; index += 1) {
    const line = index + 1;
    if (dropped.has(line)) continue;
    const isBlank = (before[index] ?? '').trim() === '';
    if (isBlank && lastKept > 0 && (before[lastKept - 1] ?? '').trim() === '') {
      // Every original line between the two blanks was dropped, or this blank is the
      // join the drop created. Anything else was a double blank before this run began.
      // A blank is claimed ONLY when a drop actually sits between it and the previous
      // surviving blank: `between` must be non-empty, because `[].every(…)` is true and
      // an empty gap is a double blank the repository already had — which this run did
      // not make and has no business touching.
      const between = range(lastKept + 1, line - 1);
      if (between.length > 0 && between.every((n) => dropped.has(n))) orphaned.add(line);
    }
    lastKept = line;
  }
  return orphaned;
}

/** Inclusive integer range, empty when `from > to`. */
function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let n = from; n <= to; n += 1) out.push(n);
  return out;
}

/** Apply one file's actions to its lines, in the plan's own terms. */
export function pruneFileLines(
  lines: readonly string[],
  actions: readonly PruneAction[]
): string[] {
  const drop = new Set(actions.filter((a) => a.mode === 'drop-line').map((a) => a.line));
  const gone = new Set(drop);
  for (const blank of orphanedBlanks(lines, drop)) gone.add(blank);
  const strip = new Map(
    actions.filter((a) => a.mode === 'strip-trailing').map((a) => [a.line, a.comment])
  );
  const out: string[] = [];
  lines.forEach((original, index) => {
    const line = index + 1;
    if (gone.has(line)) return;
    if (strip.has(line)) {
      // Cut where the scan's comment text starts, not at the first `//` in the line:
      // `const url = "https://example.com"; // Slice 1 kept it` has its `//` inside a
      // string literal, and slicing there would delete code.
      const comment = strip.get(line) ?? '';
      const at = original.indexOf(comment);
      out.push(at > 0 ? original.slice(0, at).trimEnd() : comment.trimEnd());
      return;
    }
    out.push(original);
  });
  return out;
}

/**
 * Run the proof on every planned file, and write only the files that passed it.
 *
 * A file that fails is reported and left alone — never written "mostly", because a
 * partially-pruned file is exactly the state the proof exists to make unreachable.
 */
export function executePlan(
  projectRoot: string,
  byFile: Map<string, PruneAction[]>,
  apply: boolean
): WriteOutcome {
  const touched: string[] = [];
  const notWritten: string[] = [];
  const fileSkips: PruneSkip[] = [];
  for (const [file, fileActions] of byFile) {
    const source = readFileSafe(projectRoot, file);
    if (source === null) {
      notWritten.push(file);
      continue;
    }
    const parts = splitLines(source);
    if (parts.mixed) {
      fileSkips.push({
        file,
        line: 0,
        reason: 'mixed-line-endings',
        text: `${parts.lines.length} line(s) left untouched`
      });
      notWritten.push(file);
      continue;
    }
    const after = pruneFileLines(parts.lines, fileActions);
    const violations = proofViolations(parts.lines, after, fileActions);
    if (violations.length > 0) {
      notWritten.push(`${file} (${violations[0]})`);
      continue;
    }
    touched.push(file);
    if (apply) writeFileSync(join(projectRoot, file), after.join(parts.eol));
  }
  return { touched, notWritten, fileSkips };
}
