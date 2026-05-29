import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readSopManifest, sopDir } from './sop-service.js';
import { evaluateGate, type EvaluateGateOptions } from './sop-check-service.js';
import type { SopCheckResult } from './sop-types.js';

/**
 * SOP phase advancement with gate enforcement — Feature A, Slice 3 (range 3).
 *
 * `advanceSop` moves a SOP to a target phase only if every gate guarding that
 * phase passes; a fail/blocked gate throws SopGateBlockedError (the blocking
 * error the CLI surfaces as SOP_GATE_BLOCKED). Gates block UNCONDITIONALLY in
 * all modes — a gate is an objective check, not a confirmation prompt, so a
 * mode could never silently skip it (that would defeat "don't drop steps").
 * The only escape is an explicit bypass (allowIncomplete), which the CLI gates
 * behind --reason / --confirm / a bypass cap.
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
};

export type AdvanceSopOptions = {
  projectRoot: string;
  id: string;
  toPhase: string;
  allowCommands?: boolean;
  allowIncomplete?: boolean;
  reason?: string;
  commandTimeoutMs?: number;
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

const EMPTY_STATE: SopState = { currentPhase: null, history: [] };

function statePath(projectRoot: string, id: string): string {
  return join(sopDir(projectRoot, id), 'state.json');
}

export async function readSopState(projectRoot: string, id: string): Promise<SopState> {
  const path = statePath(projectRoot, id);
  if (!existsSync(path)) {
    return { currentPhase: null, history: [] };
  }
  const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<SopState>;
  return {
    currentPhase: typeof parsed.currentPhase === 'string' ? parsed.currentPhase : null,
    history: Array.isArray(parsed.history) ? parsed.history : []
  };
}

export async function advanceSop(options: AdvanceSopOptions): Promise<AdvanceSopResult> {
  const manifest = await readSopManifest(options.projectRoot, options.id);
  if (manifest === null) {
    throw new SopAdvanceError('SOP_NOT_FOUND', `No SOP found for id "${options.id}"`);
  }
  if (!manifest.phases.includes(options.toPhase)) {
    throw new SopAdvanceError('INVALID_PHASE', `Phase "${options.toPhase}" is not declared by SOP "${options.id}"`);
  }

  const phaseGates = manifest.gates.filter((gate) => gate.phase === options.toPhase);

  if (options.allowIncomplete !== true) {
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

  const previous = await readSopState(options.projectRoot, options.id);
  const bypassed = options.allowIncomplete === true;
  const entry: SopHistoryEntry = options.reason === undefined
    ? { phase: options.toPhase, bypassed }
    : { phase: options.toPhase, bypassed, reason: options.reason };
  const nextState: SopState = {
    currentPhase: options.toPhase,
    history: [...previous.history, entry]
  };

  const path = statePath(options.projectRoot, options.id);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(nextState, null, 2)}\n`, 'utf8');

  return { id: options.id, phase: options.toPhase, bypassed, previousPhase: previous.currentPhase };
}

export { EMPTY_STATE };
