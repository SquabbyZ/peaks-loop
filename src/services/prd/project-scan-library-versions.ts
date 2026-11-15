/**
 * The `libraryVersions` map a project scan records, derived from `scanLibraries`.
 *
 * WHY THE ROOT MANIFEST DECIDES. In a monorepo the scan concatenates every
 * workspace `package.json`, so one name appears once per declaring package with
 * that package's own spec — `typescript` arrives as BOTH the root's `^5.7.2` and
 * a workspace package's `^5.4.0`, and a package used only by a workspace
 * (`ecc-universal`) appears with no root declaration at all. Taking the first row
 * records whichever specifier sorts first, which is the workspace's, not the
 * project's. peaks-rd cross-checks this map against the breaking-changes table,
 * and a floor is exactly the wrong version to file a project under.
 *
 * Split out of `project-scan-field-refresh.ts` to stay under the `src/**`
 * 300-line cap.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The `package.json` scopes a dependency can be declared in. */
const DEPENDENCY_SCOPES = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies'
] as const;

/** A parsed `package.json` that carries dependency maps, or `null`. */
function isDependencyRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Parse the root manifest. Returns `undefined` when it cannot be used — absent,
 * unreadable, or not a JSON object.
 *
 * The catch does not RETURN the failure value: it records the failure in a
 * variable and falls off the end, so the "cannot tell" answer is written once,
 * at the call site, rather than disguised as a successful `return null`.
 */
function parseManifest(projectRoot: string): Record<string, unknown> | undefined {
  const manifestPath = join(projectRoot, 'package.json');
  if (!existsSync(manifestPath)) return undefined;
  let raw: string | undefined;
  try {
    raw = readFileSync(manifestPath, 'utf8');
  } catch {
    raw = undefined;
  }
  if (raw === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  return isDependencyRecord(parsed) ? parsed : undefined;
}

/**
 * The root manifest's own dependency map: name → specifier, across every scope.
 *
 * THE ROOT MANIFEST IS THE SOURCE OF THE SPECIFIER, not the scan's row order.
 * This used to be built by taking the first row `scanLibraries` emitted for each
 * name, on the assumption the root sorts first. That assumption is false for any
 * workspace glob outside `packages/*` — `apps/*` and `libs/*` sort a workspace
 * package ahead of the root — so a project pinning `typescript ^5.7.2` recorded
 * the workspace's `^5.4.0` instead. Measured 2026-11-16. Reading the manifest
 * directly removes the ordering dependency entirely: whichever rows exist, the
 * recorded specifier is the one the project itself declares.
 *
 * `null` means "cannot tell" — the manifest is absent, is not a JSON object, or
 * could not be read — and the caller then falls back to the raw scan instead of
 * emptying the map. A malformed manifest therefore degrades the same way a
 * missing one does; it does not throw out of a refresh nobody explicitly asked
 * for.
 */
export function rootDeclaredVersions(projectRoot: string): Map<string, string> | null {
  const parsed = parseManifest(projectRoot);
  if (parsed === undefined) return null;
  const versions = new Map<string, string>();
  for (const scope of DEPENDENCY_SCOPES) {
    const deps = parsed[scope];
    if (!isDependencyRecord(deps)) continue;
    for (const [name, spec] of Object.entries(deps)) {
      // A scope earlier in DEPENDENCY_SCOPES wins, matching package.json's own
      // precedence (a real `dependency` is what the project installs).
      if (!versions.has(name) && typeof spec === 'string') versions.set(name, spec);
    }
  }
  return versions;
}

/**
 * The names the project's OWN `package.json` declares, across every scope.
 * See `rootDeclaredVersions` for what `null` means.
 */
export function rootDeclaredNames(projectRoot: string): Set<string> | null {
  const versions = rootDeclaredVersions(projectRoot);
  return versions === null ? null : new Set(versions.keys());
}

/**
 * Keep one row per name, and only for names the root manifest declares — a name
 * only a workspace package declares is dropped, because the file describes the
 * project and listing a dependency it does not have is a fact peaks-rd would then
 * check against the wrong thing.
 */
export function toLibraryVersions(
  entries: ReadonlyArray<{ readonly name: string; readonly version: string }>,
  rootDeclared: ReadonlySet<string>
): Record<string, string> {
  const versions: Record<string, string> = {};
  for (const entry of entries) {
    if (!rootDeclared.has(entry.name)) continue;
    if (versions[entry.name] === undefined) versions[entry.name] = entry.version;
  }
  return versions;
}

/**
 * The map for a project.
 *
 * The ROOT MANIFEST supplies the specifier for every name it declares; the scan
 * supplies only the row set. When the manifest cannot be read, the scan's own
 * rows are used unchanged (never silently empties the map).
 */
export function libraryVersionsFor(
  projectRoot: string,
  entries: ReadonlyArray<{ readonly name: string; readonly version: string }>
): Record<string, string> {
  const declared = rootDeclaredVersions(projectRoot);
  if (declared === null) {
    return toLibraryVersions(entries, new Set(entries.map((e) => e.name)));
  }
  const versions: Record<string, string> = {};
  for (const [name, spec] of declared) versions[name] = spec;
  return versions;
}
