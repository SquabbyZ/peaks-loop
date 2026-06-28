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
 * Side branches: → rolled-back (from any pre-done stage), → hotfixed (from watching).
 *
 * Real deployment (k8s rollout, LB config, monitoring integration) is
 * OUT OF SCOPE for this slice.
 */

import type { Command } from 'commander';
import { findProjectRoot } from '../../services/config/config-safety.js';
import {
  hotfixRelease,
  isReleaseStage,
  planRelease,
  readReleaseState,
  rollbackRelease,
  transitionRelease,
  watchWindow,
  writeReleaseState,
  type ReleaseStage
} from '../../services/release/release-state.js';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';

const CANARY_PERCENTS: Readonly<Record<10 | 50, ReleaseStage>> = {
  10: 'canary-10',
  50: 'canary-50'
};

export function registerReleaseCommands(program: Command, io: ProgramIO): void {
  const release = program
    .command('release')
    .description('v2.15.0 follow-up G15: canary → promote → watch → done / hotfix state machine.');

  // 1. plan
  addJsonOption(
    release
      .command('plan <version>')
      .description(
        'Start a new release. Stores the version in the canary pipeline state. ' +
          'Fails when there is already an active release in any non-terminal stage.'
      )
      .option('--project <path>', 'project root (default: cwd)')
  ).action((version: string, opts: { project?: string; json?: boolean }) => {
    const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const state = readReleaseState(projectRoot);
    const result = planRelease(state, version);
    if ('error' in result) {
      printResult(io, fail('release.plan', 'CONFLICT', result.error, { projectRoot }, [
        'Run `peaks release rollback` or `peaks release hotfix` to clear the active release.'
      ]), opts.json ?? false);
      return;
    }
    writeReleaseState(projectRoot, result.state);
    printResult(io, ok('release.plan', {
      projectRoot,
      version: result.record.version,
      currentStage: result.record.currentStage
    }, [], [
      'Run `peaks release canary --percent 10` to begin the canary phase.'
    ]), opts.json ?? false);
  });

  // 2. canary
  addJsonOption(
    release
      .command('canary')
      .description(
        'Advance the active release to a canary stage. Two percent values supported: ' +
          '10 (first canary, requires stage=planned) and 50 (second canary, requires ' +
          'stage=canary-10). Use `peaks release promote` to complete.'
      )
      .requiredOption('--percent <10|50>', 'canary percent (10 or 50)')
      .option('--note <text>', 'optional note for the stage transition')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((opts: { percent: string; note?: string; project?: string; json?: boolean }) => {
    const percent = Number.parseInt(opts.percent, 10);
    if (percent !== 10 && percent !== 50) {
      printResult(io, fail('release.canary', 'INVALID_PERCENT', `--percent must be 10 or 50 (got "${opts.percent}")`, {}, []), opts.json ?? false);
      return;
    }
    const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const state = readReleaseState(projectRoot);
    const targetStage = CANARY_PERCENTS[percent as 10 | 50];
    const result = transitionRelease(state, targetStage, opts.note);
    if ('error' in result) {
      printResult(io, fail('release.canary', 'INVALID_TRANSITION', result.error, { projectRoot }, []), opts.json ?? false);
      return;
    }
    writeReleaseState(projectRoot, result.state);
    printResult(io, ok('release.canary', {
      projectRoot,
      percent,
      currentStage: targetStage,
      nextAction: percent === 10
        ? 'peaks release canary --percent 50'
        : 'peaks release promote'
    }, [], []), opts.json ?? false);
  });

  // 3. promote
  addJsonOption(
    release
      .command('promote')
      .description(
        'Promote the canary to 100% (full release). Requires stage=canary-50. ' +
          'Records the promoted-at timestamp and starts the 24h watch window.'
      )
      .option('--note <text>', 'optional note')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((opts: { note?: string; project?: string; json?: boolean }) => {
    const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const state = readReleaseState(projectRoot);
    const result = transitionRelease(state, 'promoted', opts.note);
    if ('error' in result) {
      printResult(io, fail('release.promote', 'INVALID_TRANSITION', result.error, { projectRoot }, []), opts.json ?? false);
      return;
    }
    writeReleaseState(projectRoot, result.state);
    printResult(io, ok('release.promote', {
      projectRoot,
      currentStage: 'promoted',
      promotedAt: result.state.active?.promotedAt
    }, [], [
      'Watch window started. Run `peaks release watch` to check progress; `peaks release rollback` for emergency.'
    ]), opts.json ?? false);
  });

  // 4. watch
  addJsonOption(
    release
      .command('watch')
      .description(
        'Show the watch window status for the current promoted release. ' +
          '24h window from promoted-at. After the window, run `peaks release done` ' +
          'to mark the release complete.'
      )
      .option('--project <path>', 'project root (default: cwd)')
  ).action((opts: { project?: string; json?: boolean }) => {
    const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const state = readReleaseState(projectRoot);
    if (state.active === null) {
      printResult(io, fail('release.watch', 'NO_ACTIVE', 'no active release to watch', { projectRoot }, [
        'Run `peaks release plan <version>` to start one.'
      ]), opts.json ?? false);
      return;
    }
    const win = watchWindow(state.active);
    const readyForDone = win.percentComplete >= 1.0;
    printResult(io, ok('release.watch', {
      projectRoot,
      version: state.active.version,
      currentStage: state.active.currentStage,
      window: {
        elapsedMs: win.elapsedMs,
        remainingMs: win.remainingMs,
        windowMs: win.windowMs,
        percentComplete: Math.round(win.percentComplete * 100) / 100
      },
      readyForDone
    }, readyForDone
      ? ['Watch window complete. Run `peaks release done` to mark the release done.']
      : []), opts.json ?? false);
  });

  // 5. done (implicit helper; not in original spec but useful)
  addJsonOption(
    release
      .command('done')
      .description(
        'Mark the active release as done. Requires the watch window to be ' +
          'complete (24h after promoted-at).'
      )
      .option('--project <path>', 'project root (default: cwd)')
  ).action((opts: { project?: string; json?: boolean }) => {
    const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const state = readReleaseState(projectRoot);
    if (state.active === null) {
      printResult(io, fail('release.done', 'NO_ACTIVE', 'no active release', { projectRoot }, []), opts.json ?? false);
      return;
    }
    if (state.active.currentStage !== 'watching') {
      printResult(io, fail('release.done', 'INVALID_STAGE', `must be in 'watching' stage to mark done (current: ${state.active.currentStage})`, { projectRoot }, [
        'Run `peaks release watch` to check progress; transition requires the watch window to complete.'
      ]), opts.json ?? false);
      return;
    }
    const win = watchWindow(state.active);
    if (win.percentComplete < 1.0) {
      printResult(io, fail('release.done', 'WATCH_INCOMPLETE', `watch window not yet complete (${Math.round(win.percentComplete * 100)}% elapsed)`, { projectRoot }, []), opts.json ?? false);
      return;
    }
    const result = transitionRelease(state, 'done');
    if ('error' in result) {
      printResult(io, fail('release.done', 'INVALID_TRANSITION', result.error, { projectRoot }, []), opts.json ?? false);
      return;
    }
    // Move to history.
    const finalRecord = result.state.active!;
    const newState: import('../../services/release/release-state.js').ReleaseState = { version: 1, active: null, history: [...result.state.history, finalRecord] };
    writeReleaseState(projectRoot, newState);
    printResult(io, ok('release.done', {
      projectRoot,
      version: finalRecord.version,
      doneAt: finalRecord.doneAt
    }, [], []), opts.json ?? false);
  });

  // 6. rollback
  addJsonOption(
    release
      .command('rollback')
      .description(
        'Emergency rollback of the active release. Moves the active release to ' +
          'the history with currentStage=rolled-back. Available from any ' +
          'pre-done stage.'
      )
      .option('--note <text>', 'optional rollback reason')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((opts: { note?: string; project?: string; json?: boolean }) => {
    const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const state = readReleaseState(projectRoot);
    const result = rollbackRelease(state, opts.note);
    if ('error' in result) {
      printResult(io, fail('release.rollback', 'INVALID_TRANSITION', result.error, { projectRoot }, []), opts.json ?? false);
      return;
    }
    writeReleaseState(projectRoot, result.state);
    printResult(io, ok('release.rollback', {
      projectRoot,
      rolledBack: result.record.version,
      finalStage: result.record.currentStage
    }, [], [
      'Run `peaks release hotfix <version>` to start a hotfix on the previous release.'
    ]), opts.json ?? false);
  });

  // 7. hotfix
  addJsonOption(
    release
      .command('hotfix <version>')
      .description(
        'Start a hotfix release. Forces a rollback of any active release, ' +
          'skips the `planned` stage, and starts the new release at canary-10. ' +
          'Use this for紧急修复 — minimal ceremony, no full prd ceremony.'
      )
      .option('--note <text>', 'optional hotfix note')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((version: string, opts: { note?: string; project?: string; json?: boolean }) => {
    const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const state = readReleaseState(projectRoot);
    const result = hotfixRelease(state, version, opts.note);
    if ('error' in result) {
      printResult(io, fail('release.hotfix', 'HOTFIX_FAILED', result.error, { projectRoot }, []), opts.json ?? false);
      return;
    }
    writeReleaseState(projectRoot, result.state);
    printResult(io, ok('release.hotfix', {
      projectRoot,
      version: result.record.version,
      currentStage: result.record.currentStage
    }, [], [
      'Hotfix started at canary-10. Run `peaks release canary --percent 50` to advance.'
    ]), opts.json ?? false);
  });
}

// Re-export for tests / external consumers.
export { isReleaseStage };
