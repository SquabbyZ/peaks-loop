/**
 * Polyrepo types — slice S2-b of RD-2.
 *
 * Models a parent directory that hosts one or more child git repos,
 * each of which may carry its own `.peaks/` state. The root `.peaks/`
 * is the source of truth for cross-child orchestration; child
 * `.peaks/` are subsets that mirror only the artifacts the child
 * needs (PRD §4.3).
 */
export type PeaksScope = 'root+child' | 'child-only';

/** A single child repo discovered under the parent root. */
export interface PolyrepoChild {
  /** Stable id derived from the basename (e.g. `frontend`, `backend`). */
  readonly id: string;
  /** Absolute path to the child directory. */
  readonly path: string;
  /** Whether `.git` exists at the child root (true git repo, not just a subdir). */
  readonly gitRoot: boolean;
  /** Whether the child carries its own `.peaks/` artifact subset. */
  readonly peaksScope: PeaksScope;
  /** Whether the child has peaks-loop installed (peaks binary on PATH
   *  is NOT checked here — that's done at dispatch time). */
  readonly peaksInstalled: boolean;
}

/** The polyrepo manifest, written to `.peaks/polyrepo.json` on init. */
export interface PolyrepoManifest {
  /** Schema version — increment on breaking changes. */
  readonly version: 1;
  /** Absolute path to the parent (root) directory. */
  readonly root: string;
  /** ISO-8601 timestamp of when this manifest was generated. */
  readonly detectedAt: string;
  /** Children discovered under the root. */
  readonly children: PolyrepoChild[];
}

/** A dispatch record — written to `.peaks/_runtime/<sid>/sc/dispatch/<rid>.json`
 *  AND mirrored to each target child's
 *  `.peaks/_runtime/<sid>/sc/dispatch/<rid>.json`. The two-axis
 *  convention from .peaks/standards/ is preserved: reviewable
 *  artifacts live under `.peaks/_runtime/<sid>/<role>/`, never as
 *  top-level siblings of `.peaks/_runtime/`. */
export interface PolyrepoDispatch {
  readonly rid: string;
  readonly sid: string;
  readonly root: string;
  /** Child ids targeted by this dispatch. Empty array = root-only. */
  readonly targets: string[];
  /** ISO timestamp. */
  readonly dispatchedAt: string;
  /** Source-of-truth for the artifact body. */
  readonly artifact: {
    readonly role: 'prd' | 'rd' | 'qa';
    readonly path: string;
  };
}