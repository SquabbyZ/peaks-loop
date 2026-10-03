/**
 * D2 (rid 2026-10-03-job-ledger-truthfulness) — can this commit sha be proved to
 * exist in this repository?
 *
 * WHY THIS EXISTS. `peaks job checkpoint --state done --commit-sha <sha>` checked
 * only `sha.length >= 7` (`job-orchestrator.ts:55`), so a typo'd sha was accepted
 * and written into the ledger. Measured 2026-10-02 on `2026-10-02-c-wave9`, and
 * again for this slice against the committed build: a 12-hex string that
 * `git cat-file` calls `Not a valid object name` produced `ok: true` and a
 * `state.json` whose `commitSha` named it. A ledger that points at a commit which
 * does not exist is worse than no ledger, because it will be trusted later.
 *
 * WHY A GIT CALL AND NOT A REGEX. Length and alphabet say the string is
 * sha-SHAPED; only the repository says whether the commit EXISTS. So the shape
 * rule stays where it is (the checkpoint input schema's ≥7 pre-filter, which
 * keeps a malformed string from paying a `git` call), and this module answers the
 * one question git can answer: `git cat-file -e <sha>^{commit}`.
 *
 * THE BOUNDARY, STATED PLAINLY. Where the project root is not a git repository
 * there is no "that repo" in which the sha could resolve, and git says so
 * (`status: 'no-repository'`). That is not a verdict about the sha, so the
 * checkpoint proceeds and records the claim exactly as it did before this slice —
 * loudly named here rather than smuggled through, because the job suites run
 * against tmp workspaces and a silent widening of the refusal to cover them would
 * be a behaviour change this slice did not ask for.
 *
 * No writes, no locks, no state: one read-only question to git, four answers.
 */

import { spawnSync } from 'node:child_process';

/**
 * The four things git can tell us about a sha-shaped string in a directory.
 *
 * - `verified`        — the sha resolves to a commit here.
 * - `unresolved`      — a repository IS present and says this sha is not a
 *                       commit. The refusal case.
 * - `no-repository`   — no repository at or above `projectRoot`; nothing to
 *                       check the claim against.
 * - `git-unavailable` — `git` itself could not be run. Also not a verdict about
 *                       the sha, and deliberately distinct from `no-repository`:
 *                       a broken tool must never read as "this repo has no git".
 */
export type CommitVerification =
  | { readonly status: 'verified'; readonly sha: string }
  | { readonly status: 'unresolved'; readonly sha: string; readonly detail: string }
  | { readonly status: 'no-repository'; readonly detail: string }
  | { readonly status: 'git-unavailable'; readonly detail: string };

/** The suffix that turns a sha into "the commit it names", per git's own grammar. */
const COMMIT_DEREF = '^{commit}';

/** git's own words for "this directory is not a repository" (all locales we ship). */
const NOT_A_REPOSITORY = /not a git repository/i;

/**
 * Ask the repository whether `commitSha` is a commit in it.
 *
 * `commitSha` is expected to have already passed the caller's shape pre-filter;
 * it is interpolated into git's *argument list* (never a shell string), so a
 * value like `../..` reaches git as one argv slot rather than as a path to
 * resolve.
 */
export function verifyCommitSha(projectRoot: string, commitSha: string): CommitVerification {
  const res = spawnSync(
    'git',
    ['-C', projectRoot, 'cat-file', '-e', `${commitSha}${COMMIT_DEREF}`],
    { encoding: 'utf8', windowsHide: true }
  );
  if (res.error !== undefined && res.error !== null) {
    return { status: 'git-unavailable', detail: res.error.message };
  }
  const detail = (res.stderr ?? '').trim();
  if (res.status === 0) return { status: 'verified', sha: commitSha };
  if (NOT_A_REPOSITORY.test(detail)) return { status: 'no-repository', detail };
  return { status: 'unresolved', sha: commitSha, detail };
}

/**
 * The refusal sentence, or `null` when the claim may be recorded.
 *
 * Lives next to the check rather than at the call site so every consumer of the
 * verdict says the same thing: the sha it was given, that it does not resolve,
 * and where it looked. `git-unavailable` refuses too — a ledger entry whose
 * commit could not be checked because git would not run is a claim the tool
 * should say it could not honour, not one it quietly wrote.
 */
export function commitVerificationRefusal(
  verification: CommitVerification,
  projectRoot: string,
  commitSha: string
): string | null {
  if (verification.status === 'verified' || verification.status === 'no-repository') {
    return null;
  }
  const detail = verification.detail.length > 0 ? ` (${verification.detail})` : '';
  if (verification.status === 'git-unavailable') {
    return `commitSha "${commitSha}" could not be checked: git did not run in "${projectRoot}"${detail}`;
  }
  return `commitSha "${verification.sha}" does not resolve to a commit in "${projectRoot}"${detail}`;
}
