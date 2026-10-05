/**
 *
 * Owns: `plan` (build+print CodePlan), `should-pause` (D5 mode-gate).
 *
 * Slice c1-eslint-family-sweep / leaf c4w1-cli-b: the two sub-command
 * registrations moved VERBATIM to `code-mode-gate-plan-command.ts` and
 * `code-mode-gate-should-pause-command.ts` so this registration file clears
 * the 300-line cap and the `max-lines-per-function` / `complexity` findings
 * that sat on the giant commander action arrow fall with them. The
 * `readActiveSidForModeGate` helper — which is a near-twin of
 * `readActiveSidForJobShape` in `code-job-shape-commands.ts` (a DIFFERENT
 * leaf this wave) — was kept in this exact file so the leaves do not
 * collide; the should-pause sibling receives it as a callback parameter
 * instead of importing it. Public surface unchanged: `registerCodeModeGateCommands`
 * is still importable from `./code-mode-gate-commands.js` and the module
 * continues to write the same observability events, print the same envelopes,
 * and preserve the same `process.exitCode = 1` set of exits.
 */

import type { Command } from 'commander';

import type { ProgramIO } from '../cli-helpers.js';
import { getSkillPresence } from '../../services/skills/skill-presence-service.js';

import { registerCodeModePlan } from './code-mode-gate-plan-command.js';
import { registerCodeModeShouldPause } from './code-mode-gate-should-pause-command.js';

export function registerCodeModeGateCommands(code: Command, io: ProgramIO): void {
  registerCodeModePlan(code);
  registerCodeModeShouldPause(code, io, readActiveSidForModeGate);
}

// The mode-gate stale-presence check needs the active sid for the
// observability event; `getSkillPresence` is imported at the top of the file
// alongside `checkStalePresence` to keep imports deduplicated.
function readActiveSidForModeGate(projectRoot: string): string | null {
  try {
    const presence = getSkillPresence(projectRoot);
    if (presence === null || presence === undefined) return null;
    return presence.sessionId ?? null;
  } catch {
    return null;
  }
}
