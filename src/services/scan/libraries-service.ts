import { readdir } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { isDirectory, pathExists, readText } from '../../shared/fs.js';
import type {
  DependencyScope,
  LibraryEntry,
  LibraryReport,
  WorkspaceEntry
} from './libraries-types.js';

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
  workspaces?: string[] | { packages?: string[] };
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

async function readPackageJson(packageJsonPath: string): Promise<{ exists: boolean; record: PackageJsonRecord | null; error?: string }> {
  if (!(await pathExists(packageJsonPath))) {
    return { exists: false, record: null };
  }
  try {
    const raw = await readText(packageJsonPath);
    const record = JSON.parse(raw) as PackageJsonRecord;
    return { exists: true, record };
  } catch (error) {
    return { exists: true, record: null, error: (error as Error).message };
  }
}

/**
 * Hand-rolled YAML parser for `pnpm-workspace.yaml`.
 *
 * Only consumes the top-level `packages:` list. Ignores all other top-level
 * keys (`allowBuilds:`, `catalog:`, etc.) and indented blocks. Returns
 * `null` when the file is present but does not contain a `packages:`
 * list — callers should fall through to the next detection source.
 *
 * Supports the common shapes:
 *   packages:
 *     - 'packages/*'
 *     - "apps/web"
 *     - tools
 *     - packages/hermes-agent/*
 */
function parsePnpmWorkspaceYaml(content: string): string[] | null {
  const lines = content.split(/\r?\n/);
  let inPackagesList = false;
  let packagesIndent = -1;
  const result: string[] = [];

  for (const rawLine of lines) {
    // Strip comments (anything after # not inside quotes — close enough for our use)
    const commentIdx = rawLine.indexOf('#');
    const line = (commentIdx >= 0 ? rawLine.slice(0, commentIdx) : rawLine).replace(/\s+$/, '');
    if (line.length === 0) continue;

    if (!inPackagesList) {
      // Looking for the top-level `packages:` key.
      const match = /^packages:\s*$/.exec(line);
      if (match) {
        inPackagesList = true;
      }
      continue;
    }

    // Inside the packages list. Items must be more indented than the key.
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    if (packagesIndent < 0) {
      // First non-empty line after the key — this sets the indent.
      if (indent === 0) {
        // `packages:` was the last meaningful line; an unindented line
        // means the list is empty or the format is unsupported.
        break;
      }
      packagesIndent = indent;
    } else if (indent < packagesIndent) {
      // Outdented — the list ended.
      break;
    } else if (indent > packagesIndent) {
      // Nested list (e.g. `packages: [{ ... }]`) — unsupported; stop.
      break;
    }

    // Expect `- <value>` or `- '<value>'` or `- "<value>"`.
    const itemMatch = /^\s*-\s+(['"]?)(.+?)\1\s*$/.exec(line);
    if (itemMatch && itemMatch[2] !== undefined) {
      result.push(itemMatch[2]);
    } else {
      // Not a list item; the block ended.
      break;
    }
  }

  return result;
}

function extractNpmWorkspaces(value: PackageJsonRecord['workspaces']): string[] | null {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Array.isArray(value.packages)) {
    return value.packages;
  }
  return null;
}

type DiscoverySource = 'pnpm-workspace' | 'package-json-workspaces' | 'lerna' | null;

/**
 * Discover workspace `package.json` paths from the supported monorepo
 * manifest sources. Returns the list of absolute paths plus which
 * detection source won. When no source is present, returns an empty
 * list with `source: null` (caller should fall through to single-package
 * behavior).
 */
async function discoverWorkspacePackageJsons(
  projectRoot: string,
  warnings: string[]
): Promise<{ paths: string[]; source: DiscoverySource }> {
  // 1. pnpm-workspace.yaml
  const pnpmWsPath = join(projectRoot, 'pnpm-workspace.yaml');
  if (await pathExists(pnpmWsPath)) {
    try {
      const yaml = await readText(pnpmWsPath);
      const globs = parsePnpmWorkspaceYaml(yaml);
      if (globs && globs.length > 0) {
        const paths = await expandWorkspaceGlobs(projectRoot, globs, warnings);
        return { paths, source: 'pnpm-workspace' };
      }
    } catch (error) {
      warnings.push(`pnpm-workspace.yaml present but unreadable: ${(error as Error).message}`);
    }
  }

  // 2. package.json `workspaces` field (npm or yarn classic).
  const rootPkgPath = join(projectRoot, 'package.json');
  if (await pathExists(rootPkgPath)) {
    const { record } = await readPackageJson(rootPkgPath);
    if (record) {
      const globs = extractNpmWorkspaces(record.workspaces);
      if (globs && globs.length > 0) {
        const paths = await expandWorkspaceGlobs(projectRoot, globs, warnings);
        return { paths, source: 'package-json-workspaces' };
      }
    }
  }

  // 3. lerna.json `packages` field.
  const lernaPath = join(projectRoot, 'lerna.json');
  if (await pathExists(lernaPath)) {
    try {
      const lernaRaw = await readText(lernaPath);
      const lerna = JSON.parse(lernaRaw) as { packages?: unknown };
      if (Array.isArray(lerna.packages) && lerna.packages.every((p) => typeof p === 'string')) {
        const paths = await expandWorkspaceGlobs(
          projectRoot,
          lerna.packages as string[],
          warnings
        );
        return { paths, source: 'lerna' };
      }
    } catch (error) {
      warnings.push(`lerna.json present but unreadable: ${(error as Error).message}`);
    }
  }

  return { paths: [], source: null };
}

/**
 * Resolve a list of workspace globs against the project tree.
 *
 * Supports shapes with up to two segments of `*` wildcards:
 *   - `packages/*`
 *   - `packages/hermes-agent/*`
 *   - `apps/web` (literal, no wildcard)
 *
 * Deeper patterns (more than one `*` segment) are silently skipped and a
 * warning is emitted. This is by design (no new dependency, narrow scope).
 */
async function expandWorkspaceGlobs(
  projectRoot: string,
  globs: string[],
  warnings: string[]
): Promise<string[]> {
  const found = new Set<string>();
  for (const glob of globs) {
    const segments = glob.split('/').filter((s) => s.length > 0);
    const wildcardCount = segments.filter((s) => s === '*').length;
    if (wildcardCount > 1) {
      warnings.push(`workspace glob "${glob}" has more than one wildcard; skipped (unsupported).`);
      continue;
    }
    if (segments.length === 0) continue;

    if (wildcardCount === 0) {
      // Literal path — treat the last segment as a directory containing package.json.
      const literalDir = join(projectRoot, ...segments);
      if (await isDirectory(literalDir)) {
        const candidate = join(literalDir, 'package.json');
        if (await pathExists(candidate)) {
          found.add(candidate);
        }
      }
      continue;
    }

    // Exactly one wildcard — it must be the LAST segment.
    const wildcardIdx = segments.indexOf('*');
    if (wildcardIdx !== segments.length - 1) {
      warnings.push(`workspace glob "${glob}" has non-trailing wildcard; skipped.`);
      continue;
    }
    const parentSegments = segments.slice(0, wildcardIdx);
    const parentDir = join(projectRoot, ...parentSegments);
    if (!(await isDirectory(parentDir))) continue;

    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(parentDir, { withFileTypes: true });
    } catch (error) {
      warnings.push(`workspace glob "${glob}": could not read ${parentDir}: ${(error as Error).message}`);
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const childPkg = join(parentDir, entry.name, 'package.json');
      if (await pathExists(childPkg)) {
        found.add(childPkg);
      }
    }
  }
  return Array.from(found).sort();
}

/**
 * Parse a single `package.json` record into `LibraryEntry` rows.
 * Returns the entries and the per-scope tallies for that one package.
 */
function extractEntriesFromPackageJson(
  record: PackageJsonRecord
): { entries: LibraryEntry[]; byScope: LibraryReport['byScope'] } {
  const byScope: LibraryReport['byScope'] = {
    dependencies: 0,
    devDependencies: 0,
    peerDependencies: 0,
    optionalDependencies: 0
  };
  const entries: LibraryEntry[] = [];
  for (const scope of SCOPES) {
    const deps = record[scope];
    if (!deps) continue;
    for (const [name, version] of Object.entries(deps)) {
      entries.push({
        name,
        version,
        major: parseMajorVersion(version),
        scope,
        ecosystem: 'npm'
      });
      byScope[scope] += 1;
    }
  }
  return { entries, byScope };
}

export async function scanLibraries(options: ScanLibrariesOptions): Promise<LibraryReport> {
  const { projectRoot } = options;
  const warnings: string[] = [];
  const libraries: LibraryEntry[] = [];
  const byScope: LibraryReport['byScope'] = {
    dependencies: 0,
    devDependencies: 0,
    peerDependencies: 0,
    optionalDependencies: 0
  };
  const workspaces: WorkspaceEntry[] = [];

  // 1. Discover monorepo workspaces (if any). Discovery is independent of
  //    whether the root `package.json` exists; we still attempt it.
  const { paths: workspacePkgPaths, source } = await discoverWorkspacePackageJsons(
    projectRoot,
    warnings
  );
  const isMonorepo = source !== null && workspacePkgPaths.length > 0;

  if (isMonorepo) {
    // Monorepo mode: scan the root + every discovered workspace package.json.
    const rootPkgPath = join(projectRoot, 'package.json');
    const allPaths: string[] = [];
    if (await pathExists(rootPkgPath)) {
      allPaths.push(rootPkgPath);
    }
    // Dedupe: the root might also be matched by a glob (rare, but possible).
    for (const p of workspacePkgPaths) {
      if (!allPaths.includes(p)) allPaths.push(p);
    }

    // Recursive descent: for each discovered workspace dir, also pick up
    // any nested `package.json` one level deeper. This matches the pnpm
    // convention where a workspace package (e.g. `hermes-agent`) can be
    // a container for sub-workspaces (e.g. `hermes-agent/ui-tui`). The
    // outer pnpm-workspace.yaml often only declares the top-level glob,
    // so a literal-glob-only scan would miss the nested packages.
    const expanded = new Set<string>(allPaths);
    for (const pkgPath of allPaths) {
      const dir = pkgPath.replace(/[\\/]package\.json$/, '');
      if (!(await isDirectory(dir))) continue;
      let entries: import('node:fs').Dirent[];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const nestedPkg = join(dir, entry.name, 'package.json');
        if (await pathExists(nestedPkg)) {
          expanded.add(nestedPkg);
        }
      }
    }
    allPaths.length = 0;
    allPaths.push(...Array.from(expanded).sort());

    for (const pkgPath of allPaths) {
      const { exists, record, error } = await readPackageJson(pkgPath);
      if (!exists) continue;
      if (record === null) {
        warnings.push(`${normalizePathForDisplay(pkgPath)} is not valid JSON: ${error ?? 'unknown parse error'}`);
        continue;
      }
      const { entries, byScope: pkgByScope } = extractEntriesFromPackageJson(record);
      libraries.push(...entries);
      for (const scope of SCOPES) {
        byScope[scope] += pkgByScope[scope];
      }
      // For per-workspace `workspaces[]`, only list non-root paths; the
      // root is implicit and lives at `projectRoot`.
      const isRoot = pkgPath === rootPkgPath;
      if (!isRoot) {
        const entry: WorkspaceEntry = {
          path: pkgPath,
          count: entries.length
        };
        if (record.name !== undefined) entry.name = record.name;
        if (record.version !== undefined) entry.version = record.version;
        workspaces.push(entry);
      }
    }
  } else {
    // Single-package mode (today's behavior). Preserved byte-for-byte
    // apart from the new additive `workspaces: []` field.
    const { exists, record, error } = await readPackageJson(join(projectRoot, 'package.json'));
    if (!exists) {
      warnings.push('package.json not found; nothing to scan.');
      return {
        projectRoot,
        libraries,
        totalCount: 0,
        byScope,
        workspaces: [],
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
        workspaces: [],
        scannedAt: new Date().toISOString(),
        warnings
      };
    }
    const { entries, byScope: pkgByScope } = extractEntriesFromPackageJson(record);
    libraries.push(...entries);
    for (const scope of SCOPES) {
      byScope[scope] += pkgByScope[scope];
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
    workspaces,
    scannedAt: new Date().toISOString(),
    warnings
  };
}

function normalizePathForDisplay(p: string): string {
  // Surface posix-style separators in warnings for consistency with the
  // existing 'package.json is not valid JSON' message shape.
  return p.split(sep).join('/');
}
