import { join } from 'node:path';
import { pathExists, readText } from '../../shared/fs.js';
import type { DependencyScope, LibraryEntry, LibraryReport } from './libraries-types.js';

export type ScanLibrariesOptions = {
  projectRoot: string;
};

type PackageJsonRecord = {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

const SCOPES: readonly DependencyScope[] = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies'
] as const;

const SCOPE_ORDER: Record<DependencyScope, number> = {
  dependencies: 0,
  devDependencies: 1,
  peerDependencies: 2,
  optionalDependencies: 3
};

/**
 * Parse the major version from a semver-ish spec.
 *
 * Handles the common shapes:
 *   "^5.18.0"      → 5
 *   "~1.2.3"       → 1
 *   "1.2.3"        → 1
 *   ">=1.0.0"      → 1
 *   "5"            → 5
 *   "5.x"          → 5
 *
 * Returns null for non-semver specs that the LLM should not assume a
 * major for:
 *   "workspace:*"  → null
 *   "file:../..."   → null
 *   "git+https..." → null
 *   "npm:@scope/x@1" → 1 (alias spec, we extract what we can)
 */
export function parseMajorVersion(spec: string): number | null {
  // Strip npm alias prefix "npm:" and take whatever comes after the LAST "@"
  // (since alias specs are "npm:<name>@<version>")
  let versionPart = spec;
  if (versionPart.startsWith('npm:')) {
    const atIdx = versionPart.lastIndexOf('@');
    versionPart = atIdx >= 0 ? versionPart.slice(atIdx + 1) : versionPart.slice(4);
  }
  // Strip semver range operators (caret, tilde, comparison ops, exact)
  versionPart = versionPart.replace(/^[\^~>=<]+\s*/, '').trim();
  // Take the first numeric component
  const match = /^(\d+)/.exec(versionPart);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isSafeInteger(n) ? n : null;
}

async function readPackageJson(projectRoot: string): Promise<{ exists: boolean; record: PackageJsonRecord | null; error?: string }> {
  const pkgPath = join(projectRoot, 'package.json');
  if (!(await pathExists(pkgPath))) {
    return { exists: false, record: null };
  }
  try {
    const raw = await readText(pkgPath);
    const record = JSON.parse(raw) as PackageJsonRecord;
    return { exists: true, record };
  } catch (error) {
    return { exists: true, record: null, error: (error as Error).message };
  }
}

export async function scanLibraries(options: ScanLibrariesOptions): Promise<LibraryReport> {
  const { projectRoot } = options;
  const warnings: string[] = [];
  const byScope: LibraryReport['byScope'] = {
    dependencies: 0,
    devDependencies: 0,
    peerDependencies: 0,
    optionalDependencies: 0
  };
  const libraries: LibraryEntry[] = [];

  const { exists, record, error } = await readPackageJson(projectRoot);
  if (!exists) {
    warnings.push('package.json not found; nothing to scan.');
    return {
      projectRoot,
      libraries,
      totalCount: 0,
      byScope,
      scannedAt: new Date().toISOString(),
      warnings
    };
  }
  if (record === null) {
    warnings.push(`package.json is not valid JSON: ${error ?? 'unknown parse error'}`);
    return {
      projectRoot,
      libraries,
      totalCount: 0,
      byScope,
      scannedAt: new Date().toISOString(),
      warnings
    };
  }

  for (const scope of SCOPES) {
    const deps = record[scope];
    if (!deps) continue;
    for (const [name, version] of Object.entries(deps)) {
      libraries.push({
        name,
        version,
        major: parseMajorVersion(version),
        scope,
        ecosystem: 'npm'
      });
      byScope[scope] += 1;
    }
  }

  // Sort: by name (alphabetical), then by scope order (deps first, then dev, peer, optional)
  libraries.sort((a, b) => {
    if (a.name !== b.name) return a.name.localeCompare(b.name);
    return SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope];
  });

  return {
    projectRoot,
    libraries,
    totalCount: libraries.length,
    byScope,
    scannedAt: new Date().toISOString(),
    warnings
  };
}
