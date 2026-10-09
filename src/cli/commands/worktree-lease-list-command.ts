/**
 * `peaks worktree list` — enumerate every lease in the session store.
 *
 * Extracted verbatim from `worktree-lease-commands.ts` (mechanical move of
 * the `.action()` body). The store read is now the shared
 * `loadLeaseStore`; the live/elapsed/remaining annotation, the
 * `--status` / `--expired-only` filters, the createdAt-desc sort and the
 * ok/fail envelopes are unchanged.
 */

import type { Command } from 'commander';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import {
  isLeaseActive,
  type LeaseReadError,
  type WorktreeLease
} from '../../services/worktree/worktree-lease.js';
import { loadLeaseStore, malformedLeaseWarnings } from './worktree-lease-store.js';
import { resolveProjectRoot, resolveSessionId } from './worktree-lease-session.js';

const LIST_DESCRIPTION =
  "List every lease under the current session's lease store. " +
  'Optionally filter by --status (active|released|expired|gc) and/or --expired-only. ' +
  'Leases past their expiresAt with status=active are still listed under "active" by default ' +
  '(`isLeaseActive` returns false for them, but the on-disk status only flips to "expired" ' +
  'after `peaks worktree gc` runs).';

const LIST_STATUS_DESCRIPTION = 'filter by lease status: active | released | expired | gc';
const LIST_EXPIRED_ONLY_DESCRIPTION = 'only show leases whose expiresAt is in the past';

type ListOptions = {
  /** Filter to only leases in this lifecycle state. */
  status?: 'active' | 'released' | 'expired' | 'gc';
  /** Show only leases whose expiresAt is in the past (after applying status filter). */
  expiredOnly?: boolean;
  session?: string;
  project?: string;
  json?: boolean;
};

type AnnotatedLease = WorktreeLease & {
  live: boolean;
  elapsedMs: number;
  remainingMs: number;
};

function annotateLeases(leases: ReadonlyArray<WorktreeLease>, now: number): AnnotatedLease[] {
  return leases.map((l) => ({
    ...l,
    live: isLeaseActive(l, now),
    elapsedMs: now - l.createdAt,
    remainingMs: l.expiresAt - now
  }));
}

function filterLeases(leases: AnnotatedLease[], options: ListOptions): AnnotatedLease[] {
  let filtered = leases;
  if (options.status) {
    filtered = filtered.filter((l) => l.status === options.status);
  }
  if (options.expiredOnly === true) {
    filtered = filtered.filter((l) => !l.live);
  }
  // Sort by createdAt desc — most-recent first. Stable for diffs.
  return [...filtered].sort((a, b) => b.createdAt - a.createdAt);
}

function printListStoreMissing(
  io: ProgramIO,
  options: ListOptions,
  ctx: { sessionId: string; projectRoot: string; storeDir: string }
): void {
  const { sessionId, projectRoot, storeDir } = ctx;
  printResult(
    io,
    ok(
      'worktree.list',
      { sessionId, projectRoot, leases: [], errors: [], storeMissing: true },
      [],
      [`No lease store at ${storeDir}. Spawn a worktree first (\`peaks worktree spawn ...\`).`]
    ),
    options.json
  );
}

function printListOk(
  io: ProgramIO,
  options: ListOptions,
  ctx: {
    sessionId: string;
    projectRoot: string;
    storeDir: string;
    totalOnDisk: number;
    errors: ReadonlyArray<LeaseReadError>;
    leases: AnnotatedLease[];
  }
): void {
  const { sessionId, projectRoot, storeDir, totalOnDisk, errors, leases } = ctx;
  printResult(
    io,
    ok(
      'worktree.list',
      {
        sessionId,
        projectRoot,
        storeDir,
        totalOnDisk,
        returned: leases.length,
        errors,
        leases
      },
      malformedLeaseWarnings(errors),
      [
        `${leases.length} lease(s) matched (${totalOnDisk} on disk).`,
        errors.length > 0
          ? 'Some lease files were malformed — see errors[]; they were skipped.'
          : ''
      ].filter(Boolean)
    ),
    options.json
  );
}

function printListFailed(
  io: ProgramIO,
  options: ListOptions,
  err: unknown,
  sessionId: string
): void {
  printResult(
    io,
    fail('worktree.list', 'LIST_FAILED', getErrorMessage(err), { sessionId }, [
      'Re-run after fixing the failure (see cause in the error message).'
    ]),
    options.json
  );
  process.exitCode = 1;
}

function runList(options: ListOptions, io: ProgramIO): void {
  const projectRoot = resolveProjectRoot(options);
  const sessionId = resolveSessionId(options, projectRoot);
  try {
    const { storeDir, result } = loadLeaseStore(projectRoot, sessionId);
    if (result.kind === 'store-missing') {
      printListStoreMissing(io, options, { sessionId, projectRoot, storeDir });
      return;
    }
    const now = Date.now();
    const filtered = filterLeases(annotateLeases(result.leases, now), options);
    printListOk(io, options, {
      sessionId,
      projectRoot,
      storeDir,
      totalOnDisk: result.leases.length,
      errors: result.errors,
      leases: filtered
    });
  } catch (err) {
    printListFailed(io, options, err, sessionId);
  }
}

export function registerWorktreeLeaseListCommand(auth: Command, io: ProgramIO): void {
  addJsonOption(
    auth
      .command('list')
      .description(LIST_DESCRIPTION)
      .option('--status <state>', LIST_STATUS_DESCRIPTION)
      .option('--expired-only', LIST_EXPIRED_ONLY_DESCRIPTION)
      .option('--session <sid>', 'override session id')
      .option('--project <path>', 'project root (default: findProjectRoot(cwd))')
  ).action((options: ListOptions) => runList(options, io));
}
