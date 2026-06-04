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

export type LibraryReport = {
  projectRoot: string;
  libraries: LibraryEntry[];
  totalCount: number;
  byScope: Record<DependencyScope, number>;
  /** ISO timestamp at scan time. */
  scannedAt: string;
  /** Soft signals — e.g. "package.json not found" or "package.json is not valid JSON". */
  warnings: string[];
};
