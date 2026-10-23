// Split out of `core/skill-presence-commands.ts`: the `skill presence:set`
// command — its option shape, the field refusals and the action. It is its
// own module so neither file sits near the repository's 300-line cap.
//
// The write side is fail-closed on the caller id, and the vendor-neutral
// escape hatches (`--caller-id` / `PEAKS_CALLER_ID`) are what let a host
// that is not Claude Code build a lease at all.
import type { Command } from 'commander';
import {
  setSkillPresence,
  isSkillPresenceMode
} from '../../../services/skills/skill-presence-service.js';
import { resolvePresenceCallerId } from '../../../services/skills/presence-caller-id.js';
import {
  MAX_PRESENCE_GATE_LENGTH,
  normalizePresenceGate
} from '../../../services/skills/presence-gate.js';
import { canonicalizeProjectOption } from './skill-generated-config-notice.js';
import { findProjectRoot } from '../../../services/config/config-safety.js';
import { getSessionId, setSessionMeta } from '../../../services/session/session-manager.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../../cli-helpers.js';

const PRESENCE_SET_DESCRIPTION =
  'Set the currently active Peaks skill for session-wide visibility. Slice 4.0.8: requires a bound session and a resolved caller id (fail-closed); raw unlink is rejected.';
const PRESENCE_SET_MODE_HELP = 'execution mode';
const PRESENCE_SET_GATE_HELP = 'current gate';
const PRESENCE_SET_PROJECT_HELP = 'project root path (auto-detected from cwd when omitted)';
const PRESENCE_SET_CALLER_ID_HELP =
  'caller id for this invocation (priority: --caller-id flag > PEAKS_CALLER_ID env > active IDE adapter); must match ^[a-zA-Z0-9._-]{1,200}$';

// The `request init` exit code for a caller id that was supplied but does
// not match the D1 regex (EX_DATAERR). 64 is the "nothing usable" code.
const CALLER_ID_INVALID_EXIT_CODE = 65;
const CALLER_ID_UNRESOLVED_EXIT_CODE = 1;

export type PresenceSetOptions = {
  mode?: string;
  gate?: string;
  project?: string;
  callerId?: string;
  json?: boolean;
};

function printInvalidMode(io: ProgramIO, options: PresenceSetOptions, name: string): void {
  printResult(
    io,
    fail(
      'skill.presence:set',
      'INVALID_MODE',
      `Invalid mode: ${options.mode} (expected one of: full-auto, assisted, strict, 24h)`,
      { name, mode: options.mode },
      ['Use a valid mode: full-auto, assisted, strict, or 24h']
    ),
    options.json
  );
  process.exitCode = 1;
}

function printInvalidGate(io: ProgramIO, options: PresenceSetOptions, name: string): void {
  printResult(
    io,
    fail(
      'skill.presence:set',
      'INVALID_GATE',
      `Invalid gate: ${options.gate} (expected a non-empty gate value of at most ${MAX_PRESENCE_GATE_LENGTH} characters, without control characters)`,
      { name, gate: options.gate },
      ['Use a short gate value such as `startup`, `qa-validation` or `swarm-fan-out`.']
    ),
    options.json
  );
  process.exitCode = 1;
}

function printSessionNotBound(
  io: ProgramIO,
  options: PresenceSetOptions,
  name: string,
  projectRoot: string
): void {
  printResult(
    io,
    fail(
      'skill.presence:set',
      'PEAKS_SESSION_NOT_BOUND',
      'No canonical peaks session is bound for this project (RD §3 D1).',
      { projectRoot, name },
      ['Run `peaks workspace init --project <p>` first, then re-run `peaks skill presence:set`.']
    ),
    options.json
  );
  process.exitCode = 1;
}

/**
 * The caller-id refusal. `CALLER_ID_INVALID` is a shape mismatch — a value
 * was supplied but does not match the D1 regex. `PEAKS_CALLER_NOT_RESOLVED`
 * means nothing could be resolved at all. Both are fail-closed: no lease is
 * written.
 */
function printCallerFailure(
  io: ProgramIO,
  options: PresenceSetOptions,
  target: { name: string; projectRoot: string },
  failure: { code: 'CALLER_ID_INVALID' | 'PEAKS_CALLER_NOT_RESOLVED'; message: string }
): void {
  const invalid = failure.code === 'CALLER_ID_INVALID';
  printResult(
    io,
    fail(
      'skill.presence:set',
      failure.code,
      invalid ? failure.message : `Could not resolve a callerId: ${failure.message}`,
      target,
      invalid
        ? [
            'Use a caller id matching ^[a-zA-Z0-9._-]{1,200}$ (letters, digits, dot, underscore, hyphen).'
          ]
        : [
            'Pass --caller-id <id>, or set PEAKS_CALLER_ID=<id> in the environment for scripted usage.'
          ]
    ),
    options.json
  );
  process.exitCode = invalid ? CALLER_ID_INVALID_EXIT_CODE : CALLER_ID_UNRESOLVED_EXIT_CODE;
}

/**
 * The mode and the gate are checked BEFORE any write. The gate is persisted
 * with the lease (it is the middle cell of the status header); unknown but
 * well-formed gate values are accepted on purpose — the gate vocabulary is
 * open (see `presence-gate.ts`).
 */
function validateSetFields(io: ProgramIO, options: PresenceSetOptions, name: string): boolean {
  if (options.mode !== undefined && !isSkillPresenceMode(options.mode)) {
    printInvalidMode(io, options, name);
    return false;
  }
  if (options.gate !== undefined) {
    try {
      normalizePresenceGate(options.gate);
    } catch {
      printInvalidGate(io, options, name);
      return false;
    }
  }
  return true;
}

/**
 * Resolve the caller id, or print the refusal and return null. The
 * `--caller-id` flag and `PEAKS_CALLER_ID` are the vendor-neutral escape
 * hatches; the active IDE adapter is the fallback. The priority chain
 * lives in `resolve-caller-id.ts` and is not restated here.
 */
function resolveSetCallerId(
  io: ProgramIO,
  options: PresenceSetOptions,
  target: { name: string; projectRoot: string }
): string | null {
  const resolved = resolvePresenceCallerId({
    projectRoot: target.projectRoot,
    ...(options.callerId !== undefined ? { flagValue: options.callerId } : {})
  });
  if (resolved.ok) return resolved.callerId;
  printCallerFailure(io, options, target, resolved);
  return null;
}

export function runSkillPresenceSet(
  name: string,
  options: PresenceSetOptions,
  io: ProgramIO
): void {
  const projectOption = canonicalizeProjectOption(options.project);
  const projectRoot = projectOption ?? findProjectRoot(process.cwd()) ?? process.cwd();
  if (!validateSetFields(io, options, name)) return;
  // `presence:set` is fail-closed. We refuse any write when (a) no peaks
  // session is bound, or (b) no callerId could be resolved — both BEFORE
  // any filesystem write. The escape hatch for (b) is vendor-neutral:
  // `--caller-id` / PEAKS_CALLER_ID beat the IDE adapter, so a host that
  // is not Claude Code can still build a lease.
  const boundSessionId = getSessionId(projectRoot);
  if (boundSessionId === null) {
    printSessionNotBound(io, options, name, projectRoot);
    return;
  }
  const callerId = resolveSetCallerId(io, options, { name, projectRoot });
  if (callerId === null) return;
  const presence = setSkillPresence(name, options.mode, options.gate, {
    projectRootOverride: projectOption,
    callerIdOverride: callerId
  });
  // Session metadata is updated when a session is bound (read-only path:
  // `getSessionId`). We do not auto-spawn a session. The resolved callerId
  // is recorded as the session's outer-session id so a later read can tell
  // the recorded presence belongs to this caller.
  if (boundSessionId !== null) {
    setSessionMeta(projectRoot, boundSessionId, {
      skill: name,
      ...(options.mode ? { mode: options.mode } : {}),
      ...(options.gate ? { gate: options.gate } : {}),
      outerSessionId: callerId
    });
  }
  printResult(io, ok('skill.presence:set', { active: true, ...presence }), options.json);
}

export function registerSkillPresenceSetCommand(skill: Command, io: ProgramIO): void {
  addJsonOption(
    skill
      .command('presence:set <name>')
      .description(PRESENCE_SET_DESCRIPTION)
      .option('--mode <mode>', PRESENCE_SET_MODE_HELP)
      .option('--gate <gate>', PRESENCE_SET_GATE_HELP)
      .option('--caller-id <id>', PRESENCE_SET_CALLER_ID_HELP)
      .option('--project <path>', PRESENCE_SET_PROJECT_HELP)
  ).action((name: string, options: PresenceSetOptions) => runSkillPresenceSet(name, options, io));
}
