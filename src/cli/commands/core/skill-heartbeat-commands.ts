// Split out of `core/skill-command.ts`:
// `skill heartbeat`, `skill heartbeat:touch` and `skill detect-marker-loss`.
// Each `.action()` body is a module-level named runner.
import type { Command } from 'commander';
import {
  getSkillPresence,
  touchSkillHeartbeat
} from '../../../services/skills/skill-presence-service.js';
import { detectPresenceMarker } from '../../../services/hooks/presence-marker-detector.js';
import { findProjectRoot } from '../../../services/config/config-safety.js';
import { ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../../cli-helpers.js';

const HEARTBEAT_DESCRIPTION = 'Show the heartbeat status of the active Peaks skill';
const HEARTBEAT_TOUCH_DESCRIPTION =
  'Update the heartbeat timestamp (called by the LLM each turn to confirm peaks skill context is alive)';
const DETECT_MARKER_LOSS_DESCRIPTION =
  'Detect whether the latest assistant message lost the Peaks-Loop status header while a peaks skill is still active (slice 028 detection primitive).';
const DETECT_MARKER_LOSS_MESSAGE_HELP =
  'latest assistant message text to scan (defaults to reading the most recent LLM response from the stdin pipe, or empty string when no pipe is attached)';

type JsonOnlyOptions = { json?: boolean };
type DetectMarkerLossOptions = { project?: string; message?: string; json?: boolean };

function runSkillHeartbeat(options: JsonOnlyOptions, io: ProgramIO): void {
  const presence = getSkillPresence();
  if (presence === null) {
    printResult(io, ok('skill.heartbeat', { active: false, heartbeat: 'none' }), options.json);
    return;
  }
  printResult(
    io,
    ok('skill.heartbeat', {
      active: true,
      skill: presence.skill,
      gate: presence.gate ?? null,
      lastHeartbeat: presence.lastHeartbeat ?? presence.setAt,
      setAt: presence.setAt
    }),
    options.json
  );
}

function runSkillHeartbeatTouch(options: JsonOnlyOptions, io: ProgramIO): void {
  const updated = touchSkillHeartbeat();
  if (updated === null) {
    printResult(
      io,
      ok('skill.heartbeat:touch', { active: false, heartbeat: 'none' }),
      options.json
    );
    return;
  }
  printResult(
    io,
    ok('skill.heartbeat:touch', {
      active: true,
      skill: updated.skill,
      lastHeartbeat: updated.lastHeartbeat
    }),
    options.json
  );
}

function runSkillDetectMarkerLoss(options: DetectMarkerLossOptions, io: ProgramIO): void {
  const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
  const message = options.message ?? '';
  const result = detectPresenceMarker({ project: projectRoot, latestAssistantMessage: message });
  printResult(io, ok('skill.detect-marker-loss', result), options.json);
}

export function registerSkillHeartbeatCommands(skill: Command, io: ProgramIO): void {
  addJsonOption(skill.command('heartbeat').description(HEARTBEAT_DESCRIPTION)).action(
    (options: JsonOnlyOptions) => runSkillHeartbeat(options, io)
  );

  addJsonOption(skill.command('heartbeat:touch').description(HEARTBEAT_TOUCH_DESCRIPTION)).action(
    (options: JsonOnlyOptions) => runSkillHeartbeatTouch(options, io)
  );

  addJsonOption(
    skill
      .command('detect-marker-loss')
      .description(DETECT_MARKER_LOSS_DESCRIPTION)
      .option('--project <path>', 'project root path (auto-detected from cwd when omitted)')
      .option('--message <text>', DETECT_MARKER_LOSS_MESSAGE_HELP)
  ).action((options: DetectMarkerLossOptions) => runSkillDetectMarkerLoss(options, io));
}
