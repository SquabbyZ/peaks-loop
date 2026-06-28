/**
 * v2.15.0 follow-up — G11: fork sync CLI.
 *
 *   - `peaks fork status`               — show baseline + drift + last sync
 *   - `peaks fork upstream-check`       — recommend next stable tag
 *   - `peaks fork sync-plan`            — generate a sync plan
 *   - `peaks fork sync`                 — record a sync execution
 *   - `peaks fork sync-verify`          — mark a sync as verified / failed
 *
 * All 5 commands are pure local reads/writes against
 * `.peaks/fork-state.json`. The actual git fetch + merge is out of
 * scope for this slice (deferred to 2.15.x).
 */

import type { Command } from 'commander';
import { findProjectRoot } from '../../services/config/config-safety.js';
import {
  appendSyncRecord,
  buildForkStatusReport,
  makeSyncId,
  readForkState,
  recommendStableTags,
  updateSyncRecordStatus,
  writeForkState,
  type ForkBaseline,
  type ForkSyncRecord
} from '../../services/fork/fork-sync-state.js';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';

export function registerForkCommands(program: Command, io: ProgramIO): void {
  const fork = program
    .command('fork')
    .description('v2.15.0 follow-up G11: manage upstream tag sync for forked projects (hermes-style).');

  // 1. status
  addJsonOption(
    fork
      .command('status')
      .description(
        'Show the current fork baseline (upstream + tag + drift) and the most recent sync. ' +
          'Pure read of `.peaks/fork-state.json`.'
      )
      .option('--project <path>', 'project root (default: cwd)')
  ).action((opts: { project?: string; json?: boolean }) => {
    const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const state = readForkState(projectRoot);
    const report = buildForkStatusReport(state);
    printResult(io, ok('fork.status', { projectRoot, report: serializeReport(report) }, [], [
      report.driftWarning
        ? 'Drift exceeds 30 commits — consider `peaks fork upstream-check` to plan a sync.'
        : 'No sync action recommended at this time.'
    ]), opts.json ?? false);
  });

  // 2. upstream-check
  addJsonOption(
    fork
      .command('upstream-check')
      .description(
        'Recommend stable upstream tags to sync to, given a list of available tags. ' +
          '`--tags` is a comma-separated list; pre-release tags (alpha/beta/rc/dev/preview) are filtered out. ' +
          'Returns the list of stable tags newer than the current baseline.'
      )
      .requiredOption('--tags <list>', 'comma-separated list of available upstream tags')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((opts: { tags: string; project?: string; json?: boolean }) => {
    const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const availableTags = opts.tags.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    const state = readForkState(projectRoot);
    const baselineTag = state.baseline?.basedOn ?? null;
    const recommended = recommendStableTags(availableTags, baselineTag);
    printResult(io, ok('fork.upstream-check', {
      projectRoot,
      currentBaseline: baselineTag,
      totalAvailableTags: availableTags.length,
      recommendedTags: recommended,
      nextRecommended: recommended[0] ?? null
    }, [], [
      recommended.length === 0
        ? 'No stable tags newer than the current baseline.'
        : `Recommended next sync target: ${recommended[0]}`
    ]), opts.json ?? false);
  });

  // 3. sync-plan
  addJsonOption(
    fork
      .command('sync-plan')
      .description(
        'Generate a sync plan for the given upstream tag. Records the plan in `.peaks/fork-state.json`. ' +
          'Returns the plan id used to invoke `peaks fork sync`. Pure local write; no git operations.'
      )
      .requiredOption('--upstream <tag>', 'target upstream tag (e.g. v1.20.0)')
      .option('--conflicts <list>', 'comma-separated predicted conflict file globs')
      .option('--patches <list>', 'comma-separated business patch identifiers to replay')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((opts: { upstream: string; conflicts?: string; patches?: string; project?: string; json?: boolean }) => {
    const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const state = readForkState(projectRoot);
    const syncId = makeSyncId(opts.upstream);
    const conflicts = opts.conflicts ? opts.conflicts.split(',').map((s) => s.trim()).filter((s) => s.length > 0) : [];
    const patches = opts.patches ? opts.patches.split(',').map((s) => s.trim()).filter((s) => s.length > 0) : [];
    const record: ForkSyncRecord = {
      syncId,
      targetTag: opts.upstream,
      plannedAt: new Date().toISOString(),
      predictedConflicts: conflicts,
      businessPatches: patches,
      status: 'planned'
    };
    const next = appendSyncRecord(state, record);
    writeForkState(projectRoot, next);
    printResult(io, ok('fork.sync-plan', { projectRoot, syncId, record }, [], [
      `Run \`peaks fork sync --sync-id ${syncId}\` to mark execution start.`,
      `Run \`peaks fork sync-verify --sync-id ${syncId} --status verified\` after the sync completes.`
    ]), opts.json ?? false);
  });

  // 4. sync (mark execution)
  addJsonOption(
    fork
      .command('sync')
      .description(
        'Mark a planned sync as in-progress. Records the execution start. ' +
          'This slice does NOT perform the actual git fetch + merge — the LLM / operator runs those, ' +
          'then calls `sync-verify` to record the result.'
      )
      .requiredOption('--sync-id <id>', 'sync plan id from `peaks fork sync-plan`')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((opts: { syncId: string; project?: string; json?: boolean }) => {
    const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const state = readForkState(projectRoot);
    const target = state.history.find((r) => r.syncId === opts.syncId);
    if (!target) {
      printResult(io, fail('fork.sync', 'NOT_FOUND', `sync id "${opts.syncId}" not found in fork-state.json`, { projectRoot }, [
        'Run `peaks fork sync-plan` first to generate a plan.'
      ]), opts.json ?? false);
      return;
    }
    const next = updateSyncRecordStatus(state, opts.syncId, 'in-progress');
    writeForkState(projectRoot, next);
    printResult(io, ok('fork.sync', { projectRoot, syncId: opts.syncId, status: 'in-progress', targetTag: target.targetTag }, [], [
      'Now run the actual git fetch + merge, then call `peaks fork sync-verify` to record the result.'
    ]), opts.json ?? false);
  });

  // 5. sync-verify
  addJsonOption(
    fork
      .command('sync-verify')
      .description(
        'Mark a sync as verified (success) or failed. Optionally records verification notes. ' +
          'On success, the current baseline is also updated to the synced tag.'
      )
      .requiredOption('--sync-id <id>', 'sync plan id')
      .requiredOption('--status <verified|failed>', 'sync verification outcome')
      .option('--notes <text>', 'optional verification notes')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((opts: { syncId: string; status: string; notes?: string; project?: string; json?: boolean }) => {
    if (opts.status !== 'verified' && opts.status !== 'failed') {
      printResult(io, fail('fork.sync-verify', 'INVALID_STATUS', `status must be "verified" or "failed" (got "${opts.status}")`, { projectRoot: opts.project ?? '' }, [
        'Pass --status verified on success, --status failed on failure.'
      ]), opts.json ?? false);
      return;
    }
    const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const state = readForkState(projectRoot);
    const target = state.history.find((r) => r.syncId === opts.syncId);
    if (!target) {
      printResult(io, fail('fork.sync-verify', 'NOT_FOUND', `sync id "${opts.syncId}" not found`, { projectRoot }, []), opts.json ?? false);
      return;
    }
    let next = updateSyncRecordStatus(state, opts.syncId, opts.status, opts.notes);
    if (opts.status === 'verified') {
      const baseline: ForkBaseline = {
        upstream: state.baseline?.upstream ?? 'unknown',
        basedOn: target.targetTag,
        recordedAt: new Date().toISOString(),
        commitsAhead: 0,
        filesChanged: 0
      };
      next = { ...next, baseline };
    }
    writeForkState(projectRoot, next);
    printResult(io, ok('fork.sync-verify', {
      projectRoot,
      syncId: opts.syncId,
      status: opts.status,
      notes: opts.notes ?? null,
      newBaseline: next.baseline
    }, [], [
      opts.status === 'verified'
        ? 'Baseline updated to the synced tag.'
        : 'Sync marked as failed. Re-run `peaks fork sync-plan` to retry.'
    ]), opts.json ?? false);
  });
}

function serializeReport(r: ReturnType<typeof buildForkStatusReport>): {
  hasBaseline: boolean;
  baseline: ForkBaseline | null;
  syncCount: number;
  lastSync: ForkSyncRecord | null;
  driftWarning: boolean;
} {
  return r;
}
