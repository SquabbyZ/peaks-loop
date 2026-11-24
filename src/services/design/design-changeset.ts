/**
 * Change-set resolution for `peaks design check`.
 *
 * One read feeds both the G1 source scan and the G3 route derivation, so the
 * routes G3 judges are exactly the files G1 scanned. The precedence is the
 * explicit `--files` list, then the request's `## Changed paths` claims, then
 * the git diff against `--base`. An unreadable git change set is a recorded
 * failure string, never an empty pass.
 */
import { readGitChangeSet } from '../scan/file-size-baseline.js';
import { readRidChangeClaims } from '../scan/rid-change-claims.js';

export type ChangeSetInput = {
  projectRoot: string;
  rid?: string | null;
  sessionId?: string;
  /** An explicit change set. It wins over every other source, even when empty. */
  changedFiles?: readonly string[];
  /** The git ref the working-tree change set is read against; defaults to `HEAD`. */
  base?: string;
};

/** The change set, plus why it is empty when it could not be read. */
export type ChangeSetRead = { files: string[]; failure: string | null };

async function resolveChangeSet(
  input: ChangeSetInput,
  rid: string | null
): Promise<string[] | null> {
  if (input.changedFiles !== undefined) return [...input.changedFiles];
  if (rid !== null) {
    if (input.sessionId === undefined) return null;
    return [...(readRidChangeClaims(input.projectRoot, input.sessionId).get(rid) ?? [])];
  }
  return readGitChangeSet(input.projectRoot, input.base ?? 'HEAD').changedPaths;
}

/** The change set, plus why it is empty when it could not be read. */
export async function readChangeSet(
  input: ChangeSetInput,
  rid: string | null
): Promise<ChangeSetRead> {
  try {
    return { files: (await resolveChangeSet(input, rid)) ?? [], failure: null };
  } catch (error) {
    const failure = error instanceof Error ? error.message : null;
    return { files: [], failure };
  }
}
