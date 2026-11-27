/**
 * Writing the graph: an entry (and the measured document behind it) is
 * serialized and bound-checked before any file is touched, the batch is staged
 * as temp files and renamed into place, and both indexes are rebuilt once. A
 * batch refused before the rename leaves no entry and no capture behind. A
 * rename that fails part-way can leave entries on disk: the indexes are then
 * either rebuilt from what landed or removed, so a reader falls back to the
 * entries instead of trusting a stale index.
 */
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { serializeEntry } from './layout-graph-ascii.js';
import type { LayoutEntry } from './layout-graph.js';
import { writeIndex } from './layout-graph-index.js';
import { TOKEN_INDEX_FILE, writeTokenIndex } from './layout-graph-token-index.js';
import {
  INDEX_FILE,
  capturePath,
  coveragePath,
  entryPath,
  graphRoot,
  keyRefusal,
  type EntryKey,
  type RouteCoverage,
  type StoreWrite
} from './layout-graph-paths.js';

// eslint-disable-next-line no-magic-numbers -- the entry bound is a declared contract: eight kibibytes.
export const MAX_ENTRY_BYTES = 8 * 1024;

type Prepared = { path: string; temp: string; text: string };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Why one entry cannot be written, or the bytes and paths it will land at. */
function prepareEntry(
  projectRoot: string,
  entry: LayoutEntry
): { ok: true; prepared: Prepared } | { ok: false; reason: string } {
  const refusal = keyRefusal(entry);
  if (refusal !== null) return { ok: false, reason: refusal };
  const ascii = serializeEntry(entry);
  if (!ascii.ok) return { ok: false, reason: ascii.reason };
  const bytes = Buffer.byteLength(ascii.text, 'utf8');
  if (bytes > MAX_ENTRY_BYTES) {
    return {
      ok: false,
      reason: `the entry is ${String(bytes)} bytes, over the ${String(MAX_ENTRY_BYTES)}-byte bound`
    };
  }
  const path = entryPath(projectRoot, entry);
  return {
    ok: true,
    prepared: { path, temp: `${path}.tmp-${String(process.pid)}`, text: ascii.text }
  };
}

export type EntriesWrite = { ok: true; paths: string[] } | { ok: false; reason: string };

/** One entry and, when present, the measured document it was built from. */
export type BatchItem = { entry: LayoutEntry; capture?: unknown };

function prepareCapture(
  projectRoot: string,
  item: BatchItem
): { ok: true; prepared: Prepared } | { ok: false; reason: string } {
  if (item.capture === undefined) return { ok: true, prepared: { path: '', temp: '', text: '' } };
  const refusal = keyRefusal(item.entry);
  if (refusal !== null) return { ok: false, reason: refusal };
  const path = capturePath(projectRoot, item.entry);
  return {
    ok: true,
    prepared: {
      path,
      temp: `${path}.tmp-${String(process.pid)}`,
      text: `${JSON.stringify(item.capture)}\n`
    }
  };
}

/**
 * Write a batch: every entry is serialized and size-checked and every capture
 * is prepared before any file is touched; every temp file is written before any
 * final name exists; only then are they renamed into place and both indexes
 * rebuilt. A refusal before the rename leaves no entry and no capture; a rename
 * that fails part-way leaves whatever landed, with the indexes made to agree
 * with the disk or removed.
 */
/** Both derived indexes, in order: entries first, then the token reverse index. */
function writeIndexes(projectRoot: string): StoreWrite {
  const index = writeIndex(projectRoot);
  return index.ok ? writeTokenIndex(projectRoot) : index;
}

/** Remove one index path; whether it is gone afterwards, so nothing throws. */
function forget(path: string): boolean {
  try {
    rmSync(path, { force: true, recursive: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Rewrite both indexes; when either cannot be written, remove both so the next
 * reader rebuilds from the entries instead of trusting a half-updated pair. A
 * removal that itself fails still returns the write failure: this path answers
 * with a value, never a throw.
 */
export function rebuildIndexes(projectRoot: string): StoreWrite {
  const written = writeIndexes(projectRoot);
  if (written.ok) return written;
  forget(join(graphRoot(projectRoot), INDEX_FILE));
  forget(join(graphRoot(projectRoot), TOKEN_INDEX_FILE));
  return written;
}

export function writeBatch(projectRoot: string, items: readonly BatchItem[]): EntriesWrite {
  const prepared: Prepared[] = [];
  for (const item of items) {
    const entry = prepareEntry(projectRoot, item.entry);
    if (!entry.ok) return entry;
    const capture = prepareCapture(projectRoot, item);
    if (!capture.ok) return capture;
    prepared.push(entry.prepared);
    if (capture.prepared.path !== '') prepared.push(capture.prepared);
  }
  const temps: string[] = [];
  try {
    for (const item of prepared) {
      mkdirSync(dirname(item.path), { recursive: true });
      writeFileSync(item.temp, item.text, 'utf8');
      temps.push(item.temp);
    }
    for (const item of prepared) renameSync(item.temp, item.path);
  } catch (error) {
    for (const temp of temps) rmSync(temp, { force: true });
    rebuildIndexes(projectRoot);
    return { ok: false, reason: `the entry could not be written (${errorText(error)})` };
  }
  const index = rebuildIndexes(projectRoot);
  return index.ok ? { ok: true, paths: prepared.map((item) => item.path) } : index;
}

/** Entry-only batches keep their one-argument shape. */
export function writeEntries(projectRoot: string, entries: readonly LayoutEntry[]): EntriesWrite {
  return writeBatch(
    projectRoot,
    entries.map((entry) => ({ entry }))
  );
}

/** One entry through the batch path; the index is refreshed once. */
export function writeEntry(projectRoot: string, entry: LayoutEntry): StoreWrite {
  const written = writeEntries(projectRoot, [entry]);
  if (!written.ok) return written;
  const path = written.paths[0];
  return path === undefined
    ? { ok: false, reason: 'the entry was not written' }
    : { ok: true, path };
}

/** Record the route's coverage verdict beside its entries. */
export function writeCoverage(projectRoot: string, coverage: RouteCoverage): StoreWrite {
  const path = coveragePath(projectRoot, coverage.route);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(coverage)}\n`, 'utf8');
    return { ok: true, path };
  } catch (error) {
    return { ok: false, reason: `the coverage record could not be written (${errorText(error)})` };
  }
}

/** Keep the measured geometry that produced an entry, so a read can check it. */
export function writeCapture(projectRoot: string, key: EntryKey, geometry: unknown): StoreWrite {
  const refusal = keyRefusal(key);
  if (refusal !== null) return { ok: false, reason: refusal };
  const path = capturePath(projectRoot, key);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(geometry)}\n`, 'utf8');
    return { ok: true, path };
  } catch (error) {
    return { ok: false, reason: `the capture could not be written (${errorText(error)})` };
  }
}

export {
  INDEX_FILE,
  INDEX_MAGIC,
  capturePath,
  coveragePath,
  entryFileName,
  entryPath,
  graphRoot,
  keyRefusal,
  routeSlug,
  viewportKey,
  type EntryKey,
  type IndexedEntry
} from './layout-graph-paths.js';
export {
  readIndex,
  scanEntries,
  writeIndex,
  type IndexRead,
  type ScanRead
} from './layout-graph-index.js';
export type { StoreWrite };
