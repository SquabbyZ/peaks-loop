// src/services/compact-statusline/compact-lifecycle-store.ts
//
// Slice 2026-08-01-compact-lifecycle (Task 1/5). Pure persistence
// for the runtime *compact lifecycle* record that the auto-compact
// orchestrator writes on every state transition. The record is the
// single source of truth that downstream statusline / dashboard
// consumers (Tasks 2-5) read to decide what to display.
//
// Storage:
//   .peaks/_runtime/<sessionId>/compact-lifecycle.json
//
// Writes go through a temp-file-then-rename in the same directory,
// so a crash mid-write never leaves a half-written record. Reads
// validate parsed values explicitly (numeric ranges, stage enum,
// terminal-stage semantics) and return a tagged union so callers
// can distinguish `missing` / `valid` / `invalid` / `stalled`.
//
// Stalled detection: an **active** stage (queued / preparing /
// compacting / verifying) is `stalled` when (nowMs - updatedAt) >
// staleAfterMs. Terminal stages (`completed`, `failed`) NEVER go
// stalled — the record is the historical answer, not a heartbeat.

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getSessionDir } from '../session/getSessionDir.js';

const LIFECYCLE_FILENAME = 'compact-lifecycle.json';
const ERROR_SUMMARY_MAX = 160;
const ACTIVE_STAGES: ReadonlyArray<Exclude<CompactLifecycleStage, 'completed' | 'failed'>> = [
  'queued',
  'preparing',
  'compacting',
  'verifying',
];
const ALL_STAGES: ReadonlyArray<CompactLifecycleStage> = [
  'queued',
  'preparing',
  'compacting',
  'verifying',
  'completed',
  'failed',
];

export type CompactLifecycleStage =
  | 'queued'
  | 'preparing'
  | 'compacting'
  | 'verifying'
  | 'completed'
  | 'failed';

export interface CompactLifecycleRecord {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly stage: CompactLifecycleStage;
  readonly updatedAt: string;
  readonly triggerRatio: number;
  readonly afterRatio?: number;
  readonly redLine: boolean;
  readonly failedAt?: Exclude<CompactLifecycleStage, 'failed' | 'completed'>;
  readonly errorSummary?: string;
}

export type CompactLifecycleRead =
  | { readonly kind: 'missing' }
  | { readonly kind: 'valid'; readonly record: CompactLifecycleRecord }
  | { readonly kind: 'invalid'; readonly reason: string }
  | { readonly kind: 'stalled'; readonly record: CompactLifecycleRecord };

function lifecyclePath(projectRoot: string, sessionId: string): string {
  return join(getSessionDir(projectRoot, sessionId), LIFECYCLE_FILENAME);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStage(v: unknown): v is CompactLifecycleStage {
  return typeof v === 'string' && (ALL_STAGES as ReadonlyArray<string>).includes(v);
}

function isActiveStage(stage: CompactLifecycleStage): boolean {
  return (ACTIVE_STAGES as ReadonlyArray<string>).includes(stage);
}

function isFiniteRatio(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
}

function coerceRecord(raw: unknown): CompactLifecycleRecord {
  if (!isPlainObject(raw)) {
    throw new Error('compact-lifecycle: root must be a JSON object');
  }
  if (raw['schemaVersion'] !== 1) {
    throw new Error(`compact-lifecycle: schemaVersion must be 1 (got ${JSON.stringify(raw['schemaVersion'])})`);
  }
  if (typeof raw['runId'] !== 'string' || raw['runId'].length === 0) {
    throw new Error('compact-lifecycle: runId must be a non-empty string');
  }
  if (!isStage(raw['stage'])) {
    throw new Error(`compact-lifecycle: stage must be one of ${ALL_STAGES.join('|')} (got ${JSON.stringify(raw['stage'])})`);
  }
  if (typeof raw['updatedAt'] !== 'string' || Number.isNaN(Date.parse(raw['updatedAt']))) {
    throw new Error('compact-lifecycle: updatedAt must be an ISO 8601 string');
  }
  if (!isFiniteRatio(raw['triggerRatio'])) {
    throw new Error(`compact-lifecycle: triggerRatio must be a finite number in [0,1] (got ${JSON.stringify(raw['triggerRatio'])})`);
  }
  if (raw['afterRatio'] !== undefined && !isFiniteRatio(raw['afterRatio'])) {
    throw new Error(`compact-lifecycle: afterRatio must be a finite number in [0,1] (got ${JSON.stringify(raw['afterRatio'])})`);
  }
  if (typeof raw['redLine'] !== 'boolean') {
    throw new Error(`compact-lifecycle: redLine must be a boolean (got ${JSON.stringify(raw['redLine'])})`);
  }
  const stage = raw['stage'] as CompactLifecycleStage;
  if (stage === 'failed') {
    const failedAt = raw['failedAt'];
    if (!isStage(failedAt) || failedAt === 'failed' || failedAt === 'completed') {
      throw new Error(`compact-lifecycle: failedAt must be one of the active stages (got ${JSON.stringify(failedAt)})`);
    }
    const errorSummary = raw['errorSummary'];
    if (errorSummary !== undefined && typeof errorSummary !== 'string') {
      throw new Error(`compact-lifecycle: errorSummary must be a string when provided (got ${JSON.stringify(errorSummary)})`);
    }
    return {
      schemaVersion: 1,
      runId: raw['runId'],
      stage,
      updatedAt: raw['updatedAt'],
      triggerRatio: raw['triggerRatio'],
      redLine: raw['redLine'],
      failedAt: failedAt as Exclude<CompactLifecycleStage, 'failed' | 'completed'>,
      ...(raw['afterRatio'] !== undefined ? { afterRatio: raw['afterRatio'] as number } : {}),
      ...(errorSummary !== undefined ? { errorSummary: errorSummary as string } : {}),
    };
  }
  // Non-failed records must NOT carry a failedAt or errorSummary.
  if (raw['failedAt'] !== undefined) {
    throw new Error('compact-lifecycle: failedAt is only allowed when stage="failed"');
  }
  if (raw['errorSummary'] !== undefined) {
    throw new Error('compact-lifecycle: errorSummary is only allowed when stage="failed"');
  }
  return {
    schemaVersion: 1,
    runId: raw['runId'],
    stage,
    updatedAt: raw['updatedAt'],
    triggerRatio: raw['triggerRatio'],
    redLine: raw['redLine'],
    ...(raw['afterRatio'] !== undefined ? { afterRatio: raw['afterRatio'] as number } : {}),
  };
}

function clampErrorSummary(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.length > ERROR_SUMMARY_MAX ? value.slice(0, ERROR_SUMMARY_MAX) : value;
}

/**
 * Atomically write a compact lifecycle record. Uses a temp file in
 * the same directory plus `renameSync`, so a crash mid-write never
 * leaves a half-written record (atomic on POSIX, near-atomic on
 * Windows — same contract `24h-mode/store.ts` and
 * `session-checkpoint-service.ts` use).
 *
 * Side effects:
 *   - creates `<sessionDir>/` if missing
 *   - clamps `errorSummary` to 160 characters (longer strings are
 *     truncated at the head, not padded)
 *   - removes the temp file on rename failure (best effort)
 *
 * Throws on I/O failure or validation rejection; the caller decides
 * whether to retry / log / surface to the user.
 */
export function writeCompactLifecycle(input: {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly record: CompactLifecycleRecord;
}): { readonly path: string } {
  const path = lifecyclePath(input.projectRoot, input.sessionId);
  mkdirSync(dirname(path), { recursive: true });

  // Validate the record the caller passed BEFORE opening a tmp file,
  // so a malformed caller doesn't leave a tmp file dangling.
  // (Re-coercing also catches cases where the caller bypassed TypeScript.)
  const validated = coerceRecord({
    ...input.record,
    errorSummary: clampErrorSummary(input.record.errorSummary),
  });

  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tmp, JSON.stringify(validated, null, 2) + '\n', 'utf8');
    renameSync(tmp, path);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      // best effort: the OS will reap the tmp file eventually
    }
    throw error;
  }
  return { path };
}

/**
 * Read a compact lifecycle record and classify it.
 *
 * Return kinds:
 *   - `missing`  — no record has ever been written for this session
 *   - `valid`    — record parsed and validated; stage is terminal
 *                  (completed/failed) OR is active but still fresh
 *   - `invalid`  — file exists but is malformed / wrong schema / out
 *                  of range. `reason` is a single-line English message
 *                  (no CLI verbs, no stack traces). The caller MUST
 *                  surface this to a human — we never silently turn
 *                  a corrupted record into `missing`.
 *   - `stalled`  — record is valid and is currently an ACTIVE stage,
 *                  but `updatedAt` is older than `staleAfterMs` (a
 *                  heartbeat that never arrived). Terminal stages
 *                  never go stalled.
 */
export function readCompactLifecycle(input: {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly nowMs: number;
  readonly staleAfterMs: number;
}): CompactLifecycleRead {
  const path = lifecyclePath(input.projectRoot, input.sessionId);
  if (!existsSync(path)) {
    return { kind: 'missing' };
  }
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    return {
      kind: 'invalid',
      reason: `compact-lifecycle: unable to read record file: ${(error as Error).message}`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      kind: 'invalid',
      reason: `compact-lifecycle: malformed JSON (${(error as Error).message})`,
    };
  }
  let record: CompactLifecycleRecord;
  try {
    record = coerceRecord(parsed);
  } catch (error) {
    return { kind: 'invalid', reason: (error as Error).message };
  }
  if (isActiveStage(record.stage)) {
    const updatedAtMs = Date.parse(record.updatedAt);
    if (!Number.isNaN(updatedAtMs) && input.nowMs - updatedAtMs > input.staleAfterMs) {
      return { kind: 'stalled', record };
    }
  }
  return { kind: 'valid', record };
}

export const COMPACT_LIFECYCLE_CONSTANTS = {
  LIFECYCLE_FILENAME,
  ERROR_SUMMARY_MAX,
  ACTIVE_STAGES,
  ALL_STAGES,
} as const;