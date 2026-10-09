/**
 * The `finalize` action body for `peaks sub-agent`, split out of
 * `share-commands.ts` so that registrar file stays under the line cap. The
 * registrar fires this runner without awaiting it (the original fired a
 * floating async IIFE in the same way).
 *
 * `runFinalizeSweep` builds the accumulator, applies the outcome mapping and
 * prints the envelope; the three selection branches live in
 * `finalize-branches.ts` and the selection rule itself in
 * `finalize-selection.ts`.
 */
import { resolve } from 'node:path';

import { fail, getErrorMessage, ok } from 'peaks-loop-shared/result';

import { printResult, type ProgramIO } from '../cli-helpers.js';
import { getCurrentSessionId } from '../../services/skills/skill-presence-service.js';
import type { DispatchRecord } from '../../services/dispatch/dispatch-record-writer.js';
import type { FinalizeOptions, FinalizeSelection } from './finalize-selection.js';
import {
  OUTCOME_MAP,
  buildFinalizeHints,
  makeAccumulator,
  tryReadRecord,
  type FinalizeAccumulator
} from './finalize-accumulator.js';
import { finalizeAllStale, finalizeByBatch, finalizeByRequestId } from './finalize-branches.js';

export async function runFinalize(options: FinalizeOptions, io: ProgramIO): Promise<void> {
  const asJson = options.json === true;
  try {
    const projectRoot = resolve(options.project ?? process.cwd());
    const sessionId = options.sessionId ?? getCurrentSessionId(projectRoot) ?? 'unknown-sid';
    if (!options.allStale && !options.requestId && !options.batch) {
      printResult(
        io,
        fail(
          'sub-agent.finalize',
          'MISSING_TARGET',
          'Pass --request-id or --batch (or --all-stale)',
          { ok: false } as never,
          ['Call finalize after each Task completes.']
        ),
        asJson
      );
      process.exitCode = 1;
      return;
    }
    await runFinalizeSweep({ options, io, asJson, projectRoot, sessionId });
  } catch (error: unknown) {
    printResult(
      io,
      fail('sub-agent.finalize', 'FINALIZE_ERROR', getErrorMessage(error), { ok: false } as never, [
        'Inspect the error.'
      ]),
      asJson
    );
    process.exitCode = 1;
  }
}

async function runFinalizeSweep(input: {
  options: FinalizeOptions;
  io: ProgramIO;
  asJson: boolean;
  projectRoot: string;
  sessionId: string;
}): Promise<void> {
  const { options, io, asJson, projectRoot, sessionId } = input;
  const outcome = (options.outcome ?? 'done') as 'done' | 'failed' | 'cancelled';
  const writerMod = await import('../../services/dispatch/dispatch-record-writer.js');
  const { readRecord, markCompleted, readActiveDispatchIndex } = writerMod;
  const mapped = OUTCOME_MAP[outcome] ?? OUTCOME_MAP['done']!;
  const acc = makeAccumulator();
  const readOne = (recordPath: string): DispatchRecord | null =>
    tryReadRecord(recordPath, readRecord, acc);
  const apply = (recordPath: string, rid: string): void => {
    markCompleted({
      recordPath,
      now: () => new Date(),
      status: mapped.status,
      outcome: mapped.outcome,
      projectRoot
    });
    acc.finalized.push({ recordPath, requestId: rid, status: mapped.status });
  };
  let selection: FinalizeSelection | null = null;
  if (options.allStale) {
    finalizeAllStale({ readActiveDispatchIndex, projectRoot, sessionId, apply, acc });
  } else if (options.requestId) {
    const result = await finalizeByRequestId({
      projectRoot,
      sessionId,
      requestId: options.requestId,
      io,
      asJson,
      readOne,
      apply,
      acc
    });
    if (result.kind === 'not-found') return;
    selection = result.selection;
  } else {
    await finalizeByBatch({ projectRoot, sessionId, batchId: options.batch, readOne, apply, acc });
  }
  printFinalizeResult({ io, asJson, sessionId, outcome, acc, selection });
  if (acc.errors.length > 0) process.exitCode = 1;
}

/** Print the `sub-agent.finalize` envelope and its hints. */
function printFinalizeResult(input: {
  io: ProgramIO;
  asJson: boolean;
  sessionId: string;
  outcome: 'done' | 'failed' | 'cancelled';
  acc: FinalizeAccumulator;
  selection: FinalizeSelection | null;
}): void {
  const { acc } = input;
  printResult(
    input.io,
    ok(
      'sub-agent.finalize',
      {
        finalized: acc.finalized,
        skipped: acc.skipped,
        errors: acc.errors,
        selection: input.selection,
        sessionId: input.sessionId,
        outcome: input.outcome
      },
      acc.errors.length > 0 ? [acc.errors.length + ' failed'] : [],
      buildFinalizeHints(acc, input.selection)
    ),
    input.asJson
  );
}
