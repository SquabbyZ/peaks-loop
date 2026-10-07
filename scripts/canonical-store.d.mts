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
}

export interface CanonicalEntryOptions extends CanonicalAssetOptions {
  /** The IDE-directory entry to point at the canonical copy. Omit for store-only. */
  linkPath?: string;
}

export interface CanonicalCopyResult {
  canonicalPath: string;
  /** `installed` wrote the copy; `unchanged` found matching bytes and touched nothing. */
  action: 'installed' | 'unchanged';
}

export interface CanonicalReconcileResult extends CanonicalCopyResult {
  /** `skipped` means an entry peaks-loop does not own was left alone. */
  linkAction: 'linked' | 'repaired' | 'unchanged' | 'skipped';
}

export const CANONICAL_ASSET_KINDS: ReadonlyArray<CanonicalAssetKind>;
export const CANONICAL_ROOT_ENV: 'PEAKS_HOME';

export function resolveCanonicalRoot(options?: CanonicalStoreOptions): string;
export function resolveKindRoot(kind: CanonicalAssetKind, options?: CanonicalStoreOptions): string;
export function readManagedTarget(targetPath: string): string | null;
export function writeManagedMarker(targetPath: string, provenance: string): void;
export function ensureCanonicalCopy(options: CanonicalAssetOptions): CanonicalCopyResult;
export function linkResolvesTo(linkPath: string, expectedPath: string): boolean;
export function reconcileCanonicalEntry(options: CanonicalEntryOptions): CanonicalReconcileResult;
