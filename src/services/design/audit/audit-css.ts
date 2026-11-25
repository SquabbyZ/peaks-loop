/**
 * Stylesheet reader for the S7 audit (Task 3b): `.css` and `.scss` files under
 * the paved road's page roots, plus their relative `@import` / `@use` /
 * `@forward` closure.
 *
 * `.css` stays OUT of the G1 scannable extension set: nothing here changes what
 * `design check` judges. This reader exists because the audit cannot see the
 * ladder it judges otherwise — 83 % of the pilot's spacing values resolve only
 * through custom properties defined in stylesheets the G1 scan never opens.
 *
 * The read is bounded (`maxFiles`) and reports what it could not read: an
 * import outside the app root, a package import (`@use 'sass:math'`), or a
 * stylesheet past the bound is named in `skipped`, never silently dropped.
 */

import { basename, dirname, join, resolve } from 'node:path';

import { isInsidePath } from '../../../shared/path-utils.js';
import type { AuditSource } from './audit-finding.js';
import { parseCss, type CssDeclaration, type ParsedCss } from './css-blocks.js';
import { seedFiles, toAppPath } from './css-walk.js';
import {
  buildVariableTable,
  type CssVariableDefinition,
  type CssVariableTable
} from './css-variables.js';
import { MAX_SOURCE_BYTES, createSourceCache, type SourceCache } from './source-cache.js';

export type { CssDeclaration } from './css-blocks.js';
export type { CssVariableDefinition, CssVariableTable } from './css-variables.js';

export type CssProjectInput = {
  /** Absolute application root; every reported path is relative to it. */
  appRoot: string;
  /** App-relative roots the audit walks for stylesheets. */
  pageRoots: readonly string[];
  /** `paved-road.json` exclude entries, matched the way the scan matches them. */
  exclude?: readonly string[];
  /** Upper bound on stylesheets read; the default keeps the walk bounded. */
  maxFiles?: number;
  /** The per-run source cache; absent means this call owns a private one. */
  cache?: SourceCache;
};

/** What a project's stylesheets contribute to the audit. */
export type CssProject = {
  /** The stylesheet texts; the detectors strip comments again themselves. */
  sources: AuditSource[];
  declarations: CssDeclaration[];
  variables: CssVariableTable;
  /** Imports / files this reader could not follow, named for the report. */
  skipped: string[];
  /** True when maxFiles stopped the walk before the closure was exhausted. */
  truncated: boolean;
};

type Closure = {
  sources: AuditSource[];
  declarations: CssDeclaration[];
  variables: CssVariableDefinition[];
  skipped: string[];
  truncated: boolean;
};

const DEFAULT_MAX_FILES = 200;

/**
 * The first candidate that exists inside the app root, as an app path.
 *
 * Containment is decided on the REAL path (Task 6e): a symlink that resolves
 * outside the root is skipped and named in `skipped`, so the report says why the
 * stylesheet was not read instead of following it out of the app.
 */
function firstExisting(
  appRoot: string,
  candidates: readonly string[],
  cache: SourceCache,
  skipped: string[]
): string | null {
  for (const candidate of candidates) {
    if (!isInsidePath(resolve(candidate), resolve(appRoot))) continue;
    const located = cache.locate(candidate);
    if (located.kind === 'missing') continue;
    if (located.kind === 'escapes') {
      skipped.push(`${located.file} (symlink escapes app root)`);
      continue;
    }
    const appPath = toAppPath(appRoot, candidate);
    if (appPath !== null) return appPath;
  }
  return null;
}

/**
 * A relative stylesheet import resolved to an app path. Sass partials
 * (`_tokens.scss`) and extension-less specifiers (`@use '../styles/tokens'`)
 * are tried; a package or alias specifier is not this reader's to resolve.
 */
function resolveStylesheetImport(
  appRoot: string,
  file: string,
  specifier: string,
  sink: { cache: SourceCache; skipped: string[] }
): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = resolve(appRoot, dirname(file), specifier);
  return firstExisting(
    appRoot,
    [base, `${base}.css`, `${base}.scss`, join(dirname(base), `_${basename(base)}.scss`)],
    sink.cache,
    sink.skipped
  );
}

type ReadStylesheet = { source: AuditSource; parsed: ParsedCss } | null;

function readStylesheet(file: string, cache: SourceCache, skipped: string[]): ReadStylesheet {
  const read = cache.read(file);
  if (read.kind === 'oversize') {
    skipped.push(`${read.file} (larger than ${MAX_SOURCE_BYTES} bytes)`);
    return null;
  }
  if (read.kind === 'escapes') {
    skipped.push(`${read.file} (symlink escapes app root)`);
    return null;
  }
  if (read.kind === 'missing') {
    skipped.push(`${file} (unreadable)`);
    return null;
  }
  return { source: read.source, parsed: parseCss(read.source.file, read.source.source) };
}

/** The walk state an import is resolved against. */
type ImportContext = {
  appRoot: string;
  file: string;
  pending: string[];
  visited: ReadonlySet<string>;
  skipped: string[];
  cache: SourceCache;
};

function enqueueImport(context: ImportContext, specifier: string): void {
  const target = resolveStylesheetImport(context.appRoot, context.file, specifier, {
    cache: context.cache,
    skipped: context.skipped
  });
  if (target === null) {
    context.skipped.push(`${context.file} -> ${specifier} (not followed)`);
    return;
  }
  if (!context.visited.has(target)) context.pending.push(target);
}

/** Walk the seeds and their import closure, bounded by `maxFiles`. */
function readClosure(
  appRoot: string,
  seeds: string[],
  maxFiles: number,
  cache: SourceCache
): Closure {
  const closure: Closure = {
    sources: [],
    declarations: [],
    variables: [],
    skipped: [],
    truncated: false
  };
  const pending = [...seeds];
  const visited = new Set<string>();
  while (pending.length > 0) {
    if (visited.size >= maxFiles) {
      closure.truncated = true;
      break;
    }
    const file = pending.shift();
    if (file === undefined || visited.has(file)) continue;
    visited.add(file);
    const read = readStylesheet(file, cache, closure.skipped);
    if (read === null) continue;
    closure.sources.push(read.source);
    closure.declarations.push(...read.parsed.declarations);
    closure.variables.push(...read.parsed.variables);
    for (const specifier of read.parsed.imports) {
      enqueueImport(
        { appRoot, file, pending, visited, skipped: closure.skipped, cache },
        specifier
      );
    }
  }
  return closure;
}

function sortDeclarations(declarations: CssDeclaration[]): CssDeclaration[] {
  return [...declarations].sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.line - right.line ||
      left.property.localeCompare(right.property)
  );
}

/**
 * Read the project's stylesheets and their relative import closure. Page roots
 * are walked; an import may pull a file from outside them (a shared
 * `styles/tokens.scss`), because that is exactly where a legacy ladder lives.
 */
export function readCssProject(input: CssProjectInput): CssProject {
  const appRoot = resolve(input.appRoot);
  const cache = input.cache ?? createSourceCache(appRoot);
  const seeds = seedFiles(appRoot, input.pageRoots, input.exclude ?? []);
  const closure = readClosure(appRoot, seeds, input.maxFiles ?? DEFAULT_MAX_FILES, cache);
  closure.sources.sort((left, right) => left.file.localeCompare(right.file));
  closure.variables.sort(
    (left, right) => left.file.localeCompare(right.file) || left.line - right.line
  );
  return {
    sources: closure.sources,
    declarations: sortDeclarations(closure.declarations),
    variables: buildVariableTable(closure.variables),
    skipped: closure.skipped,
    truncated: closure.truncated
  };
}
