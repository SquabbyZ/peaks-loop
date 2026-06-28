/**
 * v2.15.0 follow-up — G11: fork sync state service.
 *
 * Tracks the local fork's relationship to its upstream: which tag the
 * fork is based on, how many commits / files it has diverged, and a
 * history of past syncs. Persistence: `.peaks/fork-state.json` in the
 * project root.
 *
 * Pure functions on top of a typed state object. The CLI surfaces 5
 * commands (status / upstream-check / sync-plan / sync / sync-verify)
 * but the actual upstream fetch + merge is deferred to a follow-up
 * slice; this slice ships the model + the dry-run / plan / record path.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export interface ForkBaseline {
  /** Upstream repo identifier (e.g. "github.com/xxx/hermes"). */
  readonly upstream: string;
  /** Tag or commit the fork is currently based on. */
  readonly basedOn: string;
  /** ISO timestamp when the baseline was recorded. */
  readonly recordedAt: string;
  /** Number of commits the local fork is ahead of the baseline. */
  readonly commitsAhead: number;
  /** Number of files the local fork has changed vs the baseline. */
  readonly filesChanged: number;
}

export interface ForkSyncRecord {
  /** Sync plan id (e.g. "sync-2026-06-28-v1.20.0"). */
  readonly syncId: string;
  /** Target upstream tag. */
  readonly targetTag: string;
  /** ISO timestamp when the sync plan was created. */
  readonly plannedAt: string;
  /** Predicted conflict points (file globs / paths). */
  readonly predictedConflicts: readonly string[];
  /** Business patches that need to be replayed after the sync. */
  readonly businessPatches: readonly string[];
  /** Sync status. */
  readonly status: 'planned' | 'in-progress' | 'verified' | 'failed';
  /** Optional verification notes. */
  readonly verificationNotes?: string;
}

export interface ForkState {
  /** Schema version (currently 1). */
  readonly version: 1;
  /** Current baseline (null when the project is not a fork). */
  readonly baseline: ForkBaseline | null;
  /** History of sync plans + results. */
  readonly history: readonly ForkSyncRecord[];
}

export const EMPTY_FORK_STATE: ForkState = {
  version: 1,
  baseline: null,
  history: []
};

const STATE_FILE = '.peaks/fork-state.json';

export function getForkStatePath(projectRoot: string): string {
  return resolve(projectRoot, STATE_FILE);
}

export function readForkState(projectRoot: string): ForkState {
  const path = getForkStatePath(projectRoot);
  if (!existsSync(path)) return EMPTY_FORK_STATE;
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<ForkState>;
    if (parsed.version !== 1) return EMPTY_FORK_STATE;
    return {
      version: 1,
      baseline: parsed.baseline ?? null,
      history: Array.isArray(parsed.history) ? parsed.history : []
    };
  } catch {
    return EMPTY_FORK_STATE;
  }
}

export function writeForkState(projectRoot: string, state: ForkState): void {
  const path = getForkStatePath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2), 'utf8');
}

/**
 * Record a new sync plan. The state is immutable; the returned state
 * has the new plan appended to `history`.
 */
export function appendSyncRecord(
  state: ForkState,
  record: ForkSyncRecord
): ForkState {
  return {
    version: 1,
    baseline: state.baseline,
    history: [...state.history, record]
  };
}

/**
 * Update an existing sync record's status (e.g. planned → verified).
 * Returns the state unchanged when the record is not found.
 */
export function updateSyncRecordStatus(
  state: ForkState,
  syncId: string,
  status: ForkSyncRecord['status'],
  notes?: string
): ForkState {
  let found = false;
  const history = state.history.map((r) => {
    if (r.syncId !== syncId) return r;
    found = true;
    return {
      ...r,
      status,
      ...(notes !== undefined ? { verificationNotes: notes } : {})
    };
  });
  if (!found) return state;
  return { ...state, history };
}

/**
 * Generate a sync plan id from a target tag. Format:
 * `sync-<ISO-date>-<tag-sanitized>`.
 */
export function makeSyncId(targetTag: string, now: Date = new Date()): string {
  const date = now.toISOString().slice(0, 10);
  const safeTag = targetTag.replace(/[^A-Za-z0-9._-]/g, '-');
  return `sync-${date}-${safeTag}`;
}

/**
 * Recommend stable tags to sync to, given a list of available tags.
 * "Stable" = no pre-release suffix (no `-alpha`, `-beta`, `-rc`).
 * Picks the latest stable tag that is NEWER than the current baseline.
 */
export function recommendStableTags(
  availableTags: readonly string[],
  currentBaseline: string | null
): string[] {
  const isStable = (t: string) => !/(?:^|-)(?:alpha|beta|rc|dev|preview)/i.test(t);
  const stable = availableTags.filter(isStable);
  // Sort by semver-like order (best effort): split on '.', parse ints.
  const cmp = (a: string, b: string): number => {
    // Strip leading 'v' before splitting on '.' or '-' so 'v1' → [1]
    const toParts = (t: string): number[] => t
      .replace(/^v/i, '')
      .split(/[.\-]/)
      .map((s) => Number.parseInt(s, 10) || 0);
    const pa = toParts(a);
    const pb = toParts(b);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const da = pa[i] ?? 0;
      const db = pb[i] ?? 0;
      if (da !== db) return da - db;
    }
    return 0;
  };
  stable.sort(cmp);
  if (currentBaseline === null) return stable;
  const idx = stable.indexOf(currentBaseline);
  return idx >= 0 ? stable.slice(idx + 1) : stable;
}

/**
 * Build a fork-status report from current state.
 */
export interface ForkStatusReport {
  readonly hasBaseline: boolean;
  readonly baseline: ForkBaseline | null;
  readonly syncCount: number;
  readonly lastSync: ForkSyncRecord | null;
  readonly driftWarning: boolean;
}

export function buildForkStatusReport(state: ForkState): ForkStatusReport {
  const lastSync = state.history.length > 0 ? state.history[state.history.length - 1]! : null;
  const drift = state.baseline !== null && state.baseline.commitsAhead > 30;
  return {
    hasBaseline: state.baseline !== null,
    baseline: state.baseline,
    syncCount: state.history.length,
    lastSync,
    driftWarning: drift
  };
}
