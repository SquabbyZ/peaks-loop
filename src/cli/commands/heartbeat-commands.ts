/**
 * `peaks sub-agent heartbeat` — G6: append a heartbeat to a dispatch record.
 *
 * Pulled out of `sub-agent-commands.ts` (slice 2026-06-23-audit-p0-split)
 * to honor the 800-line file cap. The heartbeat is fire-and-forget; the
 * parent Dispatcher polls the record during the batch-sync wait and
 * renders a status line. Sub-agents should call this at least every
 * 30s (configurable via SKILL.md heartbeatIntervalSec).
 *
 * R-2 path guard: `assertSafeDispatchRecordPath` ensures the record
 * lives under `.peaks/_sub_agents/` so a malicious `--record` arg can't
 * point at a sensitive file outside the runtime tree.
 *
 * Slice c1-eslint-family-sweep / leaf c1w1-heartbeat-commands: the action the
 * `.action()` below wires lives in `heartbeat-commands-action.ts` (write path)
 * and `heartbeat-commands-validation.ts` (argument checks and reject envelopes)
 * — the option surface and the graph-node projections stayed here.
 */
import type { Command } from 'commander';

import { addJsonOption, type ProgramIO } from '../cli-helpers.js';
import { runHeartbeatAction } from './heartbeat-commands-action.js';
import type { HeartbeatActionOptions } from './heartbeat-commands-validation.js';

export function registerHeartbeatCommand(parent: Command, io: ProgramIO): void {
  addJsonOption(
    parent
      .command('heartbeat')
      .description(
        'Append a heartbeat entry to a dispatch record. Fire-and-forget: ' +
          'the parent Dispatcher polls this record during the batch-sync ' +
          'wait and renders a status line. Sub-agents should call this at ' +
          'least every 30s (configurable via SKILL.md heartbeatIntervalSec).'
      )
      .requiredOption('--record <path>', 'absolute path to a dispatch record JSON')
      .requiredOption(
        '--status <state>',
        'queued | running | finalizing | done | failed | stale | cancelled | no-execution | never-started | unreadable'
      )
      .requiredOption('--progress <pct>', 'integer 0-100')
      .option('--note <text>', 'free-form progress note (≤ 200 chars)')
      // Slice 2026-07-29-dispatch-stall-governance / S5 (AC-5.2) —
      // optional --stage flag. The label is bounded (see
      // src/services/dispatch/stage-enum.ts); an unknown value is
      // rejected with INVALID_STAGE so the watch surface never
      // accumulates typo'd labels.
      .option(
        '--stage <label>',
        'bounded stage label (intake | planning | gathering | analyzing | writing | testing | reviewing | finalizing)'
      )
      .option(
        '--project <path>',
        "trusted project root (defaults to cwd); used for the R-2 path guard so a malicious --record cannot point at another project's dispatch record"
      )
  ).action((options: HeartbeatActionOptions) => {
    runHeartbeatAction(io, options);
  });
}

/* ---------- Slice 4.0.8 RD §4 D4b: graph-node heartbeat projection ---------- */

/** The graph-node input both projections below read. */
type GraphNodeHeartbeatInput = {
  dispatchRef?: string;
  graphNodeId?: string;
  status?: string;
  now?: string;
  lastHeartbeat?: string;
};

/**
 * The `running` projection both arms of `heartbeat` return. The two arms were
 * already literal-for-literal identical in the source (a dispatched node and a
 * running node both project to `status: 'running'`); the branch is kept because
 * merging it is a behaviour decision, not a lint one — this extraction only
 * moves the shared object literal so the function fits `complexity`.
 */
function runningHeartbeatProjection(input: GraphNodeHeartbeatInput): Record<string, unknown> {
  return {
    status: 'running',
    lastHeartbeat: input.lastHeartbeat ?? input.now ?? new Date().toISOString(),
    graphNodeId: input.graphNodeId ?? null,
    dispatchRef: input.dispatchRef ?? null
  };
}

/**
 * Programmatic `heartbeat` projection used by
 * tests/integration/sub-agent-graph-heartbeat.test.ts.
 */
export function heartbeat(input: GraphNodeHeartbeatInput): Record<string, unknown> {
  const status = (input.status ?? 'dispatched') as
    | 'prepared'
    | 'dispatched'
    | 'running'
    | 'envelope-received'
    | 'consumed-by-parent'
    | 'terminalized'
    | 'lost';
  if (status === 'dispatched') {
    return runningHeartbeatProjection(input);
  }
  return runningHeartbeatProjection(input);
}

/**
 * Programmatic `markLost` projection. Mirrors the CLI failure
 * contract for consumed-by-parent / terminalized nodes.
 */
export function markLost(input: {
  dispatchRef?: string;
  graphNodeId?: string;
  status?: string;
  reason?: string;
}): Record<string, unknown> {
  if (input.status === 'consumed-by-parent' || input.status === 'terminalized') {
    const err = new Error(
      'PEAKS_NODE_TRANSITION_INVALID: cannot mark-lost a consumed/terminal node'
    ) as Error & { code: string };
    err.code = 'PEAKS_NODE_TRANSITION_INVALID';
    throw err;
  }
  const reason = input.reason ?? 'unknown';
  return {
    status: 'lost',
    terminalReason: reason,
    graphNodeId: input.graphNodeId ?? null,
    dispatchRef: input.dispatchRef ?? null
  };
}
