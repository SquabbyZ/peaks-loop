/**
 * Per spec §4.3 战术审计 (peaks-rd/战术) — orchestrator.
 * Runs AST gate first; only writes TACT.sig if gate passes.
 * Spec anchor: docs/superpowers/specs/2026-06-21-context-audit-redesign-design.md §4.3
 * (R1-W3 consolidation; previously referenced as §4.2 which is `peaks-mut`).
 */
import { dirname } from 'node:path';
import { runAstGate, type AstGateContext } from './ast-gate.js';
import { writeImpl } from './impl.js';
import type { ImplOutput } from './types.js';

// H8 (audit trail hashable): TACT.inputSig MUST equal STRAT.sig upstream.
// WHY load-bearing: without this check, an orchestrator could fabricate
// any 64-hex inputSig and forge impl.json files that claim authority from
// a non-existent strategy. Per-process Map keyed by dirname(stratOut)
// because STRAT and TACT both write into the same project dir in v1.
export const STRAT_SIG_REGISTRY = new Map<string, string>();
export function registerStratSig(projectDir: string, sig: string): void {
  STRAT_SIG_REGISTRY.set(projectDir, sig);
}
export const STRAT_SIG_CHAIN_INVARIANT = 'STRAT.sig chain broken';

export interface RunTacticalInput {
  readonly project: string;
  readonly changedFiles: ReadonlyArray<string>;
  readonly inputSig: string;
  readonly context: AstGateContext;
  readonly out: string;
}

/**
 * Run the tactical stage: AST gate → STRAT.sig chain check → TACT.sig write.
 *
 * @remarks
 * **Call-order contract (H8 / load-bearing):** the caller MUST invoke
 * `registerStratSig(projectDir, inputSig)` BEFORE calling `runTacticalStage`.
 * The chain check runs AFTER the AST gate (intentionally — see inline comment
 * below) and keys `STRAT_SIG_REGISTRY` by `dirname(input.out)`. If no STRAT.sig
 * is registered for that key, this function throws
 * `${STRAT_SIG_CHAIN_INVARIANT}: stratSig=<unregistered>`. The common
 * production path is `runStrategicStage(...)` → `runTacticalStage(...)`;
 * `runStrategicStage` calls `registerStratSig` internally.
 *
 * @param input - project, changed files, inputSig (must match registered
 *                STRAT.sig for `dirname(input.out)`), AST-gate context, output path.
 * @returns `ImplOutput` written atomically to `input.out`.
 * @throws When the AST gate fails (re-thrown from `runAstGate`).
 * @throws When `inputSig` does not match the registered STRAT.sig for the
 *         project dir, or when no STRAT.sig is registered.
 */
export async function runTacticalStage(input: RunTacticalInput): Promise<ImplOutput> {
  const astGate = await runAstGate({
    project: input.project,
    changedFiles: input.changedFiles,
    context: input.context,
  });
  // H8 chain enforcement: inputSig must equal STRAT.sig for this project.
  // Runs AFTER AST gate so existing AST-gate error semantics are preserved.
  const projectDir = dirname(input.out);
  const stratSig = STRAT_SIG_REGISTRY.get(projectDir);
  if (stratSig === undefined || stratSig !== input.inputSig) {
    throw new Error(
      `${STRAT_SIG_CHAIN_INVARIANT}: inputSig=${input.inputSig.slice(0, 12)}… ` +
      `stratSig=${stratSig ? stratSig.slice(0, 12) + '…' : '<unregistered>'} ` +
      `(projectDir=${projectDir})`
    );
  }
  return writeImpl({
    out: input.out,
    inputSig: input.inputSig,
    changedFiles: input.changedFiles,
    externalApiCalls: [], // v1: AST gate emits violations; future slice maps to calls
    astGate,
  });
}
