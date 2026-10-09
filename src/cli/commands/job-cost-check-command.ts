// Split out of `job-commands.ts`:
// `job karpathy-cost-check`.
import type { Command } from 'commander';
import { fail } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { getCurrentSessionId } from '../../services/skills/skill-presence-service.js';
import {
  buildCostCheckEnvelope,
  runKarpathyCostCheck
} from '../../services/karpathy-cost/karpathy-cost-check-service.js';
import { read24hState } from '../../services/24h-mode/store.js';
import { asJson, failResult, projectRoot, type JobCostCheckOpts } from './job-command-shared.js';
import { SESSION_ID_HELP } from './job-state-root.js';

const COST_CHECK_DESCRIPTION =
  "Read the slice's rd/karpathy-review.md and decide whether to downgrade a block gateAction to warn (slice 2026-07-30-karpathy-cost-self-review).";
const COST_CHECK_REVIEW_FILE_HELP =
  'path to rd/karpathy-review.md (or its .json sibling if the file is JSON)';

function runJobCostCheck(opts: JobCostCheckOpts, io: ProgramIO): void {
  const project = projectRoot(opts);
  const sessionId = opts.sessionId ?? process.env.PEAKS_SESSION_ID ?? getCurrentSessionId(project);
  if (!sessionId) {
    return failResult(
      io,
      fail(
        'karpathy-cost-check',
        'NO_ACTIVE_SESSION',
        'karpathy-cost-check requires --session-id (or an active peaks-code session)',
        { project },
        [
          'Re-run with --session-id <sid>',
          'Or run `peaks workspace init` to create a session first'
        ]
      ),
      opts
    );
  }
  const is24hModeActive = (): boolean => {
    try {
      const snapshot = read24hState(project, sessionId);
      return snapshot.state === '24H_ACTIVE';
    } catch {
      return false;
    }
  };
  const out = runKarpathyCostCheck({
    reviewFilePath: opts.reviewFile,
    is24hModeActive
  });
  printResult(io, buildCostCheckEnvelope(out), asJson(opts));
}

export function registerJobCostCheckCommand(job: Command, io: ProgramIO): void {
  addJsonOption(
    job
      .command('karpathy-cost-check')
      .description(COST_CHECK_DESCRIPTION)
      .requiredOption('--review-file <path>', COST_CHECK_REVIEW_FILE_HELP)
      .option('--project <repo>')
      .option('--session-id <sid>', SESSION_ID_HELP)
  ).action((opts: JobCostCheckOpts) => runJobCostCheck(opts, io));
}
