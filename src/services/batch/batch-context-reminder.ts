// src/services/batch/batch-context-reminder.ts
//
// WHAT the batch says about the context window, and HOW OFTEN.
//
// THE RULE IS "STATE, NEVER INSTRUCT". The zero-pause contract says the
// compaction is the system's own action, never the user's: any wording
// that asks the user to compact, to run `/compact`, or to manage their own
// context is a regression (`tests/unit/cli/skill-presence-loop-hygiene.test.ts`
// is the guard). So the sentences here only say what is true — the ratio,
// the zone, what the system is doing — and never ask anybody to do
// anything.
//
// THE FREQUENCY IS "ONCE PER PHASE", NOT "EVERY TURN". Below the
// auto-fire line nothing is said at all: the ratio is visible every turn
// in the presence read (`context.ratioPct`), so a reminder below the line
// only adds noise. Above the line the batch says something once per
// phase, and once per phase boundary — a reminder on every turn would be
// the "每轮说会吵" the design's open question named.
//
// THE PHASE BOUNDARY SENTENCE IS NOT HERE. The notice that says the
// diagnosis is done and the compression is running belongs to the batch's
// verification stage (`buildPhaseBoundaryNotice`). This module CONSUMES
// that notice — it is handed in as `boundaryNotice` — rather than writing
// a second, rival sentence about the same moment. When no notice is
// supplied, this module falls back to the ratio sentence, which states a
// fact about the zone and asks for nothing.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { isUnsafePathInput } from '../../shared/path-safety.js';
import { evaluateCompactTrigger } from '../code/auto-compact-decision.js';
import type { AutoCompactMode } from '../code/auto-compact-modes.js';
import { getSessionDir } from '../session/getSessionDir.js';
import { findActiveBatch } from './batch-active-batch.js';
import { readBatchProgress } from './batch-progress-store.js';
import type { BatchPhase } from './batch-progress-types.js';

const BATCH_DIR = 'batch';
const REMINDER_STATE_FILE = 'reminder.json';

/**
 * The red-line sentence.
 *
 * It states what the system is doing and what is NOT blocked, so the
 * reader does not read the red line as a stop. It asks for nothing.
 */
export const BATCH_CONTEXT_RED_LINE_NOTICE = '已请求 harness 压缩，等待中；派发未阻塞';

/**
 * The zone sentence for a ratio that has entered the auto-compact zone.
 *
 * @param ratio - The context ratio, 0..1.
 */
export function batchContextRatioNotice(ratio: number): string {
  return `上下文 ${(ratio * 100).toFixed(1)}%，已进入自动压缩区`;
}

/** What kind of reminder this is. */
export type BatchReminderKind = 'ratio' | 'phase-boundary' | 'red-line';

/** One reminder: what kind, and the sentence. */
export interface BatchContextReminder {
  readonly kind: BatchReminderKind;
  readonly text: string;
}

/**
 * Build the reminder for this turn, from the ratio and the phase.
 *
 * Pure: the same inputs always give the same sentence, so the wording can
 * be tested without a filesystem.
 *
 * @param input.ratio - The context ratio, 0..1.
 * @param input.mode - The auto-compact mode; the thresholds come from it.
 * @param input.atBoundary - Whether the batch is crossing a compaction
 *   boundary right now.
 * @param input.boundaryNotice - The boundary notice, when the caller has
 *   one. Used verbatim; this module writes no boundary sentence of its own.
 */
export function buildBatchContextReminder(input: {
  readonly ratio: number;
  readonly mode: AutoCompactMode;
  readonly atBoundary: boolean;
  readonly boundaryNotice?: string;
}): BatchContextReminder | null {
  const trigger = evaluateCompactTrigger(input.ratio, input.mode);
  if (trigger.kind === 'red-line') {
    return { kind: 'red-line', text: BATCH_CONTEXT_RED_LINE_NOTICE };
  }
  const inAutoZone = trigger.kind === 'auto-fire' || trigger.kind === 'pre-compact';
  // Below the auto-fire line the batch says nothing at all — not about the
  // zone, and not about the boundary.
  if (!inAutoZone) return null;
  const notice = input.boundaryNotice;
  if (input.atBoundary && typeof notice === 'string' && notice.length > 0) {
    return { kind: 'phase-boundary', text: notice };
  }
  return { kind: 'ratio', text: batchContextRatioNotice(input.ratio) };
}

/** What the batch has already said, and where it was when it said it. */
interface BatchReminderState {
  /** The phase the batch was in the last time it was looked at. */
  readonly lastSeenPhase?: BatchPhase;
  /** The phase the batch last said something in. */
  readonly lastSpokenPhase?: BatchPhase;
}

function statePath(projectRoot: string, sessionId: string, batchId: string): string {
  if (isUnsafePathInput(batchId) || batchId.includes('/') || batchId.includes('\\')) {
    throw new Error(`Invalid batch id: ${batchId} (must be a single safe path segment)`);
  }
  return join(getSessionDir(projectRoot, sessionId), BATCH_DIR, batchId, REMINDER_STATE_FILE);
}

/**
 * Read what the batch has already said.
 *
 * A missing state is "nothing said yet" — the first call in a batch
 * speaks. A malformed state is ignored for the same reason: a reminder
 * that repeats itself is a nuisance, and a reminder that never repeats
 * itself is worse.
 */
function readReminderState(
  projectRoot: string,
  sessionId: string,
  batchId: string
): BatchReminderState {
  const path = statePath(projectRoot, sessionId, batchId);
  if (!existsSync(path)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const record = parsed as { lastSeenPhase?: unknown; lastSpokenPhase?: unknown };
    const seen = record.lastSeenPhase;
    const spoken = record.lastSpokenPhase;
    return {
      ...(typeof seen === 'string' ? { lastSeenPhase: seen as BatchPhase } : {}),
      ...(typeof spoken === 'string' ? { lastSpokenPhase: spoken as BatchPhase } : {})
    };
  } catch {
    return {};
  }
}

/** Record what the batch has seen and said. */
function writeReminderState(
  projectRoot: string,
  sessionId: string,
  batchId: string,
  state: BatchReminderState
): void {
  const path = statePath(projectRoot, sessionId, batchId);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, `${JSON.stringify(state)}\n`, 'utf8');
  renameSync(tmp, path);
}

/** Whether the batch has crossed into the phase it is in now. */
function hasCrossedPhase(state: BatchReminderState, phase: BatchPhase): boolean {
  return state.lastSeenPhase !== undefined && state.lastSeenPhase !== phase;
}

/** The state to record: the phase seen now, and the phase last spoken in. */
function nextReminderState(
  state: BatchReminderState,
  phase: BatchPhase,
  spoke: boolean
): BatchReminderState {
  const spokenPhase = spoke ? phase : state.lastSpokenPhase;
  return {
    lastSeenPhase: phase,
    ...(spokenPhase === undefined ? {} : { lastSpokenPhase: spokenPhase })
  };
}

/** Whether the recorded state changed, and so has to be written back. */
function stateChanged(left: BatchReminderState, right: BatchReminderState): boolean {
  return (
    left.lastSeenPhase !== right.lastSeenPhase || left.lastSpokenPhase !== right.lastSpokenPhase
  );
}

/**
 * The reminder this turn, and the record that it was said.
 *
 * SIDE EFFECT: the phase the batch was seen in, and the phase it last
 * said something in, are recorded. That is what makes the rule "once per
 * phase" enforceable in code rather than left to the caller's discipline —
 * a reminder on every turn is the noise the design's open question named.
 * The write happens only when the phase changed or when the batch spoke,
 * so a steady phase is not written on every turn.
 *
 * The phase comes from the batch's progress record, which is the one place
 * that says which stage the batch is in.
 *
 * @param input.atBoundary - Whether the batch is crossing a compaction
 *   boundary right now. When it is not given, the boundary is derived
 *   from the recorded phase: a phase that differs from the one seen last
 *   time IS a crossing.
 * @returns The reminder, or `null` when there is nothing to say.
 */
export function resolveBatchContextReminder(input: {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly batchId: string;
  readonly ratio: number;
  readonly mode: AutoCompactMode;
  readonly atBoundary?: boolean;
  readonly boundaryNotice?: string;
}): BatchContextReminder | null {
  const progress = readBatchProgress(input.projectRoot, input.sessionId, input.batchId);
  if (progress === null) return null;
  const phase = progress.phase;
  const state = readReminderState(input.projectRoot, input.sessionId, input.batchId);
  const atBoundary = input.atBoundary ?? hasCrossedPhase(state, phase);
  const reminder = buildBatchContextReminder({
    ratio: input.ratio,
    mode: input.mode,
    atBoundary,
    ...(input.boundaryNotice === undefined ? {} : { boundaryNotice: input.boundaryNotice })
  });
  const spoken = state.lastSpokenPhase === phase ? null : reminder;
  const next = nextReminderState(state, phase, spoken !== null);
  if (stateChanged(state, next)) {
    writeReminderState(input.projectRoot, input.sessionId, input.batchId, next);
  }
  return spoken;
}

/**
 * The reminder the PRESENCE read should carry, for the batch in flight.
 *
 * The presence read knows the session, not the batch, so the batch in
 * flight is found among the session's batch records (see
 * `findActiveBatch`), and the boundary notice is the one the batch
 * recorded when it last crossed a boundary.
 *
 * @returns The reminder, or `null` when no batch is running, or when
 *   there is nothing to say.
 */
export function resolveBatchPresenceReminder(input: {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly ratio: number;
  readonly mode: AutoCompactMode;
}): BatchContextReminder | null {
  const active = findActiveBatch(input.projectRoot, input.sessionId);
  if (active === null) return null;
  const notice = active.progress.boundaryNotice;
  return resolveBatchContextReminder({
    projectRoot: input.projectRoot,
    sessionId: input.sessionId,
    batchId: active.batchId,
    ratio: input.ratio,
    mode: input.mode,
    ...(notice === undefined ? {} : { boundaryNotice: notice })
  });
}
