/**
 * 24h mode persistence — atomic JSON snapshot under
 * `.peaks/_runtime/<sessionId>/24h-state.json`.
 *
 * Rid-020a (state-only slice). The store never invents a session id:
 * the caller passes one (the CLI resolves it from `.peaks/_runtime/session.json`).
 * Writes use the temp-file + rename pattern so a crash mid-write never
 * leaves a half-written state file (atomic on POSIX, near-atomic on
 * Windows — same approach used by `session-checkpoint-service.ts`).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getSessionDir } from '../session/getSessionDir.js';
import {
  emptyAttempts,
  isDecisionKey,
  isState,
  type DecisionKey,
  type State,
  type State24hSnapshot
} from './state.js';

const STATE_FILENAME = '24h-state.json';

function statePath(projectRoot: string, sessionId: string): string {
  return join(getSessionDir(projectRoot, sessionId), STATE_FILENAME);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function coerceSnapshot(raw: unknown): State24hSnapshot {
  if (!isPlainObject(raw)) {
    throw new Error('24H_STATE_INVALID: root must be an object');
  }
  if (typeof raw['state'] !== 'string' || !isState(raw['state'])) {
    throw new Error(`24H_STATE_INVALID: state must be one of IDLE|BRAINSTORM|USER_CONFIRM|24H_ACTIVE|WAITING_USER|HANDOFF (got ${JSON.stringify(raw['state'])})`);
  }
  if (typeof raw['enteredAt'] !== 'string') {
    throw new Error('24H_STATE_INVALID: enteredAt must be an ISO string');
  }
  if (raw['enteredFrom'] !== null && (typeof raw['enteredFrom'] !== 'string' || !isState(raw['enteredFrom']))) {
    throw new Error('24H_STATE_INVALID: enteredFrom must be a State or null');
  }
  if (!Array.isArray(raw['activeSlices']) || !raw['activeSlices'].every((s) => typeof s === 'string')) {
    throw new Error('24H_STATE_INVALID: activeSlices must be string[]');
  }
  if (typeof raw['monotonicGuards'] !== 'number' || !Number.isInteger(raw['monotonicGuards'])) {
    throw new Error('24H_STATE_INVALID: monotonicGuards must be a non-negative integer');
  }
  if (typeof raw['autoCompactCount'] !== 'number' || !Number.isInteger(raw['autoCompactCount'])) {
    throw new Error('24H_STATE_INVALID: autoCompactCount must be a non-negative integer');
  }
  if (typeof raw['checkpoints'] !== 'number' || !Number.isInteger(raw['checkpoints'])) {
    throw new Error('24H_STATE_INVALID: checkpoints must be a non-negative integer');
  }
  if (raw['lastCheckpointAt'] !== null && typeof raw['lastCheckpointAt'] !== 'string') {
    throw new Error('24H_STATE_INVALID: lastCheckpointAt must be ISO string or null');
  }
  if (raw['exitCondition'] !== null && typeof raw['exitCondition'] !== 'string') {
    throw new Error('24H_STATE_INVALID: exitCondition must be string or null');
  }
  const rawAttempts = raw['attempts'];
  if (!isPlainObject(rawAttempts)) {
    throw new Error('24H_STATE_INVALID: attempts must be an object');
  }
  const attempts = emptyAttempts();
  for (const [k, v] of Object.entries(rawAttempts)) {
    if (!isDecisionKey(k)) {
      throw new Error(`24H_STATE_INVALID: attempts has unknown key ${k}`);
    }
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
      throw new Error(`24H_STATE_INVALID: attempts.${k} must be a non-negative integer`);
    }
    attempts[k as DecisionKey] = v;
  }
  return {
    state: raw['state'] as State,
    enteredAt: raw['enteredAt'],
    enteredFrom: raw['enteredFrom'] as State | null,
    activeSlices: raw['activeSlices'] as string[],
    monotonicGuards: raw['monotonicGuards'] as number,
    autoCompactCount: raw['autoCompactCount'] as number,
    checkpoints: raw['checkpoints'] as number,
    lastCheckpointAt: raw['lastCheckpointAt'] as string | null,
    attempts,
    exitCondition: raw['exitCondition'] as string | null
  };
}

export function emptySnapshot(now: Date = new Date()): State24hSnapshot {
  return {
    state: 'IDLE',
    enteredAt: now.toISOString(),
    enteredFrom: null,
    activeSlices: [],
    monotonicGuards: 0,
    autoCompactCount: 0,
    checkpoints: 0,
    lastCheckpointAt: null,
    attempts: emptyAttempts(),
    exitCondition: null
  };
}

export function read24hState(projectRoot: string, sessionId: string): State24hSnapshot {
  const path = statePath(projectRoot, sessionId);
  if (!existsSync(path)) return emptySnapshot();
  const raw = readFileSync(path, 'utf8');
  return coerceSnapshot(JSON.parse(raw));
}

/**
 * Atomic write: temp file in the same directory, then rename. The
 * rename is a single syscall on POSIX and a single MoveFile on
 * Windows — a crash in between leaves the previous valid snapshot
 * intact. `fsync` on the temp file is omitted (we accept the
 * same weaker contract that `session-checkpoint-service.ts` uses)
 * because the state is reconstructible from the B3 attempt log.
 */
export function write24hState(
  projectRoot: string,
  sessionId: string,
  snapshot: State24hSnapshot
): { path: string } {
  const path = statePath(projectRoot, sessionId);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  renameSync(tmp, path);
  return { path };
}

export const STATE_STORE_CONSTANTS = {
  STATE_FILENAME
} as const;
