/**
 * Per spec §4.2 战略审计 — orchestrator.
 * Pure pass-through to writeStrategy; this exists so the public rd-service
 * entry point is a single function (consistent with tactical-stage).
 */
import { dirname } from 'node:path';
import { writeStrategy, type WriteStrategyInput } from './strategy.js';
import type { StrategyOutput } from './types.js';
// H8 chain enforcement (R1-W2): register STRAT.sig by project dir so
// the tactical stage can verify its inputSig chains to a real STRAT upstream.
import { registerStratSig } from './tactical-stage.js';

export type RunStrategicInput = WriteStrategyInput;

export async function runStrategicStage(input: RunStrategicInput): Promise<StrategyOutput> {
  const result = await writeStrategy(input);
  registerStratSig(dirname(input.out), result.sha256);
  return result;
}
