/**
 * Rid-032: opt-in spill/hydrate round-trip for 24h mode.
 * This demo command is additive; existing deferral behavior is unchanged.
 */
import type { Command } from 'commander';
import { ok } from 'peaks-loop-shared/result';

import {
  hydrate,
  listSpills,
  spill,
  spillDir
} from '../../services/context/spillover-store.js';
import { getSessionIdCanonical } from '../../services/session/session-manager.js';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';

type SpillDemoOptions = {
  readonly sessionId?: string;
  readonly project: string;
  readonly batchId?: string;
  readonly json?: boolean;
};

export function registerSpillDemoCommand(parent: Command, io: ProgramIO): void {
  addJsonOption(
    parent
      .command('spill-demo')
      .description('Demonstrate the opt-in spill/hydrate round-trip for 24h mode.')
      .option('--session-id <sessionId>', 'explicit session id (defaults to canonical binding)')
      .option('--project <path>', 'project root', process.cwd())
      .option('--batch-id <batchId>', 'optional in-flight batch id')
  ).action((options: SpillDemoOptions) => {
    const sessionId = options.sessionId ?? getSessionIdCanonical(options.project);
    if (sessionId === null) {
      throw new Error('No active session; provide --session-id or bind a canonical session');
    }

    const spilled = spill(
      {
        sessionId,
        projectRoot: options.project,
        ...(options.batchId === undefined ? {} : { batchId: options.batchId })
      },
      { llm: { turn: 1, context: ['sample'] } }
    );
    const allSpills = listSpills(options.project, sessionId);
    const hydrated = hydrate(options.project, sessionId, spilled.spillId);

    printResult(
      io,
      ok(
        'session.spill-demo',
        {
          spilled: spilled.spillId,
          totalSpills: allSpills.length,
          hydrated
        },
        [],
        [`Spill directory: ${spillDir(options.project, sessionId)}`]
      ),
      options.json === true
    );
  });
}
