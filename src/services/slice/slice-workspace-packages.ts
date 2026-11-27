/**
 * Workspace package resolution for the slice decomposition dependency graph.
 *
 * Cross-package coupling is written as a bare import specifier, which the
 * import-edge scan used to discard before it ever reached the graph. Turning
 * one into a scheduling edge needs two facts this module provides: the package
 * a specifier names, and the source file that can stand for that package.
 *
 * Discovery mirrors the manifest sources the project scan service reads — the
 * `packages:` list in `pnpm-workspace.yaml`, then the root `package.json`
 * `workspaces` field — so a monorepo is labelled the same way in both places.
 * The helpers are reimplemented here rather than reached into because the slice
 * service does not depend on the scan service's private functions.
 *
 * Every manifest that cannot be used is reported through `reasons`. A package
 * with no resolvable entry source file stays in the map with `entryFile: null`
 * so the caller can say why a bare import produced no edge.
 */

import { existsSync, readdirSync, readFileSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import { isInsidePath, normalizePath } from '../../shared/path-utils.js';

interface PackageManifest {
  readonly name?: unknown;
  readonly main?: unknown;
  readonly exports?: unknown;
  readonly dependencies?: unknown;
  readonly devDependencies?: unknown;
  readonly workspaces?: unknown;
}

export interface WorkspacePackage {
  readonly name: string;
  /** Project-relative directory, POSIX separators; `.` for the root package. */
  readonly dir: string;
  /** Project-relative entry source file, or null when none could be resolved. */
  readonly entryFile: string | null;
  /** Workspace package names this package declares a dependency on. */
  readonly dependencyNames: readonly string[];
}

export interface WorkspaceLoadOptions {
  /** Receives one line per manifest or directory that could not be used. */
  readonly reasons?: string[];
}

type TextRead = { readonly text: string } | { readonly error: string };
type ManifestRead = { readonly manifest: PackageManifest } | { readonly error: string };

function readText(path: string): TextRead {
  try {
    return { text: readFileSync(path, 'utf8') };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

function readManifest(path: string): ManifestRead {
  const read = readText(path);
  if ('error' in read) return read;
  try {
    return { manifest: JSON.parse(read.text) as PackageManifest };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

function readEntries(path: string, reasons: string[]): Dirent[] {
  try {
    return readdirSync(path, { withFileTypes: true });
  } catch (error) {
    reasons.push(`workspace directory ${path} could not be read: ${(error as Error).message}`);
    return [];
  }
}

/** The `packages:` list of `pnpm-workspace.yaml`; top-level key only. */
function parsePnpmWorkspacePackages(raw: string): string[] {
  const globs: string[] = [];
  let inList = false;
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').replace(/\s+$/, '');
    if (!inList) {
      if (/^packages:\s*$/.test(line)) inList = true;
      continue;
    }
    if (line.trim().length === 0) continue;
    const item = /^\s*-\s+(['"]?)(.+?)\1\s*$/.exec(line);
    if (item?.[2] === undefined) break;
    globs.push(item[2]);
  }
  return globs;
}

function workspaceGlobs(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (value !== null && typeof value === 'object') {
    return workspaceGlobs((value as { packages?: unknown }).packages);
  }
  return [];
}

function hasManifest(projectRoot: string, dir: string): boolean {
  return existsSync(join(projectRoot, dir, 'package.json'));
}

/** Expand one workspace glob into project-relative package directories. */
function expandGlob(projectRoot: string, glob: string, reasons: string[]): string[] {
  const segments = glob
    .replace(/^\.\//, '')
    .replace(/\/+$/, '')
    .split('/')
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) return ['.'];

  const wildcards = segments.filter((segment) => segment === '*').length;
  const dir = segments.join('/');
  if (wildcards === 0) return hasManifest(projectRoot, dir) ? [dir] : [];
  if (wildcards > 1 || segments[segments.length - 1] !== '*') {
    reasons.push(`workspace glob "${glob}" has a shape this resolver does not expand; skipped`);
    return [];
  }

  const parentSegments = segments.slice(0, -1);
  return readEntries(join(projectRoot, ...parentSegments), reasons)
    .filter((entry) => {
      const child = [...parentSegments, entry.name].join('/');
      return entry.isDirectory() && hasManifest(projectRoot, child);
    })
    .map((entry) => [...parentSegments, entry.name].join('/'));
}

function discoverPackageDirs(projectRoot: string, reasons: string[]): string[] {
  const pnpmPath = join(projectRoot, 'pnpm-workspace.yaml');
  if (existsSync(pnpmPath)) {
    const read = readText(pnpmPath);
    if ('error' in read) {
      reasons.push(`pnpm-workspace.yaml could not be read: ${read.error}`);
    } else {
      const globs = parsePnpmWorkspacePackages(read.text);
      if (globs.length > 0) {
        return [...new Set(globs.flatMap((glob) => expandGlob(projectRoot, glob, reasons)))].sort();
      }
    }
  }

  const rootManifestPath = join(projectRoot, 'package.json');
  if (!existsSync(rootManifestPath)) return [];
  const root = readManifest(rootManifestPath);
  if ('error' in root) {
    reasons.push(`root package.json could not be read: ${root.error}`);
    return [];
  }
  const globs = workspaceGlobs(root.manifest.workspaces);
  return [...new Set(globs.flatMap((glob) => expandGlob(projectRoot, glob, reasons)))].sort();
}

function declaredDependencies(manifest: PackageManifest): string[] {
  const names = new Set<string>();
  for (const field of ['dependencies', 'devDependencies'] as const) {
    const block = manifest[field];
    if (block === null || typeof block !== 'object' || Array.isArray(block)) continue;
    for (const name of Object.keys(block)) names.add(name);
  }
  return [...names];
}

/** Collect the string leaves of a `main` / `exports` value, in declaration order. */
function collectEntryStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectEntryStrings(item, out);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  if (record['.'] !== undefined) {
    collectEntryStrings(record['.'], out);
    return;
  }
  for (const item of Object.values(record)) collectEntryStrings(item, out);
}

/** A declared entry path as a TypeScript source path, or null when it is a type stub. */
function sourcePathOf(path: string): string | null {
  const normalized = normalizePath(path).replace(/^\.\//, '');
  if (normalized.endsWith('.d.ts')) return null;
  return normalized.replace(/\.jsx$/, '.tsx').replace(/\.js$/, '.ts');
}

/**
 * The one-file fallback: a package small enough to hold exactly one non-test
 * source file has an unambiguous entry. Two or more candidates are ambiguous,
 * and guessing would put the edge on a file the change may not touch.
 */
function singleSourceEntry(projectRoot: string, dir: string, reasons: string[]): string | null {
  const entries = readEntries(join(projectRoot, dir, 'src'), reasons).filter(
    (entry) =>
      entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.(?:d|test|spec)\.tsx?$/.test(entry.name)
  );
  const [entry] = entries;
  if (entries.length !== 1 || entry === undefined) return null;
  return normalizePath(join(dir, 'src', entry.name));
}

function entryFileFor(
  projectRoot: string,
  dir: string,
  manifest: PackageManifest,
  reasons: string[]
): string | null {
  const declared: string[] = [];
  collectEntryStrings(manifest.main, declared);
  collectEntryStrings(manifest.exports, declared);
  declared.push('src/index.ts', 'src/index.tsx');
  for (const candidate of declared) {
    const source = sourcePathOf(candidate);
    if (source !== null && existsSync(join(projectRoot, dir, source))) {
      return normalizePath(join(dir, source));
    }
  }
  return singleSourceEntry(projectRoot, dir, reasons);
}

export function loadWorkspacePackages(
  projectRoot: string,
  options: WorkspaceLoadOptions = {}
): readonly WorkspacePackage[] {
  const reasons = options.reasons ?? [];
  const packages: WorkspacePackage[] = [];
  for (const dir of discoverPackageDirs(projectRoot, reasons)) {
    const manifestPath = normalizePath(join(dir, 'package.json'));
    const read = readManifest(join(projectRoot, dir, 'package.json'));
    if ('error' in read) {
      reasons.push(`${manifestPath} could not be read as JSON: ${read.error}`);
      continue;
    }
    const { name } = read.manifest;
    if (typeof name !== 'string' || name.length === 0) {
      reasons.push(`${manifestPath} has no package name; skipped as a workspace package`);
      continue;
    }
    packages.push({
      name,
      dir: normalizePath(dir),
      entryFile: entryFileFor(projectRoot, dir, read.manifest, reasons),
      dependencyNames: declaredDependencies(read.manifest)
    });
  }
  return packages;
}

/** The package name a bare specifier names (`@scope/pkg/sub` -> `@scope/pkg`). */
export function packageNameOfSpecifier(specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) {
    return null;
  }
  const segments = specifier.split('/').filter((segment) => segment.length > 0);
  if (specifier.startsWith('@')) {
    return segments.length >= 2 ? `${segments[0]}/${segments[1]}` : null;
  }
  return segments[0] ?? null;
}

/** The deepest workspace package whose directory contains `file`. */
export function ownerPackageFor(
  packages: readonly WorkspacePackage[],
  file: string,
  projectRoot: string
): WorkspacePackage | null {
  const absoluteFile = join(projectRoot, file);
  let owner: WorkspacePackage | null = null;
  for (const pkg of packages) {
    if (!isInsidePath(absoluteFile, join(projectRoot, pkg.dir))) continue;
    if (owner === null || pkg.dir.length > owner.dir.length) owner = pkg;
  }
  return owner;
}
