/**
 * The stylesheet SEED walk for the S7 audit, split from `audit-css.ts` when the
 * Task 6e containment work crossed the module ceiling.
 *
 * This module only finds the stylesheets a page root contains. Reading them,
 * following their imports and building the variable table stay in
 * `audit-css.ts`. The walk is bounded by the caller's extension set, skips
 * installed/generated trees, and drops any path that escapes the app root.
 */

import { existsSync, readdirSync, type Dirent } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';

import { isInsidePath, normalizePath } from '../../../shared/path-utils.js';
import { isExcluded } from '../source-scan/inputs.js';
import { isTestFile } from './source-filters.js';

const STYLESHEET_EXTENSIONS = new Set(['.css', '.scss']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next']);

/** Normalise a page root the way the G1 scan normalises its `pageRoots`. */
function normalizeRoot(root: string): string {
  return normalizePath(root.trim())
    .replace(/^(?:\.\/)+/, '')
    .replace(/\/+$/, '');
}

/** The app-relative path of an absolute file, or null when it escapes the app. */
export function toAppPath(appRoot: string, absolute: string): string | null {
  const rel = relative(resolve(appRoot), absolute);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  return normalizePath(rel);
}

function readEntries(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function isTraversable(entry: Dirent): boolean {
  return entry.isDirectory() && !SKIP_DIRS.has(entry.name);
}

function isStylesheet(entry: Dirent): boolean {
  return entry.isFile() && STYLESHEET_EXTENSIONS.has(extname(entry.name).toLowerCase());
}

/** Every stylesheet under one root, depth-first; unreadable dirs are skipped. */
function walkStylesheets(appRoot: string, root: string): string[] {
  const start = resolve(appRoot, root);
  if (!isInsidePath(start, resolve(appRoot)) || !existsSync(start)) return [];
  const files: string[] = [];
  const pending = [start];
  while (pending.length > 0) {
    const dir = pending.pop();
    if (dir === undefined) continue;
    for (const entry of readEntries(dir)) {
      if (isTraversable(entry)) {
        pending.push(join(dir, entry.name));
      } else if (isStylesheet(entry)) {
        const appPath = toAppPath(appRoot, join(dir, entry.name));
        if (appPath !== null) files.push(appPath);
      }
    }
  }
  return files;
}

/** The stylesheet texts named by the page roots, deduplicated and sorted. */
export function seedFiles(
  appRoot: string,
  pageRoots: readonly string[],
  exclude: readonly string[]
): string[] {
  const seeds: string[] = [];
  for (const root of pageRoots) {
    for (const file of walkStylesheets(appRoot, normalizeRoot(root))) {
      // A test stylesheet is not the product's ladder (Task 6c): scoring it
      // would let a fixture's off-ladder padding become a page defect.
      if (!isExcluded(file, exclude) && !isTestFile(file)) seeds.push(file);
    }
  }
  return [...new Set(seeds)].sort((left, right) => left.localeCompare(right));
}
