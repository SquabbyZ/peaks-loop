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

import { countRawLines, normalizePolicyPath } from './file-size-policy.js';

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

function gitNul(projectRoot: string, args: readonly string[]): string[] {
  let raw: Buffer;
  try {
    raw = execFileSync('git', ['-C', projectRoot, ...args], {
      windowsHide: true
    });
  } catch (error) {
    const detail = error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error);
    throw new GitReadFailedError(`\`git ${args.join(' ')}\``, projectRoot, detail);
  }
  // `-z` suppresses C-quoting (core.quotePath), so a non-ASCII name arrives as
  // the real path rather than `"src/\303\251.ts"`; NUL is the only separator.
  return raw
    .toString('utf8')
    .split('\0')
    .filter((entry) => entry.length > 0);
}

/**
 * One git enumeration for both readers that need the change set: the declared-
 * type rule judges `changedPaths` (deletions included), and the size scan
 * measures `changedFiles` (the A/M/R/untracked subset). Two spawns total,
 * `git diff` + `git ls-files`, never one pair per reader.
 */
export type GitChangeSet = {
  changedPaths: string[];
  changedFiles: ChangedFiles;
};

/**
 * The caller's list, intersected with what git reports — or the whole change set when
 * the caller named none. Compared in the policy's POSIX spelling, because a
 * Windows-native caller path and a git-reported one spell the same file differently.
 *
 * INTERSECTION, NOT POPULATION. The commit hook is handed the STAGED paths by
 * lint-staged, so it knows its set and the set is narrower than the working tree: a
 * modification nobody staged is not part of that commit, and measuring it would block
 * the commit over a file it was never asked about. A named path git does not report as
 * changed is therefore skipped, never measured — this narrows; it cannot widen.
 */
function restrictedTo(all: readonly string[], only: readonly string[] | undefined): string[] {
  if (only === undefined) return [...all];
  const wanted = new Set(only.map(normalizePolicyPath));
  return all.filter((file) => wanted.has(normalizePolicyPath(file)));
}

/**
 * The whole change set, read ONCE. `--relative` makes the `diff` arm emit paths
 * relative to `projectRoot` (the `ls-files` arm already does), so a project root
 * nested inside a larger repository is judged by the same prefix rule; without
 * it, a tracked `apps/web/src/x.ts` arrived root-relative and escaped a `src/`
 * test. `R`/`C` keep the TARGET path and record the source; a RENAME also
 * contributes its source, so moving a file out of a source tree is still seen.
 * `D` is kept in `changedPaths` and dropped from `changedFiles`.
 *
 * `only` restricts the measured subset (see `restrictedTo`); `changedPaths`
 * stays the full set the type rule needs.
 */
type ChangeAccumulator = {
  changedPaths: string[];
  measurable: string[];
  renameSources: Map<string, string>;
};

/** One `--name-status -z` entry into the accumulator. Extracted because the
 *  inline form pushed `readGitChangeSet` past the complexity cap. */
function appendEntry(
  status: string,
  fields: readonly (string | undefined)[],
  acc: ChangeAccumulator
): void {
  if (status.startsWith('R') || status.startsWith('C')) {
    const from = fields[0];
    const to = fields[1];
    if (from === undefined || to === undefined) return;
    acc.changedPaths.push(...(status.startsWith('R') ? [from] : []), to);
    acc.measurable.push(to);
    acc.renameSources.set(to, from);
    return;
  }
  const path = fields[0];
  if (path === undefined) return;
  acc.changedPaths.push(path);
  if (status.startsWith('A') || status.startsWith('M')) acc.measurable.push(path);
}

export function readGitChangeSet(
  projectRoot: string,
  baseRef: string,
  only?: readonly string[]
): GitChangeSet {
  const acc: ChangeAccumulator = { changedPaths: [], measurable: [], renameSources: new Map() };
  const tokens = gitNul(projectRoot, [
    'diff',
    '--name-status',
    '--relative',
    '-z',
    '--end-of-options',
    baseRef
  ]);
  for (let i = 0; i < tokens.length;) {
    const status = tokens[i++] ?? '';
    const count = status.startsWith('R') || status.startsWith('C') ? 2 : 1;
    appendEntry(status, tokens.slice(i, i + count), acc);
    i += count;
  }
  const untracked = gitNul(projectRoot, ['ls-files', '--others', '--exclude-standard', '-z']);
  return {
    changedPaths: Array.from(new Set([...acc.changedPaths, ...untracked])),
    changedFiles: {
      paths: restrictedTo(Array.from(new Set([...acc.measurable, ...untracked])), only),
      baselinePathFor: (file: string) => acc.renameSources.get(file) ?? file
    }
  };
}

/**
 * The measurable subset alone. Kept as the size scan's entry point; the
 * transition gate calls `readGitChangeSet` so the type rule shares the read.
 */
export function readChangedFiles(
  projectRoot: string,
  baseRef: string,
  only?: readonly string[]
): ChangedFiles {
  return readGitChangeSet(projectRoot, baseRef, only).changedFiles;
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
