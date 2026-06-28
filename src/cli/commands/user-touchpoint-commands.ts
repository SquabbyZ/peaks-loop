/**
 * v2.15.0 follow-up — G4: user touchpoint CLI.
 *
 *   - `peaks solo gate-classify --step <step-id>` — classify a single
 *     Solo gate (business / tech / mode-selection / commit-boundary /
 *     commit-floor)
 *   - `peaks solo user-touchpoints`                — list all gates the
 *     user must review (vs AI auto-decides in full-auto)
 *   - `peaks solo commit-boundary-actions`         — list the 5
 *     hard-floor commit actions (push / tag / publish / global
 *     install)
 *
 * Surfaces the 12 Gaps positioning memory rule:
 *   "user 在循环里 = 业务/产品审阅者,不参与技术决策"
 */

import type { Command } from 'commander';
import {
  aiAutoDecidesGates,
  classifyGate,
  COMMIT_BOUNDARY_ACTIONS_LIST,
  userMustReviewGates
} from '../../services/solo/user-touchpoint-classifier.js';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';

export function registerUserTouchpointCommands(program: Command, io: ProgramIO): void {
  // Sub-tree under the existing `solo` command.
  // We do NOT register a new top-level `peaks solo` registration here —
  // `peaks-solo/SKILL.md` references are read-only and not yet wired to
  // a CLI. This file ships the data + a small sub-command surface.
  let solo: Command | undefined = program.commands.find((c) => c.name() === 'solo');

  // If `peaks solo` doesn't exist yet, register a placeholder.
  if (solo === undefined) {
    solo = program
      .command('solo')
      .description('v2.15.0 follow-up G4: Solo user-touchpoint commands (gates that need user attention).');
  }

  addJsonOption(
    solo
      .command('gate-classify')
      .description(
        'Classify a single Solo gate by its decision kind: business / tech / ' +
          'mode-selection / commit-boundary / commit-floor. Returns null when the step is unknown.'
      )
      .requiredOption('--step <step-id>', 'step id (e.g. step-1-mode-select, phase-2-prd-confirm)')
  ).action((opts: { step: string; json?: boolean }) => {
    const c = classifyGate(opts.step);
    if (c === null) {
      printResult(io, fail('solo.gate-classify', 'UNKNOWN_STEP', `unknown step "${opts.step}"`, {}, [
        'Run `peaks solo user-touchpoints` to list all known steps.'
      ]), opts.json ?? false);
      process.exitCode = 1;
      return;
    }
    printResult(io, ok('solo.gate-classify', { classification: c }, [], [
      c.userShouldReview === 'always'
        ? 'User must review this gate in all modes.'
        : c.userShouldReview === 'business-only'
          ? 'User reviews this gate only when it surfaces a business decision.'
          : 'AI auto-decides this gate in full-auto. User does not need to review.'
    ]), opts.json ?? false);
  });

  addJsonOption(
    solo
      .command('user-touchpoints')
      .description(
        'List all Solo gates the user must review. The 12 Gaps positioning ' +
          'memory: user 在循环里 = 业务/产品审阅者,不参与技术决策。 ' +
          'These are the only gates where the user is asked to decide.'
      )
  ).action((opts: { json?: boolean }) => {
    const must = userMustReviewGates();
    const auto = aiAutoDecidesGates();
    printResult(io, ok('solo.user-touchpoints', {
      userMustReview: must,
      aiAutoDecides: auto,
      counts: {
        userMustReview: must.length,
        aiAutoDecides: auto.length
      }
    }, [], [
      `User reviews ${must.length} gate(s); AI auto-decides ${auto.length} in full-auto.`,
      'Goal: 减少 user 被打扰次数 from 14 → 6-8 (the must-review count).'
    ]), opts.json ?? false);
  });

  addJsonOption(
    solo
      .command('commit-boundary-actions')
      .description(
        'List the 5 commit-boundary hard-floor actions. These are the ' +
          'actions that PAUSE even in full-auto (v2.15.0 slice 002 AC-4 rule: ' +
          '"full-auto 只做到 commit"). The user is always asked to confirm.'
      )
  ).action((opts: { json?: boolean }) => {
    printResult(io, ok('solo.commit-boundary-actions', { actions: COMMIT_BOUNDARY_ACTIONS_LIST }, [], [
      'Even in full-auto, the user must explicitly confirm these actions.'
    ]), opts.json ?? false);
  });
}
