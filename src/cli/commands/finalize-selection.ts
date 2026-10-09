/**
 * The pure `--request-id` selection contract for `peaks sub-agent finalize`, plus
 * the option shape the command registers. Extracted from `share-commands.ts` so
 * that file stays under the line cap; these are the pieces the finalize tests
 * import directly, and none of them touches the filesystem.
 */

/**
 * A `dispatch-*.json` candidate for `finalize --request-id`, as read off disk.
 * The record's own `createdAt` is carried as the recency key — NOT the file's
 * mtime, which any heartbeat or finalize rewrites, so a `done` record can look
 * newer than the `queued` one that superseded it. Keeping the key on the
 * candidate makes the selection rule a pure function of the records and
 * testable without a filesystem.
 */
export interface FinalizeCandidate {
  readonly recordPath: string;
  readonly requestId: string;
  readonly status: string;
  readonly createdAt: string;
}

/**
 * What `--request-id` actually did, reported in the envelope. N3: the branch
 * used to resolve silently and could not say WHY a record was or was not the
 * one finalized.
 */
export interface FinalizeSelection {
  readonly requestId: string;
  readonly rule: string;
  readonly matched: number;
  readonly chosen: string | null;
  readonly rejected: readonly {
    readonly recordPath: string;
    readonly status: string;
    readonly reason: string;
  }[];
}

/** The one selection rule `--request-id` and `--batch` now share. */
export const FINALIZE_SELECTION_RULE =
  'prefer status=queued; among those, newest by record createdAt (then filename); ' +
  'no queued match means nothing is finalized';

/** The options `peaks sub-agent finalize` accepts. */
export interface FinalizeOptions {
  batch?: string;
  requestId?: string;
  outcome?: string;
  error?: string;
  allStale?: boolean;
  project?: string;
  sessionId?: string;
  json?: boolean;
}

/**
 * N3 — pick the record `finalize --request-id` should act on.
 *
 * The branch this replaces `break`ed on the FIRST file whose record carried
 * the requestId and never looked at `status`. With a re-dispatched request
 * always resolved to the OLDEST one — the already-`done` RD record — so
 * finalizing reported success while the newer `queued` QA record stayed
 * queued forever. `--batch` never had that bug: it filters on `queued`.
 *
 * Both branches are now the same rule. Return `null` when nothing is queued:
 * a record that already left `queued` is precisely the one that must NOT be
 * re-finalized, so the caller reports the survivors instead of touching one.
 */
export function selectFinalizeTarget(
  candidates: readonly FinalizeCandidate[]
): FinalizeCandidate | null {
  const queued = candidates.filter((candidate) => candidate.status === 'queued');
  if (queued.length === 0) return null;
  return [...queued].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.recordPath.localeCompare(a.recordPath)
  )[0]!;
}

/** Why a candidate was not the chosen one — reported, never guessed at. */
export function describeFinalizeRejection(
  candidate: FinalizeCandidate,
  chosen: FinalizeCandidate | null
): string {
  if (candidate.status !== 'queued' || chosen === null) {
    return 'status is ' + candidate.status;
  }
  return 'superseded by the newer queued record ' + chosen.recordPath;
}
