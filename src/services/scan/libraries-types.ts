/**
 * Library version scan types.
 * Joins the existing scan family (archetype, existing-system, type-sanity,
 * acceptance-coverage, diff-vs-scope, file-size) but is intentionally scoped
 * to library version enumeration only. Does NOT extend scan-types.ts —
 * each scan service ships its own types to keep the scan-types module
 * focused on the archetype + existing-system pair (see src/services/scan/scan-types.ts).
 */

export type Ecosystem = 'npm';

export type DependencyScope =
  | 'dependencies'
  | 'devDependencies'
  | 'peerDependencies'
  | 'optionalDependencies';

export type LibraryEntry = {
  /** npm package name (e.g. "antd", "@mui/material", "react-router-dom"). */
  name: string;
  /** Raw version spec as written in package.json (e.g. "^5.18.0", "workspace:*", "git+https://..."). */
  version: string;
  /**
   * Parsed major version, or null when the spec is non-semver (e.g.
   * "workspace:*", "file:../local", "git+https://..."). The LLM should
   * treat null as "cannot determine major; consult breaking-changes table
   * by other signals (e.g. lockfile or import statement shape)".
   */
  major: number | null;
  scope: DependencyScope;
  ecosystem: Ecosystem;
};

/**
 * Per-workspace provenance for monorepo scans.
 *
 * `path` is the absolute path of the `package.json` that contributed
 * libraries. `count` is the number of `LibraryEntry` rows produced by
 * reading that single `package.json` (i.e. NOT the aggregate across
 * the whole monorepo — use `LibraryReport.totalCount` for the aggregate).
 *
 * `name` and `version` are the workspace's own `name` / `version` from
 * its `package.json`, when present. They are optional because some
 * workspace `package.json` files omit them.
 */
export type WorkspaceEntry = {
  path: string;
  count: number;
  name?: string;
  version?: string;
};

export type LibraryReport = {
  projectRoot: string;
  libraries: LibraryEntry[];
  totalCount: number;
  byScope: Record<DependencyScope, number>;
  /**
   * Per-workspace provenance for monorepo (pnpm / npm / yarn workspaces,
   * lerna) projects. Empty for single-package projects so the field is
   * always present (additive; consumers can rely on the shape).
   */
  workspaces: WorkspaceEntry[];
  /** ISO timestamp at scan time. */
  scannedAt: string;
  /** Soft signals — e.g. "package.json not found" or "package.json is not valid JSON". */
  warnings: string[];
};
