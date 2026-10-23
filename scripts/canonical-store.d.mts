// Type declarations for canonical-store.mjs.
// Manually-maintained companion file; keep in sync with the .mjs.
//
// WHY THIS EXISTS. Same reason as the sibling `install-skills.d.mts`: without it
// every typed import of the `.mjs` fails with TS7016 ("implicitly has an 'any'
// type") under `tsc -p tsconfig.json`, which `slice-check-service` measures against
// a fixed pre-existing error baseline. The two unit tests of the canonical store
// import the module directly, so leaving it undeclared would have moved a baseline
// that exists precisely so new work can be added without moving it.
//
// Companion `.d.mts` files are this repo's existing convention for the plain
// `.mjs` build scripts under `scripts/` (see `_release-shared.d.mts`).

export type CanonicalAssetKind = 'skills' | 'agents' | 'output-styles';

export interface CanonicalStoreOptions {
  /** Overrides `$PEAKS_HOME`, which in turn overrides `~/.peaks`. */
  root?: string;
}

export interface CanonicalAssetOptions extends CanonicalStoreOptions {
  sourcePath: string;
  /** One plain path segment; anything else is refused. */
  name: string;
  kind: CanonicalAssetKind;
  /**
   * The version of the package that owns the asset (`package.json#version`).
   * It is stamped into the copy's sidecar, and a recorded version behind it
   * makes the copy stale even when its bytes still match.
   */
  version?: string;
  /** Plan the entry and write nothing. */
  dryRun?: boolean;
}

export interface CanonicalEntryOptions extends CanonicalAssetOptions {
  /** The IDE-directory entry to point at the canonical copy. Omit for store-only. */
  linkPath?: string;
}

/** What the store holds for one entry, as found. */
export type CanonicalStoreState = 'current' | 'stale' | 'unmanaged';

export interface CanonicalCopyResult {
  canonicalPath: string;
  /**
   * `installed` wrote the copy; `unchanged` found it current and touched
   * nothing; `unmanaged` refused to touch an entry peaks-loop does not own;
   * `planned` is the dry-run form of `installed`.
   */
  action: 'installed' | 'unchanged' | 'unmanaged' | 'planned';
  /** `stale` means the copy was behind the source version or its bytes differed. */
  state: CanonicalStoreState;
  /** The version the copy was made from, or null when the marker records none. */
  version: string | null;
  /** Why a stale copy was stale: `version` or `content`. */
  reason?: 'version' | 'content' | null;
}

export interface CanonicalReconcileResult extends CanonicalCopyResult {
  /** `skipped` means an entry peaks-loop does not own was left alone. */
  linkAction: 'linked' | 'repaired' | 'unchanged' | 'skipped' | 'planned';
}

/** The sidecar's two facts: the source path, and the version that produced it. */
export interface CanonicalMarker {
  path: string | null;
  version: string | null;
}

export const CANONICAL_ASSET_KINDS: ReadonlyArray<CanonicalAssetKind>;
export const CANONICAL_ROOT_ENV: 'PEAKS_HOME';
export const MANAGED_MARKER_SUFFIX: '.peaks-managed';
export const MANAGED_MARKER_FORMAT: 'peaks-managed-v2';
export const LEGACY_MARKER_KIND: Readonly<Record<'agents' | 'output-styles', string>>;

export function resolveCanonicalRoot(options?: CanonicalStoreOptions): string;
export function resolveKindRoot(kind: CanonicalAssetKind, options?: CanonicalStoreOptions): string;
export function readManagedTarget(targetPath: string): string | null;
export function readManagedMarker(targetPath: string): CanonicalMarker | null;
export function writeManagedMarker(targetPath: string, provenance: string, version?: string): void;
export function isManagedEntry(targetPath: string): boolean;
export function ensureCanonicalCopy(options: CanonicalAssetOptions): CanonicalCopyResult;
export function linkResolvesTo(linkPath: string, expectedPath: string): boolean;
export function reconcileCanonicalEntry(options: CanonicalEntryOptions): CanonicalReconcileResult;
