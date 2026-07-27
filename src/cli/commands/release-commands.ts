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
import { runAllLayers, type LayerResult } from '../../services/release/version-precheck-service.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';

const CANARY_PERCENTS: Readonly<Record<10 | 50, ReleaseStage>> = {
  10: 'canary-10',
  50: 'canary-50'
};

// rid-010 — extracted canary action handler so AC-8 can drive the canary
// precheck-guard via direct function call (not via program.parseAsync with a
// mocked service). Returns the result envelope for the caller to print.
export function executeCanaryAction(
  opts: { percent: string; note?: string; project?: string; json?: boolean },
  io: ProgramIO,
  projectRoot: string
): {
  ok: boolean;
  payload: Readonly<Record<string, unknown>>;
  status: 'PRECHECK_BLOCKER' | 'INVALID_PERCENT' | 'INVALID_TRANSITION' | 'OK';
  blockerLayer?: { name: string; result: LayerResult };
} {
  // rid-010 — precheck guard (Layer A or Layer B blocker refuses canary).
  // Layers C/D default warning → do not block canary; --strict upgrade would
  // be a separate flag (out of scope for rid-010).
  const precheck = runAllLayers({ projectRoot, strict: false });
  const blockerEntry = (
    Object.entries(precheck.layers) as Array<[string, LayerResult]>
  ).find(([, l]) => l.status === 'blocker');
  if (blockerEntry !== undefined) {
    const [name, result] = blockerEntry;
    return {
      ok: false,
      status: 'PRECHECK_BLOCKER',
      blockerLayer: { name, result },
      payload: {
        projectRoot,
        precheckSnapshotAt: precheck.snapshotAt,
        layer: name,
        message: result.message,
        remediation: result.remediation
      }
    };
  }
  const percent = Number.parseInt(opts.percent, 10);
  if (percent !== 10 && percent !== 50) {
    return {
      ok: false,
      status: 'INVALID_PERCENT',
      payload: { projectRoot, got: opts.percent }
    };
  }
  const state = readReleaseState(projectRoot);
  const targetStage = CANARY_PERCENTS[percent as 10 | 50];
  const result = transitionRelease(state, targetStage, opts.note);
  if ('error' in result) {
    return {
      ok: false,
      status: 'INVALID_TRANSITION',
      payload: { projectRoot, error: result.error }
    };
  }
  writeReleaseState(projectRoot, result.state);
  return {
    ok: true,
    status: 'OK',
    payload: {
      projectRoot,
      percent,
      currentStage: targetStage,
      nextAction: percent === 10
        ? 'peaks release canary --percent 50'
        : 'peaks release promote'
    }
  };
}

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

  // 2. canary — rid-010 wires precheck as the first step via executeCanaryAction
  addJsonOption(
    release
      .command('canary')
      .description(
        'Advance the active release to a canary stage. Two percent values supported: ' +
          '10 (first canary, requires stage=planned) and 50 (second canary, requires ' +
          'stage=canary-10). Runs `peaks release precheck` first and refuses with ' +
          'PRECHECK_BLOCKER if any blocker layer (rootVsShared or tagCollision) fails.'
      )
      .requiredOption('--percent <10|50>', 'canary percent (10 or 50)')
      .option('--note <text>', 'optional note for the stage transition')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((opts: { percent: string; note?: string; project?: string; json?: boolean }) => {
    const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const result = executeCanaryAction(opts, io, projectRoot);
    if (result.status === 'PRECHECK_BLOCKER') {
      const layer = result.blockerLayer;
      printResult(io, fail(
        'release.canary',
        'PRECHECK_BLOCKER',
        `precheck blocker on layer '${layer?.name ?? 'unknown'}': ${layer?.result.message ?? ''}`,
        result.payload,
        [
          `Run 'peaks release precheck --project ${projectRoot}' for the full 4-layer envelope.`,
          `Run 'peaks release precheck --strict' to also surface warning-layer issues.`,
          `Remediation: ${layer?.result.remediation ?? ''}`
        ]
      ), opts.json ?? false);
      return;
    }
    if (result.status === 'INVALID_PERCENT') {
      printResult(io, fail('release.canary', 'INVALID_PERCENT', `--percent must be 10 or 50 (got "${opts.percent}")`, result.payload, []), opts.json ?? false);
      return;
    }
    if (result.status === 'INVALID_TRANSITION') {
      printResult(io, fail('release.canary', 'INVALID_TRANSITION', String(result.payload['error'] ?? ''), result.payload, []), opts.json ?? false);
      return;
    }
    printResult(io, ok('release.canary', result.payload, [], []), opts.json ?? false);
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

  // 8. precheck — rid-010 (Phase 4 slice 1) — 4-layer version precheck.
  addJsonOption(
    release
      .command('precheck')
      .description(
        'Run the 4-layer version precheck (rootVsShared / tagCollision / ' +
          'changesetStaged / workspaceLockstep). Layer A+B are blockers by default; ' +
          'Layer C+D are warnings unless --strict is passed (CI parity mode). ' +
          'Shared with publish.yml gate-cli-version step §(A).'
      )
      .option('--strict', 'treat warnings as blockers (CI parity mode)')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((opts: { strict?: boolean; project?: string; json?: boolean }) => {
    const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const envelope = runAllLayers({ projectRoot, strict: opts.strict === true });
    process.exitCode = envelope.ok ? 0 : 1;
    const warningLines = envelope.overall === 'warning'
      ? ['Warning layers reported but did not block. Re-run with --strict to upgrade.']
      : [];
    printResult(io, ok('release.precheck', envelope, [], warningLines), opts.json ?? false);
  });
}

// Re-export for tests / external consumers.
export { isReleaseStage };
