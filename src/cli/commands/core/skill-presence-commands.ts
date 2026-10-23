// Split out of `core/skill-command.ts`:
// `skill presence` and `skill presence:set`. The envelope builders are
// separate functions so each one stays inside the 50-code-line function cap.
// `skill presence:set` lives in the sibling `skill-presence-set-command.ts`.
import type { Command } from 'commander';
import {
  getSkillPresence,
  checkStalePresence
} from '../../../services/skills/skill-presence-service.js';
import {
  diagnosePresence,
  resolveProjectRoot
} from '../../../services/skills/presence-lease-resolver.js';
import type { PresenceInactiveDiagnostic } from '../../../services/skills/presence-lease-selection.js';
import { findProjectRoot } from '../../../services/config/config-safety.js';
import { ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../../cli-helpers.js';
import {
  canonicalizeProjectOption,
  generatedConfigNotice
} from './skill-generated-config-notice.js';
import { contextVerdict } from './skill-context-verdict.js';
import { registerSkillPresenceSetCommand } from './skill-presence-set-command.js';

const PRESENCE_DESCRIPTION = 'Show the currently active Peaks skill (alias: presence:get)';
const PRESENCE_CHECK_STALE_HELP =
  'slice 002 (v2.15.0): also report whether the recorded outer session id still matches the current one. Default false (back-compat).';
const PRESENCE_PROJECT_HELP = 'project root (default: cwd)';

type GeneratedConfig = ReturnType<typeof generatedConfigNotice>;
type ContextVerdict = ReturnType<typeof contextVerdict>;

type PresenceParts = { verdict: ContextVerdict; generatedConfig: GeneratedConfig };
type PresenceOptions = { json?: boolean; checkStale?: boolean; project?: string };

function presenceActiveData(
  presence: Record<string, unknown>,
  parts: PresenceParts
): Record<string, unknown> {
  return {
    active: true,
    ...presence,
    gate: readGateField(presence.gate),
    ...(parts.verdict.context !== null ? { context: parts.verdict.context } : {}),
    ...parts.generatedConfig.field
  };
}

/**
 * The gate cell of the status header. `null` when the active lease records
 * no gate (a lease written before the gate was persisted).
 */
function readGateField(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function presenceStaleData(
  presence: Record<string, unknown>,
  staleness: ReturnType<typeof checkStalePresence>,
  parts: PresenceParts
): Record<string, unknown> {
  return {
    active: true,
    ...presence,
    gate: readGateField(presence.gate),
    stale: staleness.stale,
    staleReason: staleness.reason,
    currentOuterSessionId: staleness.currentOuterSessionId,
    recordedOuterSessionId: staleness.recordedOuterSessionId,
    ...(parts.verdict.context !== null ? { context: parts.verdict.context } : {}),
    ...parts.generatedConfig.field
  };
}

/**
 * The INACTIVE envelope. Without `--check-stale` it stays exactly
 * `{ active: false }` — an optimistic default is not allowed. With it, the
 * caller asked "why is nothing active?", so the diagnostic is attached.
 */
function presenceInactiveData(
  generatedConfig: GeneratedConfig,
  diagnostic: PresenceInactiveDiagnostic
): Record<string, unknown> {
  return {
    active: false,
    stale: true,
    staleReason: 'no-presence',
    presenceInactive: {
      reason: diagnostic.reason,
      leaseCount: diagnostic.leaseCount,
      terminalCount: diagnostic.terminalCount,
      staleCount: diagnostic.staleCount,
      eligibleCount: diagnostic.eligibleCount
    },
    ...generatedConfig.field
  };
}

function runSkillPresence(options: PresenceOptions, io: ProgramIO): void {
  const projectOption = canonicalizeProjectOption(options.project);
  const generatedConfig = generatedConfigNotice(
    projectOption ?? findProjectRoot(process.cwd()) ?? process.cwd()
  );
  const presence = getSkillPresence(projectOption);
  if (presence === null) {
    // Without `--check-stale` the envelope stays exactly `{ active: false }`.
    const data =
      options.checkStale === true
        ? presenceInactiveData(generatedConfig, diagnosePresence(resolveProjectRoot(projectOption)))
        : { active: false, ...generatedConfig.field };
    printResult(io, ok('skill.presence', data, generatedConfig.warnings), options.json);
    return;
  }
  // Loop-hygiene verdict: attached to every ACTIVE read, so the
  // zero-pause contract travels with the one call every skill makes.
  const verdict = contextVerdict(projectOption ?? process.cwd());
  const parts = { verdict, generatedConfig };
  // `--check-stale` gives both pieces of info in one invocation; the
  // presence itself is returned UNCHANGED — it is a read-only flag.
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

export function registerSkillPresenceCommands(skill: Command, io: ProgramIO): void {
  addJsonOption(
    skill
      .command('presence')
      .description(PRESENCE_DESCRIPTION)
      .option('--check-stale', PRESENCE_CHECK_STALE_HELP)
      .option('--project <path>', PRESENCE_PROJECT_HELP)
  ).action((options: PresenceOptions) => runSkillPresence(options, io));

  registerSkillPresenceSetCommand(skill, io);
}
