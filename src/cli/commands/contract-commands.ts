/**
 * `peaks contract` CLI commands — 2.7.0 slice-dag-dispatcher MVP
 * (slice 1.2.c — LLM-side contract writer).
 *
 * Round-2 fix #5 (upgrade placeholder prompt) tells the LLM-side
 * runner to execute `peaks contract write --project <root> ...` to
 * persist its slice's public surface so the orchestrator can splice
 * the contract into downstream dispatch prompts via
 * `formatContractInjection`. This file is the actual implementation
 * of that command — without it, the round-2 prompt would direct the
 * LLM to a CLI that doesn't exist (the round-5 audit caught this).
 *
 * The command is a thin wrapper over `writeContract` from
 * `src/services/dispatch/contract-store.ts`; it accepts the same
 * shape, splits the comma-separated `--exports` / `--types` /
 * `--signatures` flag values into arrays, and surfaces the result
 * via the standard `ok` / `fail` envelope used across peaks-cli.
 *
 * Skill-first / CLI-auxiliary red line: users do not invoke this
 * directly. The peaks-solo / peaks-rd LLM-side runner (the
 * IDE-resident sub-agent that finished a slice) calls this command
 * after the slice completes.
 */
import { Command } from 'commander';
import { fail, ok, getErrorMessage } from '../../shared/result.js';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import {
  writeContract,
  type WriteContractInput
} from '../../services/dispatch/contract-store.js';

const INPUT_LIMIT_BYTES = 256 * 1024;

type ContractWriteOptions = {
  project?: string;
  sessionId?: string;
  sliceId?: string;
  exports?: string;
  types?: string;
  signatures?: string;
  broadcastTo?: string;
  completedAt?: string;
  json?: boolean;
};

/** Split a comma-separated flag value into a trimmed string array. */
function splitCsv(value: string | undefined): readonly string[] {
  if (value === undefined) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function registerContractCommands(program: Command, io: ProgramIO): void {
  const contract = program
    .command('contract')
    .description(
      'Slice contract store (skill-first / CLI-auxiliary). These commands ' +
      'are primitives that peaks-solo / peaks-rd SKILL.md compose. The LLM-side ' +
      'runner (the IDE-resident sub-agent that finished a slice) calls ' +
      '`peaks contract write` to persist the slice\'s public surface; the ' +
      'orchestrator picks it up on the next dispatch run via listContracts() ' +
      'and splices it into downstream prompts via formatContractInjection().'
    );

  // ─────────────────────────────────────────────────────────────────
  // peaks contract write --project <root> --session-id <sid>
  //   --slice-id <id> --exports <a,b> --types <x,y> --signatures <s1,s2>
  //   [--broadcast-to <b1,b2>] [--completed-at <iso>]
  // ─────────────────────────────────────────────────────────────────
  addJsonOption(
    contract
      .command('write')
      .description(
        '2.7.0 slice-dag-dispatcher MVP: persist a finished slice\'s public ' +
        'surface (exports / types / publicSignatures) to disk at ' +
        '.peaks/_runtime/<sessionId>/dispatch/contracts/<slice-id>.json. ' +
        'The orchestrator picks it up on the next dispatch run. Idempotent: ' +
        're-running with the same inputs overwrites in place; the SHA-256 ' +
        'contractHash is content-derived so a contract write from a different ' +
        'runner (re-execution) is detected as a content change.'
      )
      .option('--project <path>', 'target project root (defaults to cwd)')
      .option('--session-id <sid>', 'session id (defaults to "unknown-sid")')
      .requiredOption('--slice-id <id>', 'slice id; must be non-empty; used as the contract filename basename')
      .option('--exports <list>', 'comma-separated public export names (e.g. "validateDag,topologicalLevels")')
      .option('--types <list>', 'comma-separated public type names (e.g. "SliceDag,SliceNode")')
      .option('--signatures <list>', 'comma-separated public function/method signatures (e.g. "validateDag(dag: SliceDag): void")')
      .option('--broadcast-to <list>', 'comma-separated downstream slice ids that should auto-inherit this contract (e.g. "B,C,D")')
      .option('--completed-at <iso>', 'ISO 8601 timestamp; defaults to now()')
  ).action((options: ContractWriteOptions) => {
    const asJson = options.json === true;
    const projectRoot = options.project ?? process.cwd();
    const sid = options.sessionId ?? 'unknown-sid';
    const sliceId = options.sliceId;

    if (sliceId === undefined || sliceId.length === 0) {
      printResult(io, fail('contract.write', 'MISSING_SLICE_ID', '--slice-id is required', { path: null, contract: null } as never, [
        'Re-run with --slice-id <id> (must be non-empty; used as the contract filename basename).'
      ]), asJson);
      process.exitCode = 1;
      return;
    }

    const exports = splitCsv(options.exports);
    const types = splitCsv(options.types);
    const signatures = splitCsv(options.signatures);
    const broadcastTo = splitCsv(options.broadcastTo);

    // Cap the combined input to protect the file IO from runaway values
    // (e.g. a 10MB comma-separated --signatures flag).
    const inputSize =
      sliceId.length +
      sid.length +
      exports.join(',').length +
      types.join(',').length +
      signatures.join(',').length +
      broadcastTo.join(',').length +
      (options.completedAt?.length ?? 0);
    if (inputSize > INPUT_LIMIT_BYTES) {
      printResult(io, fail('contract.write', 'INPUT_TOO_LARGE', `combined input size ${inputSize} bytes exceeds ${INPUT_LIMIT_BYTES} (likely oversized --exports/--types/--signatures lists)`, { path: null, contract: null } as never, [
        'Split the slice into smaller surfaces or omit optional fields.'
      ]), asJson);
      process.exitCode = 1;
      return;
    }

    try {
      const input: WriteContractInput = {
        sliceId,
        sessionId: sid,
        exports,
        types,
        publicSignatures: signatures,
        ...(broadcastTo.length > 0 ? { broadcastTo } : {}),
        ...(options.completedAt !== undefined ? { completedAt: options.completedAt } : {})
      };
      const result = writeContract(projectRoot, sid, input);
      printResult(io, ok('contract.write', {
        path: result.path,
        contractHash: result.contract.contractHash,
        sliceId: result.contract.sliceId,
        sessionId: result.contract.sessionId,
        completedAt: result.contract.completedAt,
        exportCount: result.contract.exports.length,
        typeCount: result.contract.types.length,
        signatureCount: result.contract.publicSignatures.length,
        broadcastTo: result.contract.broadcastTo ?? []
      }, [], [
        `Contract written; orchestrator will pick it up on the next \`peaks sub-agent dispatch --from-dag\` run.`,
        `Re-running with the same inputs is idempotent (overwrites in place).`
      ]), asJson);
    } catch (err) {
      printResult(io, fail('contract.write', 'WRITE_ERROR', getErrorMessage(err), { path: null, contract: null } as never, [
        'See error message; check that --project is a writable directory and --slice-id is a valid filename basename (no path separators).'
      ]), asJson);
      process.exitCode = 1;
    }
  });
}
