import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { readSopManifest } from './sop-service.js';
import { sopStatePath } from './sop-paths.js';
import { evaluateGate, type EvaluateGateOptions } from './sop-check-service.js';
import type { SopCheckResult } from './sop-types.js';

/**
 * SOP phase advancement with gate enforcement — Feature A, Slice 3 (range 3).
 *
 * `advanceSop` moves a SOP to a target phase only if (a) the move does not skip
 * ahead in the declared phase order, and (b) every gate guarding that phase
 * passes. A forward skip throws SopPhaseSkipError (SOP_PHASE_SKIP); a
 * fail/blocked gate throws SopGateBlockedError (SOP_GATE_BLOCKED). Both block
 * UNCONDITIONALLY in all modes — a gate is an objective check, not a
 * confirmation prompt, so a mode could never silently skip it (that would
 * defeat "don't drop steps"). The only escape is an explicit bypass
 * (allowIncomplete), which the CLI gates behind --reason / --confirm / a cap.
 *
 * The SOP *definition* is global (`~/.peaks/sops/`), but run-state is
 * PER-PROJECT (`<project>/.peaks/sop-state/<id>.json`) so the same authored SOP
 * tracks independent progress in every project it runs in.
 *
 * This is a standalone command path: it does NOT touch the built-in request
 * artifact transition machinery or mode-enforcement, so those keep their exact
 * behavior (preserved behavior P2/P3).
 */

export type BlockedGate = {
  gateId: string;
  result: SopCheckResult;
  reason?: string;
};

export type SopHistoryEntry = {
  phase: string;
  bypassed: boolean;
  reason?: string;
};

export type SopState = {
  currentPhase: string | null;
  history: SopHistoryEntry[];
};

export type AdvanceSopResult = {
  id: string;
  phase: string;
  bypassed: boolean;
  previousPhase: string | null;
  /** false when --dry-run evaluated the gates without recording the advance. */
  applied: boolean;
};

export type AdvanceSopOptions = {
  projectRoot: string;
  id: string;
  toPhase: string;
  allowCommands?: boolean;
  allowIncomplete?: boolean;
  reason?: string;
  commandTimeoutMs?: number;
  /** Evaluate gates (still blocks on failure) but do not write state.json. */
  dryRun?: boolean;
};

export class SopAdvanceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'SopAdvanceError';
    this.code = code;
  }
}

export class SopGateBlockedError extends Error {
  readonly code = 'SOP_GATE_BLOCKED';
  readonly blockedGates: BlockedGate[];
  constructor(toPhase: string, blockedGates: BlockedGate[]) {
    super(`Cannot advance to "${toPhase}": ${blockedGates.length} gate(s) not satisfied (${blockedGates.map((g) => `${g.gateId}=${g.result}`).join(', ')})`);
    this.name = 'SopGateBlockedError';
    this.blockedGates = blockedGates;
  }
}

export class SopPhaseSkipError extends Error {
  readonly code = 'SOP_PHASE_SKIP';
  readonly fromPhase: string | null;
  readonly toPhase: string;
  readonly expectedNext: string;
  constructor(fromPhase: string | null, toPhase: string, expectedNext: string) {
    super(`Cannot advance to "${toPhase}": it skips ahead of the declared phase order (current: ${fromPhase ?? 'none'}, next allowed: ${expectedNext}). Bypass with --allow-incomplete --reason "<why>" if you really must skip.`);
    this.name = 'SopPhaseSkipError';
    this.fromPhase = fromPhase;
    this.toPhase = toPhase;
    this.expectedNext = expectedNext;
  }
}

const EMPTY_STATE: SopState = { currentPhase: null, history: [] };

export async function readSopState(projectRoot: string, id: string): Promise<SopState> {
  const path = sopStatePath(projectRoot, id);
  if (!existsSync(path)) {
    return { currentPhase: null, history: [] };
  }
  const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<SopState>;
  return {
    currentPhase: typeof parsed.currentPhase === 'string' ? parsed.currentPhase : null,
    history: Array.isArray(parsed.history) ? parsed.history : []
  };
}

/**
 * Enforce declared phase order: a move may stay put, step back, or advance to
 * the immediately-next phase, but must not skip ahead. `currentPhase: null`
 * (never advanced) is treated as index -1, so only the first phase is reachable.
 * Throws SopPhaseSkipError on a forward skip.
 */
function assertNoPhaseSkip(phases: string[], currentPhase: string | null, toPhase: string): void {
  const currentIndex = currentPhase === null ? -1 : phases.indexOf(currentPhase);
  const targetIndex = phases.indexOf(toPhase);
  // A current phase that is no longer declared (hand-edited manifest) cannot
  // anchor order; fall back to "first phase only" rather than silently allowing.
  const anchorIndex = currentIndex >= 0 ? currentIndex : -1;
  if (targetIndex > anchorIndex + 1) {
    // A forward skip means anchorIndex + 1 < targetIndex ≤ phases.length - 1,
    // so the next phase always exists — no fallback branch needed.
    const expectedNext = phases[anchorIndex + 1] as string;
    throw new SopPhaseSkipError(currentPhase, toPhase, expectedNext);
  }
}

export async function advanceSop(options: AdvanceSopOptions): Promise<AdvanceSopResult> {
  const manifest = await readSopManifest(options.id);
  if (manifest === null) {
    throw new SopAdvanceError('SOP_NOT_FOUND', `No SOP found for id "${options.id}"`);
  }
  if (!manifest.phases.includes(options.toPhase)) {
    throw new SopAdvanceError('INVALID_PHASE', `Phase "${options.toPhase}" is not declared by SOP "${options.id}"`);
  }

  const previous = await readSopState(options.projectRoot, options.id);
  const phaseGates = manifest.gates.filter((gate) => gate.phase === options.toPhase);

  if (options.allowIncomplete !== true) {
    // Structural check first: a forward skip is invalid regardless of gate state.
    assertNoPhaseSkip(manifest.phases, previous.currentPhase, options.toPhase);

    const evaluateOptions: EvaluateGateOptions = {};
    if (options.allowCommands !== undefined) evaluateOptions.allowCommands = options.allowCommands;
    if (options.commandTimeoutMs !== undefined) evaluateOptions.commandTimeoutMs = options.commandTimeoutMs;

    const blocked: BlockedGate[] = [];
    for (const gate of phaseGates) {
      const verdict = evaluateGate(options.projectRoot, gate, evaluateOptions);
      if (verdict.result !== 'pass') {
        blocked.push(verdict.reason === undefined
          ? { gateId: gate.id, result: verdict.result }
          : { gateId: gate.id, result: verdict.result, reason: verdict.reason });
      }
    }
    if (blocked.length > 0) {
      throw new SopGateBlockedError(options.toPhase, blocked);
    }
  }

  const bypassed = options.allowIncomplete === true;

  if (options.dryRun === true) {
    return { id: options.id, phase: options.toPhase, bypassed, previousPhase: previous.currentPhase, applied: false };
  }

  const entry: SopHistoryEntry = options.reason === undefined
    ? { phase: options.toPhase, bypassed }
    : { phase: options.toPhase, bypassed, reason: options.reason };
  const nextState: SopState = {
    currentPhase: options.toPhase,
    history: [...previous.history, entry]
  };

  const path = sopStatePath(options.projectRoot, options.id);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(nextState, null, 2)}\n`, 'utf8');

  return { id: options.id, phase: options.toPhase, bypassed, previousPhase: previous.currentPhase, applied: true };
}

export { EMPTY_STATE };
