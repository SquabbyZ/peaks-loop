/**
 * v2.15.0 follow-up — G15: release / hotfix state machine.
 *
 * Tracks a release through the canary → promote → watch → done
 * pipeline. The actual deployment (k8s rollout, load balancer config,
 * monitoring integration) is OUT OF SCOPE for this slice — this
 * ships the state machine + dry-run hooks for the operator.
 *
 * Persistence: `.peaks/release-state.json` in the project root.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type ReleaseStage = 'planned' | 'canary-10' | 'canary-50' | 'promoted' | 'watching' | 'done' | 'rolled-back' | 'hotfixed';

/** Valid stage transitions. */
const VALID_TRANSITIONS: Readonly<Record<ReleaseStage, readonly ReleaseStage[]>> = {
  'planned': ['canary-10', 'rolled-back'],
  'canary-10': ['canary-50', 'rolled-back'],
  'canary-50': ['promoted', 'rolled-back'],
  'promoted': ['watching', 'rolled-back'],
  'watching': ['done', 'rolled-back', 'hotfixed'],
  'done': [],
  'rolled-back': ['hotfixed', 'planned'],
  'hotfixed': ['watching', 'rolled-back']
};

export function isValidStageTransition(from: ReleaseStage, to: ReleaseStage): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

export function isReleaseStage(value: string): value is ReleaseStage {
  return Object.prototype.hasOwnProperty.call(VALID_TRANSITIONS, value);
}

export interface ReleaseRecord {
  readonly version: string;
  readonly currentStage: ReleaseStage;
  readonly stageHistory: readonly { readonly stage: ReleaseStage; readonly at: string; readonly note?: string }[];
  readonly createdAt: string;
  readonly promotedAt?: string;
  readonly doneAt?: string;
}

export interface ReleaseState {
  readonly version: 1;
  /** Active release (the one being canary'd / watched). */
  readonly active: ReleaseRecord | null;
  /** History of completed / rolled-back / hotfixed releases. */
  readonly history: readonly ReleaseRecord[];
}

export const EMPTY_RELEASE_STATE: ReleaseState = { version: 1, active: null, history: [] };

const STATE_FILE = '.peaks/release-state.json';

export function getReleaseStatePath(projectRoot: string): string {
  return resolve(projectRoot, STATE_FILE);
}

export function readReleaseState(projectRoot: string): ReleaseState {
  const path = getReleaseStatePath(projectRoot);
  if (!existsSync(path)) return EMPTY_RELEASE_STATE;
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<ReleaseState>;
    if (parsed.version !== 1) return EMPTY_RELEASE_STATE;
    return {
      version: 1,
      active: parsed.active ?? null,
      history: Array.isArray(parsed.history) ? parsed.history : []
    };
  } catch {
    return EMPTY_RELEASE_STATE;
  }
}

export function writeReleaseState(projectRoot: string, state: ReleaseState): void {
  const path = getReleaseStatePath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2), 'utf8');
}

/** Plan a new release. If there is an active release, fails. */
export function planRelease(
  state: ReleaseState,
  version: string,
  now: Date = new Date()
): { state: ReleaseState; record: ReleaseRecord } | { error: string } {
  if (state.active !== null) {
    return { error: `an active release is already in stage "${state.active.currentStage}"` };
  }
  const record: ReleaseRecord = {
    version,
    currentStage: 'planned',
    stageHistory: [{ stage: 'planned', at: now.toISOString() }],
    createdAt: now.toISOString()
  };
  return { state: { ...state, active: record }, record };
}

/** Transition the active release to a new stage. */
export function transitionRelease(
  state: ReleaseState,
  to: ReleaseStage,
  note?: string,
  now: Date = new Date()
): { state: ReleaseState } | { error: string } {
  if (state.active === null) return { error: 'no active release' };
  const from = state.active.currentStage;
  if (!isValidStageTransition(from, to)) {
    return { error: `invalid transition: ${from} → ${to} (allowed from ${from}: ${VALID_TRANSITIONS[from].join(', ') || 'none'})` };
  }
  const stageHistory = [...state.active.stageHistory, { stage: to, at: now.toISOString(), ...(note !== undefined ? { note } : {}) }];
  const promoted: ReleaseRecord = to === 'promoted'
    ? { ...state.active, currentStage: to, stageHistory, promotedAt: now.toISOString() }
    : { ...state.active, currentStage: to, stageHistory };
  const done: ReleaseRecord = to === 'done'
    ? { ...promoted, doneAt: now.toISOString() }
    : promoted;
  return { state: { ...state, active: done } };
}

/** Roll back the active release and move it to history. */
export function rollbackRelease(
  state: ReleaseState,
  note?: string,
  now: Date = new Date()
): { state: ReleaseState; record: ReleaseRecord } | { error: string } {
  if (state.active === null) return { error: 'no active release' };
  const from = state.active.currentStage;
  if (!isValidStageTransition(from, 'rolled-back')) {
    return { error: `cannot rollback from ${from}` };
  }
  const stageHistory = [...state.active.stageHistory, { stage: 'rolled-back', at: now.toISOString(), ...(note !== undefined ? { note } : {}) }];
  const record: ReleaseRecord = { ...state.active, currentStage: 'rolled-back', stageHistory };
  return { state: { active: null, history: [...state.history, record] }, record };
}

/** Hotfix: create a new active release on a hotfix version. */
export function hotfixRelease(
  state: ReleaseState,
  hotfixVersion: string,
  note?: string,
  now: Date = new Date()
): { state: ReleaseState; record: ReleaseRecord } | { error: string } {
  // If there's an active release, first roll it back (forced).
  let currentState = state;
  let priorRecord: ReleaseRecord | null = null;
  if (state.active !== null) {
    const rb = rollbackRelease(state, 'auto-rollback for hotfix', now);
    if ('record' in rb) {
      currentState = rb.state;
      priorRecord = rb.record;
    }
  }
  // Plan the hotfix release directly into 'canary-10' (skip 'planned').
  const record: ReleaseRecord = {
    version: hotfixVersion,
    currentStage: 'canary-10',
    stageHistory: [
      { stage: 'canary-10', at: now.toISOString(), ...(note !== undefined ? { note } : {}) }
    ],
    createdAt: now.toISOString()
  };
  return { state: { ...currentState, active: record }, record, ...(priorRecord !== null ? { rolledBack: priorRecord } : {}) } as { state: ReleaseState; record: ReleaseRecord };
}

/** Compute the watch window. */
export function watchWindow(record: ReleaseRecord, now: Date = new Date()): {
  elapsedMs: number;
  remainingMs: number;
  windowMs: number;
  percentComplete: number;
} {
  const WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
  if (record.promotedAt === undefined) {
    return { elapsedMs: 0, remainingMs: WINDOW_MS, windowMs: WINDOW_MS, percentComplete: 0 };
  }
  const start = new Date(record.promotedAt).getTime();
  const elapsed = Math.max(0, now.getTime() - start);
  const remaining = Math.max(0, WINDOW_MS - elapsed);
  return {
    elapsedMs: elapsed,
    remainingMs: remaining,
    windowMs: WINDOW_MS,
    percentComplete: Math.min(1, elapsed / WINDOW_MS)
  };
}
