/**
 * Per spec §4.2 战略审计 — orchestrator.
 * Pure pass-through to writeStrategy; this exists so the public rd-service
 * entry point is a single function (consistent with tactical-stage).
 */
import { writeStrategy, type WriteStrategyInput } from './strategy.js';
import type { StrategyOutput } from './types.js';

export type RunStrategicInput = WriteStrategyInput;

export async function runStrategicStage(input: RunStrategicInput): Promise<StrategyOutput> {
  return writeStrategy(input);
}
