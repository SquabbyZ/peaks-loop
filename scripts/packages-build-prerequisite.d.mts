// Type declarations for packages-build-prerequisite.mjs.
// Manually-maintained companion file; keep in sync with the .mjs.
//
// Companion `.d.mts` files are this repo's existing convention for the plain
// `.mjs` build scripts under `scripts/` (see `dist-freshness.d.mts` and
// `install-skills.d.mts`). Without it, the typed imports in
// `tests/_global-setup/packages-build.ts` and
// `tests/unit/scripts/packages-build-prerequisite.test.ts` fail with TS7016
// under `tsc -p tsconfig.json`.

/** Builds all four packages; `pnpm` resolves the workspace topology. */
export declare const PACKAGES_BUILD_COMMAND: string;

/** Stamp path, relative to the project root. Outside every package. */
export declare const PACKAGE_STAMP_RELATIVE_PATH: string;

/** How long a run that finds the lock held blocks before refusing. */
export declare const LOCK_WAIT_MS: number;

/** The age at which a lock is presumed dead and broken. Longer than the wait. */
export declare const LOCK_STALE_MS: number;

export interface PackageRoot {
  readonly name: string;
  readonly root: string;
}

export interface PackageStamp {
  readonly digest: string;
  readonly fileCount: number;
  readonly builtAt: string;
}

export interface PackagesVerdict {
  /** No `dist/` build output at all. */
  readonly missing: readonly string[];
  /**
   * `dist/` exists but was not built from the current `src/` — including the
   * case where no digest was recorded, which cannot be proven fresh.
   */
  readonly stale: readonly string[];
  readonly fresh: readonly string[];
}

export interface EnsurePackagesBuiltOptions {
  readonly log?: (line: string) => void;
  readonly runBuild?: (projectRoot: string) => void;
  readonly waitMs?: number;
  readonly pollMs?: number;
  /**
   * The wait for the lock, in place of the real one — the seam that lets a case
   * present "the run that held the lock finished while we queued", which is the
   * state the in-lock re-read exists for.
   */
  readonly acquireLock?: (lock: string, waitMs: number, pollMs: number) => void;
}

export interface EnsurePackagesBuiltResult extends PackagesVerdict {
  /** True when this call is the one that ran the build. */
  readonly built: boolean;
}

/** Every package under `packages/` that has a `src/` tree to compile. */
export declare function listPackageRoots(projectRoot: string): PackageRoot[];

/** Records the digest of every package's sources. Called after a build. */
export declare function writePackageDistStamps(projectRoot: string): Record<string, PackageStamp>;

/** Classifies every package. Reads only; never builds and never writes. */
export declare function evaluatePackages(projectRoot: string): PackagesVerdict;

/** The operator-facing refusal, naming the stale packages and the fix. */
export declare function staleMessage(stale: readonly string[]): string;

/** The exclusive build lock for one project root. */
export declare function lockPath(projectRoot: string): string;

/** Throws on stale; builds once when something is missing. */
export declare function ensurePackagesBuilt(
  projectRoot: string,
  options?: EnsurePackagesBuiltOptions
): EnsurePackagesBuiltResult;
