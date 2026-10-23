#!/usr/bin/env node
//
// The canonical store's FILESYSTEM vocabulary: how a path is identified, and how
// two trees are compared.
//
// Split out of `scripts/canonical-store.mjs` (the b1 file-size campaign): the
// store's own file was one line under the 300-line cap, and the version-aware
// staleness decision did not fit beside it. Every line below was moved
// VERBATIM; only this header and the import block are new.
//
// TWO CONCERNS, ONE FILE. They are here together because they are the two
// questions the store asks about the disk, and both of them are about IDENTITY
// rather than about policy:
//
//   1. IDENTITY — `linkResolvesTo` decides whether two paths are the same
//      directory. It goes through `realpath`, strips the `\\?\` long-path
//      prefix and folds case on Windows, so a trailing separator, a case
//      difference or a long-path spelling cannot make one directory look like
//      two. A path that does not resolve claims nothing.
//
//   2. EQUALITY — `contentMatches` is the byte-for-byte comparison of a source
//      and the store's copy. It is what makes the copy idempotent, and it is
//      the SECOND half of the staleness decision: the first half is the
//      version the copy was made from, which lives with the marker.

import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

export function getPathStats(path) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

/** `\\?\C:\x` and `\\?\UNC\srv\share` are spellings of a path, not other paths. */
export function stripLongPathPrefix(value) {
  const uncPrefix = '\\\\?\\UNC\\';
  if (value.startsWith(uncPrefix)) return `\\\\${value.slice(uncPrefix.length)}`;
  const prefix = '\\\\?\\';
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

/**
 * The real, resolved, case-folded identity of a path, or null when it does not
 * resolve (a dangling junction included).
 */
export function resolveIdentity(path) {
  let resolved;
  try {
    resolved = realpathSync(path);
  } catch {
    return null;
  }
  const normalized = stripLongPathPrefix(resolved);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/**
 * Whether `linkPath` resolves to the same directory as `expectedPath`. Both sides
 * go through `realpath`, so a `\\?\` prefix, a `.` segment or a case difference
 * cannot make one directory look like two.
 */
export function linkResolvesTo(linkPath, expectedPath) {
  const actual = resolveIdentity(linkPath);
  const expected = resolveIdentity(expectedPath);
  return actual !== null && expected !== null && actual === expected;
}

/** Every file and directory under `rootPath`, as sorted `/`-joined relative paths. */
function listTreeEntries(rootPath) {
  const entries = [];
  const walk = (dir, prefix) => {
    for (const name of readdirSync(dir).sort()) {
      const relativePath = prefix === '' ? name : `${prefix}/${name}`;
      const stats = lstatSync(join(dir, name));
      if (stats.isDirectory()) {
        entries.push(`${relativePath}/`);
        walk(join(dir, name), relativePath);
      } else if (stats.isFile()) {
        entries.push(relativePath);
      } else {
        throw new Error(
          `Peaks canonical store cannot read ${join(dir, name)}: not a file or directory`
        );
      }
    }
  };
  walk(rootPath, '');
  return entries;
}

/** True when `targetPath` already holds exactly the bytes `sourcePath` holds. */
export function contentMatches(sourcePath, targetPath) {
  const targetStats = getPathStats(targetPath);
  if (!targetStats || targetStats.isSymbolicLink()) return false;
  if (!targetStats.isDirectory()) {
    return targetStats.isFile() && readFileSync(sourcePath).equals(readFileSync(targetPath));
  }
  const sourceEntries = listTreeEntries(sourcePath);
  const targetEntries = listTreeEntries(targetPath);
  if (sourceEntries.length !== targetEntries.length) return false;
  for (let index = 0; index < sourceEntries.length; index += 1) {
    if (sourceEntries[index] !== targetEntries[index]) return false;
    if (sourceEntries[index].endsWith('/')) continue;
    const from = join(sourcePath, sourceEntries[index]);
    const to = join(targetPath, targetEntries[index]);
    if (!readFileSync(from).equals(readFileSync(to))) return false;
  }
  return true;
}
