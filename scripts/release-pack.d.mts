/**
 * Type stub for scripts/release-pack.mjs (rid-014).
 *
 * Vitest's allowJs-by-default resolves the .mjs at import time, but
 * `tsc -p tsconfig.json --noEmit` (the pre-merge gate) needs a typed
 * declaration. This file declares the two new helpers rid-014 added
 * so the regression test type-checks without `as any`.
 */
export interface DiscoveredSubpackage {
  readonly dir: string;
  readonly name: string;
  readonly version: string;
}

export function discoverSubpackages(): DiscoveredSubpackage[];
export function topoOrderSubpackages(pkgs: ReadonlyArray<DiscoveredSubpackage>): DiscoveredSubpackage[];

export const ROOT_DIR: string;
export function packAndInspectTarball(pkgDir: string): { tarball: string; name: string; version: string; cliVersion?: string };
export function readVersionJsFromTarball(tarball: string, label: string): string;
export function isRegistryStale(name: string, version: string, localTarball: string): boolean;
export function extractCliVersion(blob: string | null | undefined): string | null;
