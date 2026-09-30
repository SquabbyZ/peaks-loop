/**
 * v2.15.0 follow-up — G11: fork sync CLI, `peaks fork sync-verify`.
 *
 * Extracted from fork-commands.ts (C wave 4 near-cap split). Owns: the
 * `sync-verify` command — mark a planned sync verified/failed and, on success,
 * move the fork baseline to the synced tag. Command name, options, emitted
 * message text, on-disk writes and the print/return order are unchanged from
 * the predecessor's inline action.
 */

import type { Command } from 'commander';
import { findProjectRoot } from '../../services/config/config-safety.js';
import {
  readForkState,
  updateSyncRecordStatus,
  writeForkState,
  type ForkBaseline,
  type ForkState,
  type ForkSyncRecord
} from '../../services/fork/fork-sync-state.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';

type ForkSyncVerifyOptions = {
  syncId: string;
  status: string;
  notes?: string;
  project?: string;
  json?: boolean;
};

export function registerForkSyncVerifyCommand(fork: Command, io: ProgramIO): void {
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
  ).action((opts: ForkSyncVerifyOptions) => {
    runForkSyncVerify(io, opts);
  });
}

function runForkSyncVerify(io: ProgramIO, opts: ForkSyncVerifyOptions): void {
  if (opts.status !== 'verified' && opts.status !== 'failed') {
    printSyncVerifyInvalidStatus(io, opts);
    return;
  }
  const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
  const state = readForkState(projectRoot);
  const target = state.history.find((r) => r.syncId === opts.syncId);
  if (!target) {
    printSyncVerifyNotFound(io, opts, projectRoot);
    return;
  }
  let next = updateSyncRecordStatus(state, opts.syncId, opts.status, opts.notes);
  if (opts.status === 'verified') {
    next = { ...next, baseline: syncedBaseline(state, target) };
  }
  writeForkState(projectRoot, next);
  printSyncVerifyResult(io, opts, projectRoot, next.baseline);
}

function printSyncVerifyInvalidStatus(io: ProgramIO, opts: ForkSyncVerifyOptions): void {
  printResult(
    io,
    fail(
      'fork.sync-verify',
      'INVALID_STATUS',
      `status must be "verified" or "failed" (got "${opts.status}")`,
      { projectRoot: opts.project ?? '' },
      ['Pass --status verified on success, --status failed on failure.']
    ),
    opts.json ?? false
  );
}

function printSyncVerifyNotFound(
  io: ProgramIO,
  opts: ForkSyncVerifyOptions,
  projectRoot: string
): void {
  printResult(
    io,
    fail(
      'fork.sync-verify',
      'NOT_FOUND',
      `sync id "${opts.syncId}" not found`,
      { projectRoot },
      []
    ),
    opts.json ?? false
  );
}

function printSyncVerifyResult(
  io: ProgramIO,
  opts: ForkSyncVerifyOptions,
  projectRoot: string,
  newBaseline: ForkBaseline | null
): void {
  printResult(
    io,
    ok(
      'fork.sync-verify',
      {
        projectRoot,
        syncId: opts.syncId,
        status: opts.status,
        notes: opts.notes ?? null,
        newBaseline
      },
      [],
      [
        opts.status === 'verified'
          ? 'Baseline updated to the synced tag.'
          : 'Sync marked as failed. Re-run `peaks fork sync-plan` to retry.'
      ]
    ),
    opts.json ?? false
  );
}

function syncedBaseline(state: ForkState, target: ForkSyncRecord): ForkBaseline {
  return {
    upstream: state.baseline?.upstream ?? 'unknown',
    basedOn: target.targetTag,
    recordedAt: new Date().toISOString(),
    commitsAhead: 0,
    filesChanged: 0
  };
}
