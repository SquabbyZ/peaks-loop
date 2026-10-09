/**
 * Shared lease-store reader for the two sweep-style commands (`list`, `gc`).
 *
 * Both enumerate the session's lease directory through the pure
 * `listLeasesSync` helper with the same real-fs bindings, and both render
 * the same `Malformed lease: <file> (<error>)` warning line per unreadable
 * file. Extracted verbatim from `worktree-lease-commands.ts`.
 */

import { existsSync, readdirSync, readFileSync as readFileSyncNode } from 'node:fs';

import {
  leaseStoreDir,
  listLeasesSync,
  type LeaseListResult
} from '../../services/worktree/worktree-lease.js';
import { joinPathSession } from './worktree-lease-session.js';

export interface LeaseStoreSnapshot {
  storeDir: string;
  result: LeaseListResult;
}

export function loadLeaseStore(projectRoot: string, sessionId: string): LeaseStoreSnapshot {
  const storeDir = leaseStoreDir(joinPathSession(projectRoot, sessionId));
  const result = listLeasesSync(storeDir, {
    readdir: (p) => readdirSync(p),
    readFile: (p) => readFileSyncNode(p, 'utf8'),
    existsSync: (p) => existsSync(p)
  });
  return { storeDir, result };
}

/** One warning line per malformed lease file skipped by the store reader. */
export function malformedLeaseWarnings(
  errors: ReadonlyArray<{ file: string; error: string }>
): string[] {
  return errors.map((e) => `Malformed lease: ${e.file} (${e.error})`);
}
