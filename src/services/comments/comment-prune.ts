/**
 * Remove the comments the scan says are debt — and prove nothing else moved.
 *
 * The actuator is the dangerous half of this feature: a classifier that is 86%
 * precise only misinforms, but a pruner that is 86% precise deletes. So the
 * deliverable here is not the deletion, it is the PROOF, and the proof is a
 * structural check run on every file before it is written:
 *
 *   - the diff is computed line-by-line against the plan, so a changed line that
 *     the scan never named is a violation, not a surprise;
 *   - every removed line must be a comment line, and a stripped trailing comment
 *     must leave its code byte-identical;
 *   - a line that carries a block-comment delimiter opening or closing ELSEWHERE
 *     is never removed, because deleting it would turn the rest of the comment into
 *     code — the one failure mode that makes this a compile error rather than a
 *     lost sentence;
 *   - a file whose line endings are mixed is left alone, since re-joining it would
 *     rewrite every line and the proof would stop meaning anything.
 *
 * Anything that fails the check is reported and NOT written. The ledger records
 * every line removed, with the rule that fired, so a prune is reviewable after the
 * fact instead of only before it.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { getSessionDir } from '../session/getSessionDir.js';
import { getSessionId } from '../session/session-manager.js';
import { auditComments } from './comment-audit.js';
import { commentLines } from './comment-citations.js';
import type { CommentFinding, CommentFindingKind } from './comment-hygiene.js';
import { actionsByFile, executePlan, readFileSafe, splitLines } from './prune-apply.js';

/** What the pruner will do to one line. */
export type PruneAction = {
  readonly file: string;
  readonly line: number;
  readonly kind: CommentFindingKind;
  readonly matched: string;
  /** `drop-line` deletes the whole comment line; `strip-trailing` keeps the code. */
  readonly mode: 'drop-line' | 'strip-trailing';
  /** The full text of the line as it sits on disk right now. */
  readonly lineText: string;
  /** The comment as the SCAN saw it — for a trailing comment, not the whole line. */
  readonly comment: string;
};

/** A finding the pruner refused to act on, with the reason. */
export type PruneSkip = {
  readonly file: string;
  readonly line: number;
  readonly reason: string;
  readonly text: string;
};

export type PruneOptions = {
  readonly projectRoot: string;
  /** Narrow to one category; the default is both, which is the accepted boundary. */
  readonly kinds?: readonly CommentFindingKind[];
  /** Restrict to one file, repo-relative — how a single-case proof is run. */
  readonly onlyFile?: string;
  /** Write the files. False (the default) plans and proves without touching disk. */
  readonly apply?: boolean;
};

export type PruneResult = {
  readonly scannedFiles: number;
  readonly planned: number;
  readonly dropped: number;
  readonly stripped: number;
  readonly skipped: number;
  readonly touchedFiles: readonly string[];
  readonly notWritten: readonly string[];
  readonly ledgerPath: string;
  readonly actions: readonly PruneAction[];
  readonly skips: readonly PruneSkip[];
  readonly applied: boolean;
};

const FULL_LINE_PREFIXES = ['//', '/*', '/**', '*'] as const;

function isFullLineComment(text: string): boolean {
  const trimmed = text.trim();
  return FULL_LINE_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

/**
 * Can this line be deleted without breaking the syntax around it?
 *
 * A line that OPENS a block (`/* …` with no close on the same line) or CLOSES one
 * (a bare `* /`) is load-bearing for the comment's extent, not for its prose.
 * Removing it leaves the remainder of the block as code — a compile error is the
 * mildest thing that follows. Checked for both modes, because the strip below also
 * cuts text out of a line: a code line carrying an unterminated `/*` would have its
 * "trailing comment" extracted from inside the block, and cutting there is a syntax
 * edit, not a comment edit.
 */
function removalWouldBreakTheComment(text: string): boolean {
  const opens = text.includes('/*');
  const closes = text.includes('*/');
  return opens !== closes;
}

function actionFor(finding: CommentFinding, text: string, comment: string): PruneAction {
  return {
    file: finding.file,
    line: finding.line,
    kind: finding.kind,
    matched: finding.matched,
    mode: isFullLineComment(text) ? 'drop-line' : 'strip-trailing',
    lineText: text,
    comment
  };
}

function skipFor(finding: CommentFinding, reason: string): PruneSkip {
  return { file: finding.file, line: finding.line, reason, text: finding.text };
}

/**
 * Decide the fate of every finding.
 *
 * The line is re-read here and passed back through `commentLines`, the scan's own
 * extractor, rather than compared against the whole line: a trailing comment's
 * recorded text is the comment, not the code before it, and an equality test on the
 * raw line would reject every one of them. Re-using the extractor is what makes the
 * plan and the scan agree BY CONSTRUCTION instead of by two copies of a rule — the
 * defect class this whole feature is a reply to.
 */
export function planPrune(
  options: PruneOptions,
  findings: readonly CommentFinding[]
): { actions: PruneAction[]; skips: PruneSkip[] } {
  const actions: PruneAction[] = [];
  const skips: PruneSkip[] = [];
  // One extractor run per FILE, keyed by path. `commentLines` is contextual now — it has
  // not a comment at all — so asking it about a single line would skip every one of those
  // findings. The old code could get away with it because the line-local heuristic agreed
  // with itself by construction, which is not the same as being right.
  const byFile = new Map<string, { lines: string[]; comments: Map<number, string> }>();
  const viewFor = (file: string): { lines: string[]; comments: Map<number, string> } | null => {
    const known = byFile.get(file);
    if (known !== undefined) return known;
    const source = readFileSafe(options.projectRoot, file);
    if (source === null) return null;
    const split = splitLines(source);
    const comments = new Map<number, string>();
    for (const entry of commentLines(source)) comments.set(entry.line, entry.text);
    const view = { lines: split.lines, comments };
    byFile.set(file, view);
    return view;
  };

  for (const finding of findings) {
    const view = viewFor(finding.file);
    if (view === null) {
      skips.push(skipFor(finding, 'file-not-readable'));
      continue;
    }
    const text = view.lines[finding.line - 1] ?? '';
    const comment = view.comments.get(finding.line) ?? '';
    if (comment.trim() !== finding.text) {
      skips.push(skipFor(finding, 'line-moved-since-scan'));
      continue;
    }
    if (removalWouldBreakTheComment(text)) {
      skips.push(skipFor(finding, 'carries-a-block-delimiter'));
      continue;
    }
    actions.push(actionFor(finding, text, comment));
  }
  return { actions, skips };
}

function ledgerPathFor(projectRoot: string, stamp: string): string {
  const sessionId = getSessionId(projectRoot) ?? '_nonsession';
  const dir = join(getSessionDir(projectRoot, sessionId), 'comments');
  mkdirSync(dir, { recursive: true });
  return join(dir, `prune-${stamp}.json`);
}

/**
 * Plan, prove, and (on `apply`) write.
 *
 * The scan runs through `auditComments`, so a pruned line is one the worklist
 * already showed a human; the pruner adds no rule of its own about what counts as
 * debt.
 */
export function pruneComments(options: PruneOptions): PruneResult {
  const kinds = options.kinds ?? ['dead-reference', 'narrative'];
  const audit = auditComments({ projectRoot: options.projectRoot });
  const inScope = audit.findings.filter(
    (finding) =>
      kinds.includes(finding.kind) &&
      (options.onlyFile === undefined || finding.file === options.onlyFile)
  );
  const { actions, skips } = planPrune(options, inScope);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const ledgerPath = ledgerPathFor(options.projectRoot, stamp);
  const outcome = executePlan(options.projectRoot, actionsByFile(actions), options.apply === true);
  const skipsAll = [...skips, ...outcome.fileSkips];
  // Written on a dry run too: the plan IS the reviewable artifact, and a reviewer
  // who only sees stdout has nothing to diff a later apply against.
  writeFileSync(
    ledgerPath,
    `${JSON.stringify(
      {
        projectRoot: options.projectRoot,
        at: new Date().toISOString(),
        applied: options.apply === true,
        kinds,
        onlyFile: options.onlyFile ?? null,
        removed: actions,
        skipped: skipsAll,
        touchedFiles: outcome.touched,
        notWritten: outcome.notWritten
      },
      null,
      2
    )}\n`
  );

  return {
    scannedFiles: audit.scannedFiles,
    planned: actions.length,
    dropped: actions.filter((action) => action.mode === 'drop-line').length,
    stripped: actions.filter((action) => action.mode === 'strip-trailing').length,
    skipped: skipsAll.length,
    touchedFiles: outcome.touched,
    notWritten: outcome.notWritten,
    ledgerPath,
    actions,
    skips: skipsAll,
    applied: options.apply === true
  };
}
