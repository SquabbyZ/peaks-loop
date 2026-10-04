/**
 * The comment-hygiene detector — the tool the gate leg and the ceiling generator run.
 *
 * WHY A SCRIPT AND NOT THE GATE ITSELF. `.husky/**` is plain `.mjs` and cannot import
 * the `.ts` classifier, so this file (run through tsx, exactly like
 * `scripts/lint/file-size-census.ts` runs the size policy) is the ONE thing that
 * reaches the shipped rules. The gate therefore measures with the same classifier the
 * `peaks comments audit` command prints, and a rule change in `src/` moves the row
 * instead of quietly desynchronising the two.
 *
 * WHY THE FILE LIST IS HANDED IN. A walk is not a scope (rid
 * `2026-10-03-silent-warning-scope`): a filesystem walk sees untracked files the index
 * never heard of and misses tracked files the disk dropped, so a row measured over a
 * walk can move while nobody edits source. Every run passes explicit paths — the same
 * enforced-scope list the eslint, prettier and silent-warning legs share — and the
 * envelope reports both `scannedFiles` and `askedFiles`, so the leg can refuse when the
 * two differ instead of printing a number over a population nobody agreed to.
 *
 * A RUN WITH NO FILES IS A REFUSAL (exit 2), not a zero: 0 is what a clean repository
 * looks like, and telling "nothing was measured" apart from "measured, nothing found"
 * is the entire reason the row exists. When the scan DOES run the exit code is 0 even
 * with findings, because this repository carries comment debt today and a tool that
 * exited 1 for measuring it would make the gate read a successful run as a failure.
 */

import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { auditComments } from '../../src/services/comments/comment-audit.js';

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

/** A caller's path, made repo-relative and POSIX, as every other leg's list is. */
function toRepoRelative(path: string): string {
  const posix = path.replace(/\\/g, '/').replace(/^([A-Za-z]:)?\/+/, '');
  const rel = relative(REPO_ROOT, resolve(REPO_ROOT, posix)).replace(/\\/g, '/');
  return rel === '' || rel.startsWith('..') ? posix : rel;
}

function main(): number {
  const paths = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  if (paths.length === 0) {
    process.stderr.write(
      'comment-hygiene-detector: pass the files to scan. A run with no files measured ' +
        'nothing, and that is not the same statement as "no findings".\n'
    );
    return 2;
  }
  const files = paths.map(toRepoRelative);
  const result = auditComments({ projectRoot: REPO_ROOT, files });
  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: 1,
        scopeSource: 'explicit paths (caller-supplied)',
        scannedFiles: result.scannedFiles,
        askedFiles: result.askedFiles,
        commentLines: result.commentLines,
        deadReferences: result.deadReferences,
        narrative: result.narrative
      },
      null,
      2
    )}\n`
  );
  return 0;
}

process.exitCode = main();
