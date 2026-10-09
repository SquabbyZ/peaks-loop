/**
 * v2.15.0 follow-up — G15: release / hotfix CLI.
 *
 *   - `peaks release plan <version>`            — start a new release
 *   - `peaks release canary --percent <10|50>`   — advance to canary stage
 *   - `peaks release promote`                   — promote to 100% + start watch
 *   - `peaks release watch`                     — show watch window status
 *   - `peaks release rollback`                  — emergency rollback
 *   - `peaks release hotfix <version>`          — start a hotfix (forces
 *                                                  rollback of any active
 *                                                  release; skips 'planned'
 *                                                  stage)
 *
 * State machine: planned → canary-10 → canary-50 → promoted → watching → done
 * Side branches: → rolled-back (from any pre-done stage). A hotfix is an ENTRY
 * POINT into that pipeline, not a stage: `hotfix <version>` rolls the active
 * release back and starts the hotfix version at canary-10 (see `hotfixRelease`).
 *
 * Real deployment (k8s rollout, LB config, monitoring integration) is
 * OUT OF SCOPE for this slice.
 *
 * The verb implementations live beside this file, one module per verb:
 * `release-plan-command.ts`, `release-canary-command.ts`,
 * `release-promote-command.ts`, `release-watch-command.ts`,
 * `release-done-command.ts`, `release-rollback-command.ts`,
 * `release-hotfix-command.ts`, `release-precheck-command.ts`, with their shared
 * project-root / canary-percent vocabulary in `release-command-shared.ts`.
 */

import type { Command } from 'commander';
import type { ProgramIO } from '../cli-helpers.js';
import { registerReleaseCanaryCommand } from './release-canary-command.js';
import { registerReleasePrecheckCommand } from './release-precheck-command.js';
import { registerReleaseDoneCommand } from './release-done-command.js';
import { registerReleaseHotfixCommand } from './release-hotfix-command.js';
import { registerReleasePlanCommand } from './release-plan-command.js';
import { registerReleasePromoteCommand } from './release-promote-command.js';
import { registerReleaseRollbackCommand } from './release-rollback-command.js';
import { registerReleaseWatchCommand } from './release-watch-command.js';

export function registerReleaseCommands(program: Command, io: ProgramIO): void {
  const release = program
    .command('release')
    .description('v2.15.0 follow-up G15: canary → promote → watch → done / hotfix state machine.');

  registerReleasePlanCommand(release, io);
  registerReleaseCanaryCommand(release, io);
  registerReleasePromoteCommand(release, io);
  registerReleaseWatchCommand(release, io);
  registerReleaseDoneCommand(release, io);
  registerReleaseRollbackCommand(release, io);
  registerReleaseHotfixCommand(release, io);
  registerReleasePrecheckCommand(release, io);
}

// Re-export for tests / external consumers.
export { executeCanaryAction } from './release-canary-command.js';
export { isReleaseStage } from '../../services/release/release-state.js';
