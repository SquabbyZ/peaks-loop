// src/cli/commands/batch-diagnose-envelope.ts
//
// The envelope the batch's diagnosis stage answers with.
//
// WHY THIS IS ITS OWN FILE. The action beside it was already close to the
// repo's file-size cap, and building the answer is a second responsibility:
// the action runs the stage, this builds what the caller is told.
//
// WHY THE COMPACTION BLOCK IS PART OF THE ANSWER. The phase advance is what
// CHOOSES the compaction point, so the caller is told which point it is
// rather than left to work it out — and the line that tells it to compact
// appears only when a compaction is actually chosen.

import { ok } from 'peaks-loop-shared/result';

import { printResult, type ProgramIO } from '../cli-helpers.js';
import type { BatchMode } from '../../services/batch/batch-entry.js';
import type { BatchProgress } from '../../services/batch/batch-progress-types.js';
import type { BatchCompactionPoint } from '../../services/code/batch-compaction-point.js';
import type { SubAgentToolCall } from '../../services/dispatch/sub-agent-dispatcher.js';

/**
 * What the caller is told to do next.
 *
 * The compaction line appears only when a compaction is actually chosen:
 * a stage that did not cross a boundary says nothing about compaction.
 */
function diagnoseNextActions(compaction: BatchCompactionPoint): string[] {
  return [
    'Execute each toolCall; each diagnostician reads and reports, and changes nothing.',
    'Re-run this command with the measured file sets to record them and plan the waves.',
    ...(compaction.shouldCompact
      ? [
          'The batch crossed a phase boundary and the window is in the auto-compact zone: ' +
            'this is the cheapest moment to compact, because the progress is on disk. ' +
            'Run the auto-compact command yourself now.'
        ]
      : [])
  ];
}

/**
 * The envelope the diagnosis stage answers with.
 *
 * Split out so the action stays one thing: the stage runs, and the answer
 * is built. The compaction block is part of the answer because the phase
 * advance is what CHOOSES the compaction point — the caller is told which
 * point it is, rather than left to work it out.
 */
export function printDiagnoseResult(input: {
  readonly io: ProgramIO;
  readonly asJson: boolean;
  readonly mode: BatchMode;
  readonly rid: string;
  readonly sessionId: string;
  readonly progress: BatchProgress;
  readonly pendingCount: number;
  readonly toolCalls: readonly SubAgentToolCall[];
  readonly undiagnosable: readonly string[];
  readonly compaction: BatchCompactionPoint;
}): void {
  const { io, asJson, mode, rid, sessionId, progress, pendingCount, toolCalls, undiagnosable } =
    input;
  printResult(
    io,
    ok(
      'batch.diagnose',
      {
        envelopeVersion: '2.1.0',
        mode,
        rid,
        sessionId,
        itemCount: progress.items.length,
        pendingCount,
        toolCalls,
        topology: progress.topology,
        compaction: {
          point: input.compaction.kind,
          shouldCompact: input.compaction.shouldCompact,
          ratio: input.compaction.ratio,
          atBoundary: input.compaction.atBoundary
        }
      },
      undiagnosable.map(
        (id) =>
          `item ${id} is pending but carries no symptom, so no diagnosis was dispatched for it`
      ),
      diagnoseNextActions(input.compaction)
    ),
    asJson
  );
}
