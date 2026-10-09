// src/cli/commands/contract-write-command.ts
//
// `peaks contract write` — persist a finished slice's public surface (exports /
// types / publicSignatures) to
// `.peaks/_runtime/<sessionId>/dispatch/contracts/<slice-id>.json`, where the
// orchestrator picks it up on the next dispatch run. Extracted from
// `governance-classify-contract-commands.ts` (which had merged
// `contract-commands.ts` and `classify-classify-commands.ts` verbatim); the
// registered name, description, options, refusal codes and envelope are
// unchanged.
//
// The guards and the write are separate functions because the merged file had
// all three inline in one 151-line registrar, and every branch there was over
// the per-function line cap on its own.

import type { Command } from 'commander';
import { fail, getErrorMessage, ok, type ResultEnvelope } from 'peaks-loop-shared/result';

import { writeContract, type WriteContractInput } from '../../services/dispatch/contract-store.js';
import { getCurrentSessionId } from '../../services/skills/skill-presence-service.js';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';

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

/** The four comma-separated flag values, split and trimmed. */
interface ContractLists {
  readonly exports: readonly string[];
  readonly types: readonly string[];
  readonly signatures: readonly string[];
  readonly broadcastTo: readonly string[];
}

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
        'are primitives that peaks-code / peaks-rd SKILL.md compose. The LLM-side ' +
        'runner (the IDE-resident sub-agent that finished a slice) calls ' +
        "`peaks contract write` to persist the slice's public surface; the " +
        'orchestrator picks it up on the next dispatch run via listContracts() ' +
        'and splices it into downstream prompts via formatContractInjection().'
    );

  addJsonOption(contractWriteCommand(contract)).action((options: ContractWriteOptions) => {
    const envelope = contractWriteEnvelope(options);
    printResult(io, envelope, options.json === true);
    if (!envelope.ok) process.exitCode = 1;
  });
}

// peaks contract write --project <root> --session-id <sid>
//   --slice-id <id> --exports <a,b> --types <x,y> --signatures <s1,s2>
//   [--broadcast-to <b1,b2>] [--completed-at <iso>]
function contractWriteCommand(contract: Command): Command {
  return contract
    .command('write')
    .description(
      "2.7.0 slice-dag-dispatcher MVP: persist a finished slice's public " +
        'surface (exports / types / publicSignatures) to disk at ' +
        '.peaks/_runtime/<sessionId>/dispatch/contracts/<slice-id>.json. ' +
        'The orchestrator picks it up on the next dispatch run. Idempotent: ' +
        're-running with the same inputs overwrites in place; the SHA-256 ' +
        'contractHash is content-derived so a contract write from a different ' +
        'runner (re-execution) is detected as a content change.'
    )
    .option('--project <path>', 'target project root (defaults to cwd)')
    .option(
      '--session-id <sid>',
      'session id (default: resolve from .peaks/_runtime/session.json; falls back to PEAKS_SESSION_ID env var; final fallback "unknown-sid")'
    )
    .requiredOption(
      '--slice-id <id>',
      'slice id; must be non-empty; used as the contract filename basename'
    )
    .option(
      '--exports <list>',
      'comma-separated public export names (e.g. "validateDag,topologicalLevels")'
    )
    .option('--types <list>', 'comma-separated public type names (e.g. "SliceDag,SliceNode")')
    .option(
      '--signatures <list>',
      'comma-separated public function/method signatures (e.g. "validateDag(dag: SliceDag): void")'
    )
    .option(
      '--broadcast-to <list>',
      'comma-separated downstream slice ids that should auto-inherit this contract (e.g. "B,C")'
    )
    .option('--completed-at <iso>', 'ISO 8601 timestamp; defaults to now()');
}

/** The written-contract envelope, or the refusal the caller earned. */
function contractWriteEnvelope(options: ContractWriteOptions): ResultEnvelope<unknown> {
  const projectRoot = options.project ?? process.cwd();
  const sid =
    options.sessionId ??
    process.env['PEAKS_SESSION_ID'] ??
    getCurrentSessionId(projectRoot) ??
    'unknown-sid';
  const lists: ContractLists = {
    exports: splitCsv(options.exports),
    types: splitCsv(options.types),
    signatures: splitCsv(options.signatures),
    broadcastTo: splitCsv(options.broadcastTo)
  };
  const refusal = contractWriteRefusal(options, sid, lists);
  if (refusal !== null) return refusal;

  try {
    const result = writeContract(projectRoot, sid, contractWriteInput(options, sid, lists));
    return ok(
      'contract.write',
      contractWriteData(result),
      [],
      [
        'Contract written; orchestrator will pick it up on the next `peaks sub-agent dispatch --from-dag` run.',
        'Re-running with the same inputs is idempotent (overwrites in place).'
      ]
    );
  } catch (err) {
    return fail(
      'contract.write',
      'WRITE_ERROR',
      getErrorMessage(err),
      { path: null, contract: null } as never,
      [
        'See error message; check that --project is a writable directory and --slice-id is a valid filename basename (no path separators).'
      ]
    );
  }
}

/**
 * The `writeContract` input: `--broadcast-to` and `--completed-at` ride only
 * when the caller set them, so an absent flag never becomes an empty value.
 */
function contractWriteInput(
  options: ContractWriteOptions,
  sid: string,
  lists: ContractLists
): WriteContractInput {
  return {
    // The refusal above already rejected `undefined` / empty.
    sliceId: options.sliceId as string,
    sessionId: sid,
    exports: lists.exports,
    types: lists.types,
    publicSignatures: lists.signatures,
    ...(lists.broadcastTo.length > 0 ? { broadcastTo: lists.broadcastTo } : {}),
    ...(options.completedAt !== undefined ? { completedAt: options.completedAt } : {})
  };
}

/** The written contract, counted per surface — never the raw store row. */
function contractWriteData(result: ReturnType<typeof writeContract>): Record<string, unknown> {
  return {
    path: result.path,
    contractHash: result.contract.contractHash,
    sliceId: result.contract.sliceId,
    sessionId: result.contract.sessionId,
    completedAt: result.contract.completedAt,
    exportCount: result.contract.exports.length,
    typeCount: result.contract.types.length,
    signatureCount: result.contract.publicSignatures.length,
    broadcastTo: result.contract.broadcastTo ?? []
  };
}

/** The two pre-write refusals (missing slice id, oversized input), or `null`. */
function contractWriteRefusal(
  options: ContractWriteOptions,
  sid: string,
  lists: ContractLists
): ResultEnvelope<never> | null {
  const sliceId = options.sliceId;
  if (sliceId === undefined || sliceId.length === 0) {
    return fail(
      'contract.write',
      'MISSING_SLICE_ID',
      '--slice-id is required',
      { path: null, contract: null } as never,
      ['Re-run with --slice-id <id> (must be non-empty; used as the contract filename basename).']
    );
  }

  // Cap the combined input to protect the file IO from runaway values
  // (e.g. a 10MB comma-separated --signatures flag).
  const inputSize =
    sliceId.length +
    sid.length +
    lists.exports.join(',').length +
    lists.types.join(',').length +
    lists.signatures.join(',').length +
    lists.broadcastTo.join(',').length +
    (options.completedAt?.length ?? 0);
  if (inputSize <= INPUT_LIMIT_BYTES) return null;
  return fail(
    'contract.write',
    'INPUT_TOO_LARGE',
    `combined input size ${inputSize} bytes exceeds ${INPUT_LIMIT_BYTES} (likely oversized --exports/--types/--signatures lists)`,
    { path: null, contract: null } as never,
    ['Split the slice into smaller surfaces or omit optional fields.']
  );
}
