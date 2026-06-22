/**
 * Per spec §4.2 战术审计 — orchestrator.
 * Runs AST gate first; only writes TACT.sig if gate passes.
 */
import { runAstGate, type AstGateContext } from './ast-gate.js';
import { writeImpl } from './impl.js';
import type { ImplOutput } from './types.js';

export interface RunTacticalInput {
  readonly project: string;
  readonly changedFiles: ReadonlyArray<string>;
  readonly inputSig: string;
  readonly context: AstGateContext;
  readonly out: string;
}

export async function runTacticalStage(input: RunTacticalInput): Promise<ImplOutput> {
  const astGate = await runAstGate({
    project: input.project,
    changedFiles: input.changedFiles,
    context: input.context,
  });
  return writeImpl({
    out: input.out,
    inputSig: input.inputSig,
    changedFiles: input.changedFiles,
    externalApiCalls: [], // v1: AST gate emits violations; future slice maps to calls
    astGate,
  });
}
