/**
 * Markup import closure for the S7 audit (Task 5).
 *
 * The states detector must see a child component that holds the empty state the
 * page itself never spells out. The spike measured 1886 imports pointing at 101
 * component modules the single-file scan never opens, so this reader follows a
 * page's RELATIVE script imports to a bound and reports what it could not
 * follow:
 *
 *   - a package or path-alias specifier (`@/components/x`) is named in
 *     `skipped`, never silently treated as "nothing imported";
 *   - a stylesheet / asset specifier is not this reader's to resolve (the CSS
 *     reader owns stylesheets), so it is skipped without a gap entry;
 *   - `maxFiles` stops the walk and sets `truncated`, which the project reader
 *     folds into the report's read gaps;
 *   - a symlink that resolves outside the app root is skipped and named in
 *     `escapes`, and a source past `MAX_SOURCE_BYTES` is a named gap.
 *
 * Only script/markup extensions are followed. A `.json` / `.svg` import is not
 * a module whose rendering can carry an empty state.
 *
 * PATH ALIASES ARE FOLLOWED TOO (Task 6c). The pilot had 3,465 `@/…` imports
 * the reader never opened, which hid the empty state, the page title and the
 * clickable span behind every feature's `@/components/**`. The alias table is
 * read from the project's tsconfig (`readPathAliases`) and applied here; an
 * alias that names no file on disk is an ALIAS GAP (`aliasGaps`), counted by
 * the project reader, while an unmatched specifier stays an ordinary package
 * import. Test modules are never followed — a mock's text is not the product's.
 */

import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';

import { isInsidePath, normalizePath } from '../../../shared/path-utils.js';
import type { AuditSource } from './audit-finding.js';
import { aliasBase, type PathAlias } from './path-aliases.js';
import { createSourceCache, MAX_SOURCE_BYTES, type SourceCache } from './source-cache.js';
import { isTestFile } from './source-filters.js';

/**
 * The closure bound (Task 6e). The old 100 truncated 44 of the pilot's 77 pages,
 * hiding most of the components the value dimensions need; 400 covers the real
 * closure while still bounding a pathological import graph.
 */
export const DEFAULT_MAX_IMPORTS = 400;

/** Extensions the closure can read as a module. */
const SCRIPT_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.vue',
  '.svelte'
] as const;

/** ESM / CommonJS / dynamic imports, capturing the specifier in one of three groups. */
const IMPORT_SPECIFIER =
  /\b(?:import|export)\s+(?:[^'"]*?\bfrom\s+)?["']([^"']+)["']|\brequire\s*\(\s*["']([^"']+)["']\s*\)|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

export type ImportClosureInput = {
  /** Absolute application root; every reported path is relative to it. */
  appRoot: string;
  /** App-relative path of the page whose imports are followed. */
  file: string;
  /** The page's own source, so the seed is never re-read from disk. */
  source: string;
  /** The project's declared path aliases; absent means "none declared". */
  aliases?: readonly PathAlias[];
  /** Upper bound on imported modules; the default keeps the walk bounded. */
  maxFiles?: number;
  /** The per-run source cache; absent means this call owns a private one. */
  cache?: SourceCache;
};

/** What a page's import closure contributed to the audit. */
export type ImportClosure = {
  /** Imported markup/script sources, app-relative and sorted. */
  sources: AuditSource[];
  /** Imports this reader could not follow, named for the report. */
  skipped: string[];
  /** Alias imports whose target path does not exist; the reader's alias gaps. */
  aliasGaps: string[];
  /** Symlinks whose real target is outside the app root; skipped, never read. */
  escapes: string[];
  /** True when `maxFiles` stopped the walk before the closure was exhausted. */
  truncated: boolean;
};

function specifiersOf(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(IMPORT_SPECIFIER)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (specifier !== undefined && !specifiers.includes(specifier)) specifiers.push(specifier);
  }
  return specifiers;
}

/** A specifier this reader may follow: extension-less, or a script extension. */
function looksLikeCode(specifier: string): boolean {
  const extension = extname(specifier).toLowerCase();
  return extension === '' || (SCRIPT_EXTENSIONS as readonly string[]).includes(extension);
}

/** The app-relative path of an absolute file, or null when it escapes the app. */
function toAppPath(appRoot: string, absolute: string): string | null {
  const rel = relative(appRoot, absolute);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  return normalizePath(rel);
}

/**
 * The files a specifier may name. An extension-less import tries every script
 * extension and an `index` file. A TypeScript-ESM project imports the EMITTED
 * name (`./RowList.js`) while the source on disk is `.ts` / `.tsx`, so a script
 * extension fallback is tried after the literal path.
 */
function candidatePaths(base: string): string[] {
  if (extname(base) === '') {
    return SCRIPT_EXTENSIONS.flatMap((extension) => [
      base + extension,
      join(base, `index${extension}`)
    ]);
  }
  const extension = extname(base).toLowerCase();
  if (extension === '.js' || extension === '.jsx' || extension === '.mjs' || extension === '.cjs') {
    const stem = base.slice(0, -extension.length);
    return [base, ...SCRIPT_EXTENSIONS.map((script) => stem + script)];
  }
  return [base];
}

/** Where one specifier lands: a file, an alias gap, or a package. */
type Resolution = { kind: 'file'; file: string } | { kind: 'alias-gap' } | { kind: 'package' };

/** The real containment resolver one closure walk threads through. */
type Lookup = {
  appRoot: string;
  aliases: readonly PathAlias[];
  cache: SourceCache;
  escapes: string[];
};

/**
 * The first candidate that exists inside the app root and is not a test file.
 *
 * Containment is decided on the REAL path: a candidate that is lexically inside
 * but resolves through a symlink to outside the root is skipped and named in
 * `escapes`, so the report says why a module was not read instead of silently
 * following it out of the app (Task 6e).
 */
function firstExisting(lookup: Lookup, candidates: readonly string[]): string | null {
  for (const candidate of candidates) {
    if (!isInsidePath(resolve(candidate), lookup.appRoot)) continue;
    const located = lookup.cache.locate(candidate);
    if (located.kind === 'missing') continue;
    if (located.kind === 'escapes') {
      lookup.escapes.push(`${located.file} (symlink escapes app root)`);
      continue;
    }
    const appPath = toAppPath(lookup.appRoot, candidate);
    if (appPath !== null && !isTestFile(appPath)) return appPath;
  }
  return null;
}

/** A relative import resolved to an app path, or null when no candidate exists. */
function resolveRelative(lookup: Lookup, file: string, specifier: string): string | null {
  const base = resolve(lookup.appRoot, dirname(file), specifier);
  return firstExisting(lookup, candidatePaths(base));
}

function resolveSpecifier(lookup: Lookup, file: string, specifier: string): Resolution {
  if (specifier.startsWith('.')) {
    const target = resolveRelative(lookup, file, specifier);
    return target === null ? { kind: 'package' } : { kind: 'file', file: target };
  }
  const base = aliasBase(specifier, lookup.aliases);
  if (base === null) return { kind: 'package' };
  const target = firstExisting(lookup, candidatePaths(resolve(lookup.appRoot, base)));
  return target === null ? { kind: 'alias-gap' } : { kind: 'file', file: target };
}

/** A source read through the run cache; a non-read is a named gap. */
function readSource(cache: SourceCache, file: string, closure: ImportClosure): AuditSource | null {
  const read = cache.read(file);
  if (read.kind === 'read') return read.source;
  if (read.kind === 'oversize') {
    closure.skipped.push(`${read.file} (larger than ${MAX_SOURCE_BYTES} bytes)`);
  } else if (read.kind === 'escapes') {
    closure.escapes.push(`${read.file} (symlink escapes app root)`);
  } else {
    closure.skipped.push(`${file} (unreadable)`);
  }
  return null;
}

/** The state one closure walk shares across its pending queue. */
type ClosureWalk = Lookup & {
  closure: ImportClosure;
  pending: string[];
  visited: Set<string>;
};

/** Resolve one source's specifiers and queue every file it names. */
function enqueueSpecifiers(walk: ClosureWalk, file: string, source: string): void {
  for (const specifier of specifiersOf(source)) {
    if (!looksLikeCode(specifier)) continue;
    const resolution = resolveSpecifier(walk, file, specifier);
    if (resolution.kind === 'package') {
      walk.closure.skipped.push(`${file} -> ${specifier} (not followed)`);
      continue;
    }
    if (resolution.kind === 'alias-gap') {
      walk.closure.aliasGaps.push(`alias ${file} -> ${specifier} (no matching path)`);
      continue;
    }
    if (!walk.visited.has(resolution.file)) walk.pending.push(resolution.file);
  }
}

/** Read queued modules until the queue empties or `maxFiles` stops the walk. */
function drainPending(walk: ClosureWalk, maxFiles: number): void {
  while (walk.pending.length > 0) {
    if (walk.closure.sources.length >= maxFiles) {
      walk.closure.truncated = true;
      return;
    }
    const file = walk.pending.shift();
    if (file === undefined || walk.visited.has(file)) continue;
    walk.visited.add(file);
    const read = readSource(walk.cache, file, walk.closure);
    if (read === null) continue;
    walk.closure.sources.push(read);
    enqueueSpecifiers(walk, file, read.source);
  }
}

/** Follow a page's imports, bounded, recording every gap it leaves. */
export function readImportClosure(input: ImportClosureInput): ImportClosure {
  const appRoot = resolve(input.appRoot);
  const closure: ImportClosure = {
    sources: [],
    skipped: [],
    aliasGaps: [],
    escapes: [],
    truncated: false
  };
  const walk: ClosureWalk = {
    appRoot,
    aliases: input.aliases ?? [],
    cache: input.cache ?? createSourceCache(appRoot),
    escapes: closure.escapes,
    closure,
    pending: [],
    visited: new Set<string>([input.file])
  };
  enqueueSpecifiers(walk, input.file, input.source);
  drainPending(walk, input.maxFiles ?? DEFAULT_MAX_IMPORTS);
  closure.sources.sort((left, right) => left.file.localeCompare(right.file));
  closure.skipped = [...new Set(closure.skipped)];
  closure.aliasGaps = [...new Set(closure.aliasGaps)];
  closure.escapes = [...new Set(closure.escapes)];
  return closure;
}
