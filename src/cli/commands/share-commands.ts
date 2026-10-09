/**
 * `peaks sub-agent share | shared-read | await | finalize` — the registrar layer.
 *
 * These commands share the G8.4 dispatcher-mediated cross-sub-agent signal
 * channel:
 *   - `share` writes a `<role>.<event>` entry (≤ 1KB soft warn, ≥ 64KB reject).
 *   - `shared-read` returns sibling entries (filtered by `--since` / `--key` glob).
 *   - `await` joins a batch barrier (slice 2.7.0 MVP, claude-code only).
 *   - `finalize` (D21) signals that a dispatched sub-agent has finished.
 *
 * Not peer-to-peer — pseudo-swarm property 3 preserved.
 *
 * The action bodies, error-code hints, record-path scans and the finalize
 * selection contract live in the sibling `share-*.ts` / `finalize-*.ts` modules;
 * this file keeps the command shape (names, descriptions, options) and the one
 * lazily-resolved IDE registry consumer below.
 */
import type { Command } from 'commander';

import { addJsonOption, type ProgramIO } from '../cli-helpers.js';
import type { AwaitOptions, ShareOptions, SharedReadOptions } from './sub-agent-shared.js';
import { runAwait, type AwaitIdeResolution } from './await-runners.js';
import { runFinalize } from './finalize-runners.js';
import { runShare } from './share-runners.js';
import { runSharedRead } from './shared-read-runners.js';
import type { FinalizeOptions } from './finalize-selection.js';

// The finalize selection contract is imported by the finalize tests from this
// entry file, so it stays re-exported here even though its implementation
// moved to a sibling module.
export {
  FINALIZE_SELECTION_RULE,
  describeFinalizeRejection,
  selectFinalizeTarget,
  type FinalizeCandidate,
  type FinalizeSelection
} from './finalize-selection.js';
export type { FinalizeOptions } from './finalize-selection.js';

const SHARE_DESCRIPTION =
  'G8.4: write a shared entry to the cross sub-agent shared channel. ' +
  'Dispatcher-mediated indirect signal: sub-agent A writes, dispatcher ' +
  'stores, sub-agent B (still in flight) reads via `peaks sub-agent ' +
  'shared-read`. Not peer-to-peer; pseudo-swarm property 3 preserved.';

const SHARED_READ_DESCRIPTION =
  'G8.4: read entries from the cross sub-agent shared channel. ' +
  'Returns sibling sub-agent status. Supports --since (ISO8601) ' +
  'and --key (glob pattern with * wildcard).';

const AWAIT_DESCRIPTION =
  '2.7.0 slice-dag-dispatcher MVP: wait for a batch of dispatched sub-agents ' +
  'to finish (or hit --timeout). Returns one BatchResult per dispatch. ' +
  'For non-claude-code IDEs, the wait is delegated to the LLM (slice 1.3 will ' +
  'land real per-IDE joins).';

const FINALIZE_DESCRIPTION =
  'D21: signal that a dispatched sub-agent has finished (success/failure/cancellation). Pass --all-stale for crash-recovery sweep.';

export function registerShareCommand(parent: Command, io: ProgramIO): void {
  addJsonOption(
    parent
      .command('share')
      .description(SHARE_DESCRIPTION)
      .requiredOption('--batch <batchId>', 'batchId (from `peaks sub-agent dispatch` envelope)')
      .requiredOption('--key <k>', 'entry key (convention: "<role>.<event>")')
      .requiredOption('--value <json>', 'JSON object value (≤ 1KB soft warn, ≥ 64KB rejected)')
      .option(
        '--from <role>',
        'sub-agent role string; defaults to dispatch record role if available'
      )
      .option('--request-id <rid>', 'request id (default: "unknown-rid")')
      .option(
        '--session-id <sid>',
        'session id (default: resolve from .peaks/_runtime/session.json; falls back to PEAKS_SESSION_ID env var; final fallback "unknown-sid")'
      )
      .option('--project <path>', 'target project root (defaults to cwd)')
  ).action((options: ShareOptions) => runShare(options, io));
}

export function registerSharedReadCommand(parent: Command, io: ProgramIO): void {
  addJsonOption(
    parent
      .command('shared-read')
      .description(SHARED_READ_DESCRIPTION)
      .requiredOption('--batch <batchId>', 'batchId (from `peaks sub-agent dispatch` envelope)')
      .option('--since <iso>', 'only return entries written after this ISO8601 timestamp')
      .option('--key <pattern>', 'glob pattern, e.g. "rd.*" or "*.completed"')
      .option('--request-id <rid>', 'request id (default: "unknown-rid")')
      .option(
        '--session-id <sid>',
        'session id (default: resolve from .peaks/_runtime/session.json; falls back to PEAKS_SESSION_ID env var; final fallback "unknown-sid")'
      )
      .option('--project <path>', 'target project root (defaults to cwd)')
  ).action((options: SharedReadOptions) => runSharedRead(options, io));
}

export function registerAwaitCommand(parent: Command, io: ProgramIO): void {
  addJsonOption(
    parent
      .command('await')
      .description(AWAIT_DESCRIPTION)
      .requiredOption('--batch <batchId>', 'batchId from a dispatch envelope')
      .option(
        '--timeout <ms>',
        'optional cap on how long the join waits (ms; default 60000, max 120000)'
      )
      .option('--project <path>', 'target project root (defaults to cwd)')
      .option(
        '--session-id <sid>',
        'override active session id (default: resolve from .peaks/_runtime/session.json; falls back to PEAKS_SESSION_ID env var; final fallback "unknown-sid")'
      )
  ).action((options: AwaitOptions) => runAwait(options, io, resolveIdeDispatcher));
}

/** Contract: LLM MUST call once per dispatched Task, in post-completion branch. */
export function registerFinalizeCommand(parent: Command, io: ProgramIO): void {
  addJsonOption(
    parent
      .command('finalize')
      .description(FINALIZE_DESCRIPTION)
      .option('--batch <batchId>', 'batchId from dispatch envelope')
      .option('--request-id <rid>', 'requestId from dispatch envelope')
      .option('--outcome <state>', 'done | failed | cancelled (default: done)')
      .option('--error <msg>', 'error message (when --outcome=failed)')
      .option('--all-stale', 'bulk-mark every queued record for this session as done')
      .option('--project <path>', 'target project root (defaults to cwd)')
      .option('--session-id <sid>', 'override active session id')
  ).action((options: FinalizeOptions) => {
    void runFinalize(options, io);
  });
}

/**
 * Resolve the per-IDE sub-agent dispatcher for `await`, importing the IDE
 * modules lazily so `peaks sub-agent share` and `peaks sub-agent shared-read`
 * (the high-frequency G8.4 path) do not pay for adapter resolution at
 * module-load time.
 *
 * This lives here, not in the await runner, because this module is the adapter
 * registry's consumer — `tests/unit/runtime/vendor-neutral-identity-guard.test.ts`
 * pins that this file is in the guard's measured scope.
 */
async function resolveIdeDispatcher(projectRoot: string): Promise<AwaitIdeResolution> {
  const { detectInstalledIde } = await import('../../services/ide/ide-detector.js');
  const { getAdapter } = await import('../../services/ide/ide-registry.js');
  const ide = detectInstalledIde(projectRoot) ?? 'claude-code';
  const adapter = getAdapter(ide);
  return { ide, dispatcher: adapter.subAgentDispatcher };
}
