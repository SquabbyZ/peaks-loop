// Type declarations for dist-freshness.mjs.
// Manually-maintained companion file; keep in sync with the .mjs.
//
// Companion `.d.mts` files are this repo's existing convention for the plain
// `.mjs` build scripts under `scripts/` (see `_release-shared.d.mts` and
// `install-skills.d.mts`). Without it, the typed import in
// `tests/integration/_dist-freshness-global-setup.ts` and
// `tests/unit/scripts/dist-freshness.test.ts` fails with TS7016 under
// `tsc -p tsconfig.json`, moving the wide-tsconfig baseline that exists so new
// tests can be added without moving it.

/** Bumped only if the digest's input definition changes. */
export declare const DIST_STAMP_VERSION: number;

/** Stamp path, relative to the project root. */
export declare const DIST_STAMP_RELATIVE_PATH: string;

/** The command that makes any staleness finding go away. */
export declare const REBUILD_COMMAND: string;

export interface SourceDigest {
  readonly digest: string;
  readonly fileCount: number;
}

export interface DistStampWriteResult extends SourceDigest {
  readonly stampPath: string;
}

export interface NewerSource {
  readonly path: string;
  readonly mtimeMs: number;
}

interface FreshnessBase {
  readonly distDir: string;
  /** Digest of the CURRENT `src/**\/*.ts`. */
  readonly digest: string;
  readonly fileCount: number;
  /** Newest built-artifact mtime, i.e. when the build finished. */
  readonly builtMtimeMs: number;
  /** True when a stamp file existed but was unusable (wrong version / malformed). */
  readonly stampPresent: boolean;
}

export type DistFreshness =
  | { readonly state: 'no-dist'; readonly distDir: string }
  | (FreshnessBase & { readonly state: 'fresh'; readonly method: 'digest' | 'mtime' })
  | (FreshnessBase & {
      readonly state: 'stale';
      readonly method: 'digest';
      readonly builtDigest: string;
      readonly builtAt: string | null;
    })
  | (FreshnessBase & {
      readonly state: 'stale';
      readonly method: 'mtime';
      readonly newerSources: readonly NewerSource[];
    });

/** Digest of the tsc build inputs under `<projectRoot>/src`. */
export declare function computeSourceDigest(projectRoot: string): SourceDigest;

/** Writes `dist/.dist-stamp.json`. Called by the build, after `tsc`. */
export declare function writeDistStamp(projectRoot: string): DistStampWriteResult;

/** Decides whether `dist/` reflects the current `src/`. */
export declare function evaluateDistFreshness(projectRoot: string): DistFreshness;
