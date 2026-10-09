/**
 * The dispatch back-off: whether a compact was already asked for this crossing.
 *
 * Split out of `auto-compact-orchestrator.ts` (file-size cap campaign). The
 * orchestrator re-exports every name declared here, so existing importers keep
 * using `./auto-compact-orchestrator.js` unchanged.
 */
import { readOpenDispatchRun } from './auto-compact-lifecycle.js';
import { thresholdFor } from './auto-compact-modes.js';
import type { AutoCompactResult } from '../context/auto-compact-types.js';
import type { CompactRun } from './auto-compact-run-types.js';

/**
 * The decision fires whenever the ratio is at or over the auto-fire threshold, and
 * the ratio does not come back down on its own — nothing in peaks-loop can compact a
 * running session, and the harness fires only at its own red line. So "shouldCompact"
 * was true on every probe, forever: one real session's `compact-history.jsonl` holds
 * 1075 dispatch rows, 444 checkpoints and ZERO compactions over 15.5 h. Re-dispatching
 * bought nothing, because the `ide-native` dispatch only installs a PreToolUse hook
 * and installing it again is a documented no-op: 1074 of those 1075 rows say `already
 * installed` in their own `dispatchMessage`. It produced rows, not compactions.
 *
 * The lifecycle store already knows whether an attempt is outstanding (`readOpenDispatchRun`
 * — `armed`/`compacting` = dispatched, `completed`/`failed` = over), so the gate needs no
 * new state and no threshold: it is keyed on the STAGE of the open run, never on a ratio,
 * which is why it survives any future realignment of the 0.65/0.70/0.85/0.95 table.
 *
 * What is NOT suppressed: the probe still measures and still reports. The envelope carries
 * the LIVE ratio plus the ratio the open ask was made at, so "it crossed and it is still
 * high, unanswered" stays legible on every turn — the difference between a quiet signal
 * and a silenced one.
 *
 * `force` (the `--force` test seam, "force compact at any ratio") outranks the inference:
 * an explicit instruction must not be silently reduced to a no-op, which would make the
 * published flag a lie.
 *
 * `readOpenDispatchRun` answers in THREE states, not two. `none` admits the dispatch;
 * `unresolvable` means the backoff's question could not be asked — the session id names
 * no session directory, so no lifecycle record can answer it. Measured on ONE directory
 * before this: a legal sid found the open `armed` run and suppressed the dispatch, while
 * `./<legal sid>`, which joins to the identical path, returned `null` and dispatched. A
 * gate that reads a string instead of the artifact the string names is the defect the
 * whole id axis exists to close, so an unanswerable question is NOT an admit: the
 * conservative direction is to leave the dispatch undone and say why.
 */
export function readOpenRunGate(ctx: CompactRun): AutoCompactResult | null {
  const { input, sessionId, probe, mode, harnessWindow } = ctx;
  const openRun = readOpenDispatchRun({ projectRoot: input.projectRoot, sessionId });
  if (openRun.kind === 'unresolvable' && input.force !== true) {
    return {
      ok: true,
      code: 'AUTO_COMPACT_UNRESOLVED_SESSION',
      message:
        `Context at ${(probe.ratio * 100).toFixed(1)}%; a compact may be warranted, but this session's ` +
        `directory could not be resolved (${openRun.reason}), so whether a compact was already dispatched ` +
        `for this crossing cannot be answered. Not dispatching: an unanswered question is not a 'no'. ` +
        `The session id comes from the active binding or from the caller.`,
      data: {
        sessionId,
        ratio: probe.ratio,
        source: probe.source,
        decision: 'unresolved-session',
        harnessWindow
      }
    };
  }
  if (openRun.kind === 'open' && input.force !== true) {
    return {
      ok: true,
      code: 'AUTO_COMPACT_ALREADY_ARMED',
      message:
        `Context at ${(probe.ratio * 100).toFixed(1)}% — still above the ` +
        `${(thresholdFor(mode, 'autoFire') * 100).toFixed(0)}% auto-fire threshold (mode=${mode}); ` +
        `a compact was already dispatched for this crossing at ${(openRun.triggerRatio * 100).toFixed(1)}% ` +
        `(run ${openRun.runId}, resting at '${openRun.stage}') and nothing has compacted since. ` +
        `Not dispatching again: the trigger is already registered, so a second dispatch would install the ` +
        `same hook and add a checkpoint and a history row without adding a capability. ` +
        `Re-probe with \`peaks code context-now\`.`,
      data: {
        sessionId,
        ratio: probe.ratio,
        source: probe.source,
        decision: 'already-armed',
        armedAtRatio: openRun.triggerRatio,
        armedRunId: openRun.runId,
        harnessWindow
      }
    };
  }
  return null;
}
