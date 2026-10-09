import type { Command } from 'commander';
import {
  describeMemoryBlockDrops,
  executeProjectMemoryExtract,
  SENSITIVE_MEMORY_CHECKS,
  summarizeProjectMemoryExtractResult,
  UnsafeMemoryError
} from '../../../services/memory/project-memory-service.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../../cli-helpers.js';
import { refuseBothFlags } from './memory-command-shared.js';

type ExtractOptions = {
  project: string;
  artifact: string[];
  dryRun?: boolean;
  apply?: boolean;
  json?: boolean;
};

/**
 * The remedy for a failed `memory extract`, chosen by the check that refused
 * the write — the same `SENSITIVE_MEMORY_CHECKS` values the refusal message
 * and envelope data are built from, so the message, the data and the advice
 * cannot drift apart.
 *
 * WHY IT IS NOT ONE STATIC STRING. Every failure used to get "Check artifact
 * paths and remove secrets before extracting memory" — including a refusal
 * raised only because a memory TITLE contained a word like `authority`
 * (slice C0). There was no secret anywhere in that memory, so the one thing
 * the hint told the user to do was the one thing that could not help: it sent
 * check that actually failed.
 *
 * `null` (a failure that is not a safety refusal — a path escape, a missing
 * artifact) keeps the pre-C0 hint, which is about paths and secrets rather
 * than about a check.
 */
function memoryExtractNextActions(refusal: UnsafeMemoryError | null): string[] {
  if (refusal === null) {
    return ['Check artifact paths and remove secrets before extracting memory'];
  }
  if (refusal.check === SENSITIVE_MEMORY_CHECKS.title) {
    return [
      'Retitle the memory so it is not named after a credential term, then re-run memory extract'
    ];
  }
  if (refusal.check === SENSITIVE_MEMORY_CHECKS.content) {
    // Name the rule, not just the family. `matchedTerm` is a closed id
    // (`credential-assignment`, `bearer-value`, `pem-private-key`, …), so the
    // reader can tell a credential in the text from a sentence that merely has
    // the shape of one — which is the difference between removing a value and
    // rewording prose.
    return [
      `Remove the credential value the "${refusal.matchedTerm}" pattern matched, then re-run memory extract`
    ];
  }
  return ['Remove the credential value from the memory content, then re-run memory extract'];
}

function runExtract(io: ProgramIO, options: ExtractOptions): void {
  const result = executeProjectMemoryExtract({
    projectRoot: options.project,
    artifactPaths: options.artifact,
    apply: options.apply === true
  });
  // A block that was found but not extracted must not vanish silently: the
  // parser's rejection reasons ride the envelope's existing `warnings`
  // channel (JSON: `warnings[]`; human: `warning: …` on stderr). `data` is
  // unchanged — this adds no field to the summary.
  printResult(
    io,
    ok(
      'memory.extract',
      summarizeProjectMemoryExtractResult(result),
      describeMemoryBlockDrops(result.droppedBlocks)
    ),
    options.json
  );
}

function emitExtractFailure(io: ProgramIO, options: ExtractOptions, error: unknown): void {
  const refusal = error instanceof UnsafeMemoryError ? error : null;
  printResult(
    io,
    fail(
      'memory.extract',
      'MEMORY_EXTRACT_FAILED',
      getErrorMessage(error),
      // The check and the term are facts about the failure, so they ride
      // the envelope's data — not just its prose. `fail()` redacts
      // `message` (see `UnsafeMemoryError`), so the term would otherwise
      // reach the reader as `[redacted]`; `data` is passed through.
      refusal === null ? {} : { check: refusal.check, matchedTerm: refusal.matchedTerm },
      memoryExtractNextActions(refusal)
    ),
    options.json
  );
  process.exitCode = 1;
}

export function registerMemoryExtractCommand(memory: Command, io: ProgramIO): void {
  addJsonOption(
    memory
      .command('extract')
      .description('Extract stable project memory from skill artifacts into project .peaks/memory')
      .requiredOption('--project <path>', 'target project root')
      .requiredOption('--artifact <path...>', 'skill artifact paths inside the project')
      .option('--dry-run', 'preview writes without changing files')
      .option('--apply', 'write extracted memories into project .peaks/memory')
  ).action((options: ExtractOptions) => {
    const refused = refuseBothFlags(io, {
      command: 'memory.extract',
      code: 'INVALID_MEMORY_EXTRACT_FLAGS',
      nextActions: ['Run without --apply to preview writes, or pass --apply to write memories'],
      json: options.json,
      dryRun: options.dryRun,
      apply: options.apply
    });
    if (refused) return;
    try {
      runExtract(io, options);
    } catch (error) {
      emitExtractFailure(io, options, error);
    }
  });
}
