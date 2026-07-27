/**
 * `peaks session 24h-mode` — state-only CLI for the 24h mode backbone.
 *
 * Rid-020a (state-only slice). Exposes four sub-actions so the LLM
 * orchestrator can introspect, transition, audit retry attempts, and
 * reset the 24h state machine without touching the JSON file
 * directly. The LLM is the decision-maker; the CLI is the muscle
 * (same contract as `peaks session checkpoint`).
 *
 * Sub-actions (all accept --json for machine-readable envelopes):
 *   - `peaks session 24h-mode state`        — read snapshot
 *   - `peaks session 24h-mode transition`   — move to a new state
 *   - `peaks session 24h-mode attempts`     — read attempts map
 *   - `peaks session 24h-mode reset`        — wipe the snapshot
 *
 * peaks-code is the skill that should drive this CLI; we do not
 * add a new top-level verb (peaks-loop is enhancement, not a new
 * CLI surface — see `.peaks/memory/peaks-loop-is-enhancement-not-new-cli.md`).
 */

import type { Command } from 'commander';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { getErrorMessage, type ProgramIO } from '../cli-helpers.js';
import {
  HANDOFF_EXIT_CONDITIONS,
  STATES,
  emptySnapshot,
  isHandoffExitCondition,
  isState,
  read24hState,
  write24hState,
  type State
} from '../../services/24h-mode/index.js';

type ParentOptions = {
  json?: boolean;
  project?: string;
  sessionId?: string;
};

type TransitionOptions = ParentOptions & {
  state?: string;
  reason?: string;
  exitCondition?: string;
  activeSlices?: string;
};

type SubActionOptions = {
  json?: boolean;
};

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,\r\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function printJson(io: ProgramIO, payload: unknown, options: { json?: boolean }): void {
  if (options.json === true) {
    io.stdout(JSON.stringify(payload) + '\n');
  } else {
    io.stdout(JSON.stringify(payload, null, 2) + '\n');
  }
}

function printError(io: ProgramIO, code: string, message: string, options: { json?: boolean }): void {
  if (options.json === true) {
    io.stderr(JSON.stringify({ ok: false, code, error: message }) + '\n');
  } else {
    io.stderr(`${code}: ${message}\n`);
  }
}

/**
 * Resolve the session id from the parent options; falls back to the
 * canonical session-manager binding if `--session-id` is not set.
 * The dynamic import keeps the static dependency graph clean (no
 * top-level cycle with `session-manager.ts`).
 */
async function resolveSessionIdAsync(opts: ParentOptions): Promise<string | null> {
  if (opts.sessionId) return opts.sessionId;
  const projectRoot = resolveCanonicalProjectRoot(opts.project ?? process.cwd());
  const { getSessionIdCanonical } = await import('../../services/session/session-manager.js');
  return getSessionIdCanonical(projectRoot);
}

export function registerSession24hModeCommand(session: Command, io: ProgramIO): void {
  const cmd = session
    .command('24h-mode')
    .description(
      '24h mode state machine (rid-020a). Sub-actions: state, transition, attempts, reset. ' +
        'persists to .peaks/_runtime/<sessionId>/24h-state.json.'
    )
    .option('--json', 'emit machine-readable JSON envelope')
    .option('--project <path>', 'project root (defaults to current directory)', process.cwd())
    .option('--session-id <sessionId>', 'explicit session id (defaults to canonical binding)');

  // sub-action: state (read snapshot)
  cmd
    .command('state')
    .description('Read the current 24h mode state snapshot')
    .action(async (subOpts: SubActionOptions) => {
      const parentOpts = cmd.opts<ParentOptions>();
      const merged = { ...parentOpts, ...subOpts };
      const projectRoot = resolveCanonicalProjectRoot(merged.project ?? process.cwd());
      const sid = await resolveSessionIdAsync(merged);
      if (!sid) {
        printError(io, 'NO_ACTIVE_SESSION', 'no --session-id and no canonical binding', merged);
        process.exitCode = 1;
        return;
      }
      try {
        const snapshot = read24hState(projectRoot, sid);
        printJson(io, { ok: true, data: snapshot }, merged);
      } catch (error) {
        printError(io, '24H_STATE_READ_FAILED', getErrorMessage(error), merged);
        process.exitCode = 1;
      }
    });

  // sub-action: transition (move to a new state)
  cmd
    .command('transition')
    .description('Move the state machine to a new state')
    .requiredOption('--state <state>', `target state (one of: ${STATES.join(', ')})`)
    .option('--reason <text>', 'human-readable reason for the transition')
    .option('--exit-condition <condition>', `HANDOFF exit condition (one of: ${HANDOFF_EXIT_CONDITIONS.join(', ')})`)
    .option('--active-slices <list>', 'comma-separated active slice ids (e.g. "rid-020a,rid-020b")')
    .action(async (subOpts: TransitionOptions) => {
      const parentOpts = cmd.opts<ParentOptions>();
      const merged: TransitionOptions = { ...parentOpts, ...subOpts };
      const projectRoot = resolveCanonicalProjectRoot(merged.project ?? process.cwd());
      const sid = await resolveSessionIdAsync(merged);
      if (!sid) {
        printError(io, 'NO_ACTIVE_SESSION', 'no --session-id and no canonical binding', merged);
        process.exitCode = 1;
        return;
      }
      if (!merged.state || !isState(merged.state)) {
        printError(io, 'INVALID_STATE', `--state must be one of ${STATES.join(', ')} (got ${JSON.stringify(merged.state)})`, merged);
        process.exitCode = 1;
        return;
      }
      const target = merged.state as State;
      if (merged.exitCondition !== undefined && !isHandoffExitCondition(merged.exitCondition)) {
        printError(io, 'INVALID_EXIT_CONDITION', `--exit-condition must be one of ${HANDOFF_EXIT_CONDITIONS.join(', ')}`, merged);
        process.exitCode = 1;
        return;
      }
      if (target === 'HANDOFF' && !merged.exitCondition) {
        printError(io, 'HANDOFF_REQUIRES_EXIT_CONDITION', 'transitioning to HANDOFF requires --exit-condition', merged);
        process.exitCode = 1;
        return;
      }
      try {
        const current = read24hState(projectRoot, sid);
        const now = new Date().toISOString();
        const sliceList = splitList(merged.activeSlices);
        const next = {
          ...current,
          state: target,
          enteredAt: now,
          enteredFrom: current.state,
          activeSlices: sliceList.length > 0 ? sliceList : current.activeSlices,
          exitCondition: target === 'HANDOFF' ? (merged.exitCondition ?? null) : current.exitCondition
        };
        const result = write24hState(projectRoot, sid, next);
        printJson(io, { ok: true, data: { ...next, path: result.path } }, merged);
      } catch (error) {
        printError(io, '24H_STATE_WRITE_FAILED', getErrorMessage(error), merged);
        process.exitCode = 1;
      }
    });

  // sub-action: attempts (read attempts map)
  cmd
    .command('attempts')
    .description('Read the B3 attempts map (per-key retry counts)')
    .action(async (subOpts: SubActionOptions) => {
      const parentOpts = cmd.opts<ParentOptions>();
      const merged = { ...parentOpts, ...subOpts };
      const projectRoot = resolveCanonicalProjectRoot(merged.project ?? process.cwd());
      const sid = await resolveSessionIdAsync(merged);
      if (!sid) {
        printError(io, 'NO_ACTIVE_SESSION', 'no --session-id and no canonical binding', merged);
        process.exitCode = 1;
        return;
      }
      try {
        const snapshot = read24hState(projectRoot, sid);
        printJson(io, { ok: true, data: { state: snapshot.state, attempts: snapshot.attempts } }, merged);
      } catch (error) {
        printError(io, '24H_STATE_READ_FAILED', getErrorMessage(error), merged);
        process.exitCode = 1;
      }
    });

  // sub-action: reset (wipe the snapshot)
  cmd
    .command('reset')
    .description('Reset the 24h state snapshot to IDLE (fresh start)')
    .action(async (subOpts: SubActionOptions) => {
      const parentOpts = cmd.opts<ParentOptions>();
      const merged = { ...parentOpts, ...subOpts };
      const projectRoot = resolveCanonicalProjectRoot(merged.project ?? process.cwd());
      const sid = await resolveSessionIdAsync(merged);
      if (!sid) {
        printError(io, 'NO_ACTIVE_SESSION', 'no --session-id and no canonical binding', merged);
        process.exitCode = 1;
        return;
      }
      try {
        const fresh = emptySnapshot();
        const result = write24hState(projectRoot, sid, fresh);
        printJson(io, { ok: true, data: { ...fresh, path: result.path } }, merged);
      } catch (error) {
        printError(io, '24H_STATE_WRITE_FAILED', getErrorMessage(error), merged);
        process.exitCode = 1;
      }
    });
}

export const SESSION_24H_MODE_CONSTANTS = {
  STATES,
  HANDOFF_EXIT_CONDITIONS
} as const;
