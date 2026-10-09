// Split out of `core/skill-command.ts`:
// `skill presence` and `skill presence:set`. The envelope builders are
// separate functions so each one stays inside the 50-code-line function cap
// (the presence action was 54, presence:set 67).
import type { Command } from 'commander';
import {
  setSkillPresence,
  getSkillPresence,
  isSkillPresenceMode,
  checkStalePresence
} from '../../../services/skills/skill-presence-service.js';
import { findProjectRoot } from '../../../services/config/config-safety.js';
import { getSessionId, setSessionMeta } from '../../../services/session/session-manager.js';
import { resolveCallerProjection } from '../../../services/session/resolve-caller-id.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../../cli-helpers.js';
import {
  canonicalizeProjectOption,
  generatedConfigNotice
} from './skill-generated-config-notice.js';
import { contextVerdict } from './skill-context-verdict.js';

const PRESENCE_DESCRIPTION = 'Show the currently active Peaks skill (alias: presence:get)';
const PRESENCE_CHECK_STALE_HELP =
  'slice 002 (v2.15.0): also report whether the recorded outer session id still matches the current one. Default false (back-compat).';
const PRESENCE_PROJECT_HELP = 'project root (default: cwd)';
const PRESENCE_SET_DESCRIPTION =
  'Set the currently active Peaks skill for session-wide visibility. Slice 4.0.8: requires a bound session and an adapter-resolved caller id (fail-closed); raw unlink is rejected.';
const PRESENCE_SET_MODE_HELP = 'execution mode';
const PRESENCE_SET_GATE_HELP = 'current gate';
const PRESENCE_SET_PROJECT_HELP = 'project root path (auto-detected from cwd when omitted)';

type GeneratedConfig = ReturnType<typeof generatedConfigNotice>;
type ContextVerdict = ReturnType<typeof contextVerdict>;

type PresenceParts = { verdict: ContextVerdict; generatedConfig: GeneratedConfig };
type PresenceOptions = { json?: boolean; checkStale?: boolean; project?: string };
type PresenceSetOptions = { mode?: string; gate?: string; project?: string; json?: boolean };

function presenceActiveData(
  presence: Record<string, unknown>,
  parts: PresenceParts
): Record<string, unknown> {
  return {
    active: true,
    ...presence,
    ...(parts.verdict.context !== null ? { context: parts.verdict.context } : {}),
    ...parts.generatedConfig.field
  };
}

function presenceStaleData(
  presence: Record<string, unknown>,
  staleness: ReturnType<typeof checkStalePresence>,
  parts: PresenceParts
): Record<string, unknown> {
  return {
    active: true,
    ...presence,
    stale: staleness.stale,
    staleReason: staleness.reason,
    currentOuterSessionId: staleness.currentOuterSessionId,
    recordedOuterSessionId: staleness.recordedOuterSessionId,
    ...(parts.verdict.context !== null ? { context: parts.verdict.context } : {}),
    ...parts.generatedConfig.field
  };
}

function runSkillPresence(options: PresenceOptions, io: ProgramIO): void {
  const projectOption = canonicalizeProjectOption(options.project);
  const generatedConfig = generatedConfigNotice(
    projectOption ?? findProjectRoot(process.cwd()) ?? process.cwd()
  );
  const presence = getSkillPresence(projectOption);
  if (presence === null) {
    printResult(
      io,
      ok('skill.presence', { active: false, ...generatedConfig.field }, generatedConfig.warnings),
      options.json
    );
    return;
  }
  // Loop-hygiene verdict: attached to every ACTIVE read, so the
  // zero-pause contract travels with the one call every skill already
  // makes — in every mode and every consumer project.
  const verdict = contextVerdict(projectOption ?? process.cwd());
  const parts = { verdict, generatedConfig };
  // `--check-stale` lets callers (peaks-code Step 1, statusline) get both
  // pieces of info from a single CLI invocation. The presence is returned
  // UNCHANGED — it is a read-only flag, not a clear.
  const data =
    options.checkStale === true
      ? presenceStaleData(
          presence,
          checkStalePresence({ projectRootOverride: projectOption }),
          parts
        )
      : presenceActiveData(presence, parts);
  printResult(
    io,
    ok('skill.presence', data, generatedConfig.warnings, verdict.nextActions),
    options.json
  );
}

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

function printCallerNotResolved(
  io: ProgramIO,
  options: PresenceSetOptions,
  target: { name: string; projectRoot: string },
  err: unknown
): void {
  const message = err instanceof Error ? err.message : String(err);
  printResult(
    io,
    fail(
      'skill.presence:set',
      'PEAKS_CALLER_NOT_RESOLVED',
      `Active IDE adapter could not resolve a callerId (RD §3 D1): ${message}`,
      target,
      [
        'Ensure the active IDE is detected by `peaks` and the IDE session variable is set.',
        'Or set PEAKS_CALLER_ID=<id> in the environment for scripted usage.'
      ]
    ),
    options.json
  );
  process.exitCode = 1;
}

function runSkillPresenceSet(name: string, options: PresenceSetOptions, io: ProgramIO): void {
  const projectOption = canonicalizeProjectOption(options.project);
  const projectRoot = projectOption ?? findProjectRoot(process.cwd()) ?? process.cwd();
  if (options.mode !== undefined && !isSkillPresenceMode(options.mode)) {
    printInvalidMode(io, options, name);
    return;
  }
  // Slice 4.0.8 (D1 + D2): `presence:set` is fail-closed. We refuse
  // any write when (a) no peaks session is bound, or (b) the active
  // IDE adapter cannot resolve a valid callerId. Both failures
  // surface BEFORE any filesystem write. The legacy
  // `setSkillPresence` wrapper is kept as a compat shim for tests
  // and CLI flows that intentionally do not need a session — but
  // production CLI traffic must go through this gate.
  const boundSessionId = getSessionId(projectRoot);
  if (boundSessionId === null) {
    printSessionNotBound(io, options, name, projectRoot);
    return;
  }
  try {
    resolveCallerProjection({ projectRoot });
  } catch (err) {
    printCallerNotResolved(io, options, { name, projectRoot }, err);
    return;
  }
  const presence = setSkillPresence(name, options.mode, options.gate, projectOption);
  // Session metadata is updated when a session is bound (read-only
  // path: `getSessionId`). We do not auto-spawn a session.
  if (boundSessionId !== null) {
    setSessionMeta(projectRoot, boundSessionId, {
      skill: name,
      ...(options.mode ? { mode: options.mode } : {}),
      ...(options.gate ? { gate: options.gate } : {})
    });
  }
  printResult(io, ok('skill.presence:set', { active: true, ...presence }), options.json);
}

export function registerSkillPresenceCommands(skill: Command, io: ProgramIO): void {
  addJsonOption(
    skill
      .command('presence')
      .description(PRESENCE_DESCRIPTION)
      .option('--check-stale', PRESENCE_CHECK_STALE_HELP)
      .option('--project <path>', PRESENCE_PROJECT_HELP)
  ).action((options: PresenceOptions) => runSkillPresence(options, io));

  addJsonOption(
    skill
      .command('presence:set <name>')
      .description(PRESENCE_SET_DESCRIPTION)
      .option('--mode <mode>', PRESENCE_SET_MODE_HELP)
      .option('--gate <gate>', PRESENCE_SET_GATE_HELP)
      .option('--project <path>', PRESENCE_SET_PROJECT_HELP)
  ).action((name: string, options: PresenceSetOptions) => runSkillPresenceSet(name, options, io));
}
