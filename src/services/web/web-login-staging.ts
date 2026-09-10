/**
 * Where a captured session LANDS: the staging publish (user decision UD-7,
 * 2026-09-10; `browser-workflow.md`'s staging carve-out).
 *
 * Split out of `web-login-profile.ts` in the S4 repair round 5, which pushed
 * that file past the 800-line scan limit. The seam is the publish itself:
 * everything here runs between "the session is in memory" and "the artifact on
 * disk is the new one".
 *
 * WHY STAGING AT ALL: `writeFileSync`'s default flag `w` is `O_TRUNC`, so a
 * plain overwrite empties `storageState.json` AT OPEN — before its first byte. A
 * mid-write `ENOSPC`/`EIO` therefore destroyed a working login, while the
 * failure message called it "unchanged". Staging the bytes beside the artifact
 * and `renameSync`-ing them on (one filesystem operation within one directory)
 * means the artifact is either the previous profile or the complete new one, so
 * what the caller is told is a fact rather than an assertion.
 *
 * THE STAGING NAME IS PER-RUN: `<statePath>.<pid>.staging` (S4 repair R5). It
 * used to be the fixed `<statePath>.staging`, which two `peaks web login` runs
 * on the same profile shared — A's rename could install B's bytes while A
 * reported A's counts, and B was then told the artifact "is unchanged" when it
 * had in fact been replaced. The pid separates them: one login is one process
 * and its publish is synchronous, so no other discriminator has to hold.
 *
 * `browser-workflow.md` sanctions a staging file under three conditions, all
 * kept here: it lives in the profile directory, it is deleted on every failure
 * path (and swept by the next run when a kill left one behind), and nothing ever
 * READS it as a profile.
 */
import { chmodSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { getErrorMessage } from 'peaks-loop-shared/result';

/**
 * The artifact's mode: owner-only, best-effort. `writeFileSync`'s `mode` applies
 * at creation only, which is why the staging file is chmod'ed explicitly after
 * the write, and why `renameSync` then carries that mode onto the artifact — so
 * this is also what owner-onlys a RE-login over an existing file.
 *
 * WHAT THIS IS WORTH ON WINDOWS, PLAINLY: the `mode` is INERT there.
 * `chmodSync(file, 0o600)` RETURNS WITHOUT THROWING while leaving the mode at
 * 0666 [reproduced], so on Windows this code does not make the staging file or
 * the artifact owner-only and no warning says so. The protection on this repo's
 * first platform is the ACL of the user profile these files live in
 * (`%USERPROFILE%`, not readable by other standard users), NOT this call. On
 * POSIX the call is what it looks like.
 */
const PROFILE_FILE_MODE = 0o600;

/** The suffix the carve-out names; every staging file this module handles ends in it. */
const STAGING_SUFFIX = '.staging';

/**
 * THIS RUN's staging sibling: `<statePath>.<pid>.staging`, inside the profile
 * directory, `0600`, and read by nothing (see the module docstring).
 */
function stagingPathFor(statePath: string): string {
  return `${statePath}.${String(process.pid)}${STAGING_SUFFIX}`;
}

/**
 * Publish the captured session ATOMICALLY (UD-7): stage the bytes beside the
 * artifact, then `renameSync` them onto it.
 *
 * A rename within one directory is one filesystem operation, so
 * `storageState.json` is either the previous profile or the complete new one —
 * never a truncated half of either. That is what makes the failure message
 * honest: a thrown write or a thrown rename leaves the artifact as it was, so
 * "this run did not modify it" is a fact rather than an assertion.
 *
 * The staging file never survives this call: the `catch` unlinks it before
 * rethrowing, and `runHeadedLogin`'s `finally` sweeps it on every path out.
 * Nothing may ever READ the staging path; it exists only between these two
 * calls.
 */
export function publishState(statePath: string, snapshot: unknown, warnings: string[]): void {
  const stagingPath = stagingPathFor(statePath);
  try {
    writeFileSync(stagingPath, JSON.stringify(snapshot), { mode: PROFILE_FILE_MODE });
    restrictToOwner(stagingPath, warnings);
    renameSync(stagingPath, statePath);
  } catch (error) {
    discardStaging(statePath, warnings);
    throw error;
  }
}

/**
 * Delete this run's staging file, and sweep any a KILLED run left behind.
 *
 * Called on EVERY path out of `runHeadedLogin` — a thrown write, a failed
 * rename, a timeout, a never-captured close, and after a successful publish
 * (where the rename has already consumed the file, making this a no-op). The
 * staging file holds live session cookies, and the carve-out allows it only
 * while a publish is in flight: it must never outlive the command that created
 * it.
 */
export function discardStaging(statePath: string, warnings: string[]): void {
  unlinkStaging(stagingPathFor(statePath), warnings);
  for (const stale of staleStagingPaths(statePath)) {
    unlinkStaging(stale, warnings);
  }
}

/** `rmSync` with `force`: a missing file is a no-op, and a failure is REPORTED. */
function unlinkStaging(path: string, warnings: string[]): void {
  try {
    rmSync(path, { force: true });
  } catch (error) {
    warnings.push(`could not remove the staging file ${path}: ${getErrorMessage(error)}`);
  }
}

/**
 * The staging files a run that was KILLED left in this profile directory.
 *
 * A process that is killed runs no `finally`, so its staging file — live
 * cookies — survives it, and the next login on this profile is what clears it.
 *
 * ONLY files whose pid is GONE qualify. A concurrent login that is still alive
 * owns its staging file until its own rename consumes it, and deleting that
 * would make the rename fail and hand that run a failure message about an
 * artifact it in fact replaced — the false invariant the per-run name exists to
 * remove.
 */
function staleStagingPaths(statePath: string): string[] {
  const directory = dirname(statePath);
  const prefix = `${basename(statePath)}.`;
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    // No profile directory at all: nothing can be stale inside it.
    return [];
  }
  const stale: string[] = [];
  for (const entry of entries) {
    if (!entry.startsWith(prefix) || !entry.endsWith(STAGING_SUFFIX)) {
      continue;
    }
    const pid = entry.slice(prefix.length, -STAGING_SUFFIX.length);
    if (/^\d+$/.test(pid) && !pidIsAlive(Number(pid))) {
      stale.push(join(directory, entry));
    }
  }
  return stale;
}

/**
 * Whether `pid` is still running. `process.kill(pid, 0)` sends no signal; ESRCH
 * is the only answer that PROVES the process is gone, so anything else — a live
 * pid, and equally a permission error on one this process may not signal —
 * counts as alive. That is the safe direction: it can leave a stale file on
 * disk, never delete a live run's.
 */
function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/**
 * Owner-only the cookie jar, best-effort. A platform (or filesystem) that will
 * not take the mode is REPORTED rather than swallowed — note that on Windows
 * this call does not throw and does not restrict anything (see
 * `PROFILE_FILE_MODE`), so the report covers only the paths that do fail.
 */
function restrictToOwner(path: string, warnings: string[]): void {
  try {
    chmodSync(path, PROFILE_FILE_MODE);
  } catch (error) {
    warnings.push(`could not restrict the permissions of ${path}: ${getErrorMessage(error)}`);
  }
}
