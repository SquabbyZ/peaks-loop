// src/services/scan/file-size-baseline.ts
//
// The git side of the diff-scoped file-size scan: WHICH files changed against a
// base ref, and HOW BIG each was at that ref. Together they make the scan a
// RATCHET — a file that is over its cap but no larger than its own state at that
// ref is accepted, and only growth past the cap is refused. Same rule as the
// commit gate's "a file you touch may not be WORSE than it was"
// (`.husky/peaks-gate.mjs`).
//
// FAIL-CLOSED ON BOTH GIT READS. The enumeration and the size probe both name
// their failure instead of swallowing it: a ratchet whose input list can
// silently become empty is not a ratchet, and `catch { return [] }` cannot tell
// "git refused to enumerate" from "nothing changed".
//
// RENAMES ARE JUDGED, NOT DROPPED. A rename is enumerated as `R` and compared
// against the OLD path's size at `baseRef`, so a pure rename passes and a
// rename that grows is refused naming the growth. The `--diff-filter=AM`
// spelling this replaced excluded `R` by accident — a file could grow past its
// cap and stay invisible to the scan simply by being renamed in the same
// commit.
//
// KNOWN, RECORDED, NOT FIXED — a DELETION is invisible: `D` entries are dropped
// before the measurement, and that is left as it is because a deletion cannot
// grow. It is a documentation matter, not a hole in the ratchet.
//
// KNOWN, RECORDED, NOT FIXED — subprocess cost is `2 + 2K` git spawns, where K
// is the changed files that are OVER their cap (one `cat-file -e` plus one
// `show` each, inside the scan's `lines > cap` branch; the 2 are the
// enumerations above). It is linear in OVER-CAP changed files, not in changed
// files: 10 changed with 0 over spawns 2, with 2 over spawns 6, with 5 over
// spawns 12; 40 changed with 3 over spawns 8 and with 40 over spawns 82. At
// roughly 58 ms per process on the measured host that is 0.8 s at K=5 and 4.7 s
// at K=40, paid once per slice on a human-run command with two call sites.
// Batching every baseline read through one `git cat-file --batch` on stdin is
// the known fix if the many-over-cap case ever becomes real; it is not
// warranted at these numbers.
//
// Split out of `file-size-scan.ts`. That file was 237 raw lines at the split
// (not "at its cap"): the point is that this logic did not fit under 300 there,
// and the scan now depends on this module rather than on a hand-rolled list.
// This module's own name matches the `file-size` pattern the walk-based
// policy-wiring rule (`policyWiringFindings` in
// `tests/unit/standards/_file-size-cap-scan.ts`, asserted by
// `tests/unit/standards/file-size-cap.test.ts`) requires to import
// `file-size-policy.ts`; that test's literal fixtures name `file-size-scan.ts`,
// not this file.

import { execFileSync, spawnSync } from 'node:child_process';

import { countRawLines } from './file-size-policy.js';

/** A git read the scan needs could not be completed. Thrown, never returned:
 *  the alternative is an empty file list that reads as "nothing changed". */
export class GitReadFailedError extends Error {
  readonly code = 'FILE_SIZE_GIT_READ_FAILED';
  constructor(what: string, projectRoot: string, detail: string) {
    super(
      `File-size scan refused: ${what} could not be read from git in ${projectRoot} ` +
        `(${detail}). A git failure is not "nothing changed"; fix the ref/path, or pass ` +
        'a `baseRef` that resolves.'
    );
    this.name = 'GitReadFailedError';
  }
}

export type ChangedFiles = {
  /** Paths to measure in the working tree: Added/Modified entries plus rename
   *  targets. Deletions are omitted — they have no body to measure. */
  paths: string[];
  /** The path `file`'s baseline size must be read from: itself, or the name it
   *  had at `baseRef` before a rename. */
  baselinePathFor(file: string): string;
};

function gitLines(projectRoot: string, args: readonly string[]): string[] {
  let raw: string;
  try {
    raw = execFileSync('git', ['-C', projectRoot, ...args], {
      encoding: 'utf8',
      windowsHide: true
    });
  } catch (error) {
    const detail = error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error);
    throw new GitReadFailedError(`\`git ${args.join(' ')}\``, projectRoot, detail);
  }
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * The changed-file population the scan measures, as `git diff --name-status`
 * reports it. `A`/`M` keep their path; `R`/`C` keep the TARGET path and record
 * the source, so the rename is judged against the size the file had before it
 * moved; `D` is dropped. A git failure here THROWS rather than returning `[]`.
 */
export function readChangedFiles(projectRoot: string, baseRef: string): ChangedFiles {
  const paths: string[] = [];
  const renameSources = new Map<string, string>();
  for (const line of gitLines(projectRoot, ['diff', '--name-status', baseRef])) {
    const [status, first, second] = line.split('\t');
    if (status === undefined || first === undefined) continue;
    if ((status.startsWith('R') || status.startsWith('C')) && second !== undefined) {
      paths.push(second);
      renameSources.set(second, first);
    } else if (status.startsWith('A') || status.startsWith('M')) {
      paths.push(first);
    }
  }
  const untracked = gitLines(projectRoot, ['ls-files', '--others', '--exclude-standard']);
  const allPaths = Array.from(new Set([...paths, ...untracked]));
  return { paths: allPaths, baselinePathFor: (file: string) => renameSources.get(file) ?? file };
}

/**
 * Whether `git cat-file -e` could resolve `<baseRef>:<file>`, i.e. whether the
 * probe EXITED ZERO. What a non-zero exit actually measures is wider than "the
 * ref has no such path": a bad or unreadable ref (a misspelled name, or `HEAD~1`
 * on a root commit) and any other git failure exit non-zero too and are read
 * identically. That conflation is fail-closed — no baseline means
 * `previousLines: null`, which the scan reads as "created over the cap" and
 * refuses. Stated so the next reader does not take the narrow reading.
 */
function pathExistsAtRef(projectRoot: string, baseRef: string, file: string): boolean {
  const probe = spawnSync('git', ['-C', projectRoot, 'cat-file', '-e', `${baseRef}:${file}`], {
    stdio: 'ignore',
    windowsHide: true
  });
  return probe.status === 0;
}

/** The file's raw-line count AT `baseRef`, or `null` when the ref has no such
 *  path — i.e. the change ADDED the file and it is over the cap by creation. */
export function readBaseLineCount(
  projectRoot: string,
  baseRef: string,
  file: string
): number | null {
  if (!pathExistsAtRef(projectRoot, baseRef, file)) {
    return null;
  }
  return countRawLines(
    execFileSync('git', ['-C', projectRoot, 'show', `${baseRef}:${file}`], {
      encoding: 'utf8',
      windowsHide: true
    })
  );
}
