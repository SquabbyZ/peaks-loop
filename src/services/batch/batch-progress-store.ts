// src/services/batch/batch-progress-store.ts
//
// The on-disk batch progress record, and the file-set normalizer the whole
// batch mode depends on.
//
// WHY THIS FILE EXISTS (the compaction gap). The pre-compact checkpoint
// records empty lists for open questions, recent decisions and todo state, so
// a compaction in the middle of a batch loses everything the orchestrator knew
// about that batch: which items were already diagnosed, which file sets they
// would touch, which stage the batch had reached. The batch then restarts from
// the beginning. This record is what survives that: one file per batch, written
// as each item is diagnosed or fixed, so a resumed batch continues instead of
// re-running.
//
// WHERE IT LIVES. `<sessionDir>/batch/<batchId>/progress.json` — beside the
// other artifacts of the session, one directory per batch.
//
// WHY THE WRITE IS ATOMIC. A reader that sees a half-written file reads it as
// "no progress" and restarts the batch. The write goes to a temp file in the
// same directory and is renamed over the target, so a reader sees either the
// previous record or the new one — the same pattern the job progress mirror
// and the session checkpoint use.
//
// WHY THE FILE SET IS NORMALIZED. Two items may run in the same wave only if
// their file sets are disjoint, and that comparison is exact string equality.
// A backslash-spelled path and the same path spelled with forward slashes name
// one file on every platform this project runs on, so an unnormalized set makes
// two items look disjoint when they are not — and two agents then edit the same
// file at once. `normalizeFileSet` is the one place that decides what a file
// set is.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { isUnsafePathInput } from '../../shared/path-safety.js';
import { normalizePath } from '../../shared/path-utils.js';
import { getSessionDir } from '../session/getSessionDir.js';
import type {
  BatchItem,
  BatchItemStatus,
  BatchPhase,
  BatchProgress
} from './batch-progress-types.js';

const BATCH_DIR = 'batch';
const PROGRESS_FILE = 'progress.json';

const PHASES: readonly BatchPhase[] = ['diagnosis', 'topology', 'fix', 'verify', 'done'];
const STATUSES: readonly BatchItemStatus[] = ['pending', 'diagnosed', 'fixed', 'verified'];

/**
 * The record's path for one batch.
 *
 * `batchId` is caller-supplied and becomes a path segment, so it is checked
 * before it is joined: `..` and an absolute path would otherwise let a caller
 * write outside the session's batch directory, and a nested `a/b` would write
 * outside the directory the batch owns.
 */
export function batchProgressPath(projectRoot: string, sessionId: string, batchId: string): string {
  if (isUnsafePathInput(batchId) || batchId.includes('/')) {
    throw new Error(`Invalid batch id: ${batchId} (must be a single safe path segment)`);
  }
  return join(getSessionDir(projectRoot, sessionId), BATCH_DIR, batchId, PROGRESS_FILE);
}

/**
 * The canonical form of a file set: POSIX separators, no leading `./`, no
 * duplicates, sorted.
 *
 * Two callers that measured the same file differently — one agent on Windows
 * reporting a backslash-spelled path, another reporting the same path with
 * forward slashes — must end up with the same string, or the disjointness
 * check that decides whether two items may run in parallel waves reads them as
 * disjoint and two agents edit one file. Sorting makes the stored set
 * comparable, not just its members.
 */
export function normalizeFileSet(files: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  for (const raw of files) {
    if (typeof raw !== 'string') continue;
    const posix = normalizePath(raw).replace(/^\.\//, '');
    if (posix.length > 0) seen.add(posix);
  }
  return [...seen].sort();
}

/**
 * Read one batch's record. `null` when the batch has no record yet — the
 * "no progress" answer, distinct from a record that exists but is unreadable.
 *
 * A malformed record throws rather than reading as `null`: the two answers
 * mean opposite things to the caller, and a batch that silently loses its
 * history restarts the work it had already done.
 */
export function readBatchProgress(
  projectRoot: string,
  sessionId: string,
  batchId: string
): BatchProgress | null {
  const path = batchProgressPath(projectRoot, sessionId, batchId);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid batch progress at ${path}: ${detail}`);
  }
  return coerceProgress(parsed, path);
}

/**
 * Write one batch's record, atomically.
 *
 * The timestamp is the writer's, not the caller's: the record's value is
 * "when this batch last moved", and a caller that supplied its own clock
 * would make that unanswerable.
 */
export function writeBatchProgress(
  projectRoot: string,
  sessionId: string,
  progress: BatchProgress
): void {
  const path = batchProgressPath(projectRoot, sessionId, progress.batchId);
  mkdirSync(dirname(path), { recursive: true });
  const record: BatchProgress = { ...progress, updatedAt: new Date().toISOString() };
  // Temp file in the same directory, then rename: a write that fails halfway
  // leaves the previous record intact rather than a truncated one.
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
}

/**
 * Append one item to a batch's record and write it back.
 *
 * The append is read → merge → write, and the merge is by item id: an item
 * that is already in the record is replaced by the new version, so an item
 * that moves from `pending` to `diagnosed` to `fixed` is one row that changes
 * status rather than three rows. That is what lets the recovery read "which
 * items are still pending" by filtering one field.
 *
 * A batch with no record yet gets one, so the first append does not need a
 * separate create step — the record is written as the batch runs, not before.
 */
export function appendBatchItem(
  projectRoot: string,
  sessionId: string,
  batchId: string,
  item: BatchItem
): void {
  const existing = readBatchProgress(projectRoot, sessionId, batchId);
  const items = existing === null ? [] : existing.items;
  const at = items.findIndex((candidate) => candidate.id === item.id);
  const merged =
    at === -1
      ? [...items, item]
      : items.map((candidate, index) => (index === at ? item : candidate));
  const next: BatchProgress = {
    ...(existing ?? {}),
    batchId,
    phase: existing?.phase ?? 'diagnosis',
    items: merged
  };
  writeBatchProgress(projectRoot, sessionId, next);
}

/**
 * Check a parsed record against the shape the rest of the batch mode reads.
 *
 * The record is written by this module and read by another process after a
 * compaction, so it is external data at read time. The fields the recovery
 * path depends on — the phase and the items — are checked; a mismatch throws
 * with the path, so a wrong-shaped file is reported rather than read as a
 * batch with no items (which would restart the batch's work).
 */
function coerceProgress(raw: unknown, path: string): BatchProgress {
  const record = requireObject(raw, path, 'root');
  const batchId = requireText(record['batchId'], path, 'batchId');
  const phase = requireEnum(record['phase'], PHASES, path, 'phase') as BatchPhase;
  const rawItems = record['items'];
  if (!Array.isArray(rawItems)) {
    throw new Error(`Invalid batch progress at ${path}: items must be an array`);
  }
  const items = rawItems.map((entry, index) => coerceItem(entry, path, index));
  const topology = record['topology'];
  const updatedAt = record['updatedAt'];
  return {
    batchId,
    phase,
    items,
    ...(topology === undefined ? {} : { topology }),
    ...(typeof updatedAt === 'string' ? { updatedAt } : {})
  };
}

/** One item of the record, checked the same way as the record itself. */
function coerceItem(raw: unknown, path: string, index: number): BatchItem {
  const at = `items[${index}]`;
  const entry = requireObject(raw, path, at);
  const id = requireText(entry['id'], path, `${at}.id`);
  const label = requireText(entry['label'], path, `${at}.label`);
  const status = requireEnum(entry['status'], STATUSES, path, `${at}.status`) as BatchItemStatus;
  const files = entry['files'];
  if (!Array.isArray(files) || !files.every((file) => typeof file === 'string')) {
    throw new Error(`Invalid batch progress at ${path}: ${at}.files must be an array of strings`);
  }
  const riskSurface = entry['riskSurface'];
  const diagnosedAt = entry['diagnosedAt'];
  const fixedAt = entry['fixedAt'];
  return {
    id,
    label,
    status,
    files,
    ...(typeof riskSurface === 'number' ? { riskSurface } : {}),
    ...(typeof diagnosedAt === 'string' ? { diagnosedAt } : {}),
    ...(typeof fixedAt === 'string' ? { fixedAt } : {})
  };
}

/** A JSON object, or a refusal naming where it was expected. */
function requireObject(raw: unknown, path: string, what: string): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Invalid batch progress at ${path}: ${what} must be an object`);
  }
  return raw as Record<string, unknown>;
}

/** A non-empty string, or a refusal naming the field. */
function requireText(raw: unknown, path: string, what: string): string {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error(`Invalid batch progress at ${path}: ${what} must be a non-empty string`);
  }
  return raw;
}

/** One of a fixed set of values, or a refusal naming the set. */
function requireEnum(raw: unknown, allowed: readonly string[], path: string, what: string): string {
  if (typeof raw !== 'string' || !allowed.includes(raw)) {
    throw new Error(
      `Invalid batch progress at ${path}: ${what} must be one of ${allowed.join('|')}`
    );
  }
  return raw;
}
