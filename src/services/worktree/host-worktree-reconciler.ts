import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { leaseStoreDir, listLeasesSync } from './worktree-lease.js';
import { isPathInside, parseGitWorktreePorcelain, type GitWorktreeRecord } from './git-worktree-parser.js';

export type HostWorktreeFinding = GitWorktreeRecord & {
  readonly managedLeaseId: string | null;
  readonly state: 'managed' | 'unleased' | 'prunable';
};

export type HostWorktreeReconcileResult = {
  readonly hostRoot: string;
  readonly findings: ReadonlyArray<HostWorktreeFinding>;
  readonly unmanaged: ReadonlyArray<HostWorktreeFinding>;
};

export function reconcileHostWorktrees(input: {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly hostRoot?: string;
}): HostWorktreeReconcileResult {
  const hostRoot = resolve(input.hostRoot ?? join(input.projectRoot, '.claude', 'worktrees'));
  let records: ReadonlyArray<GitWorktreeRecord> = [];
  try {
    const raw = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: input.projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    records = parseGitWorktreePorcelain(raw);
  } catch {
    records = [];
  }

  const storeDir = leaseStoreDir(join(input.projectRoot, '.peaks', '_runtime', input.sessionId));
  const leaseResult = listLeasesSync(storeDir, {
    existsSync,
    readdir: (path) => readdirSync(path),
    readFile: (path) => readFileSync(path, 'utf8'),
  });
  const leases = leaseResult.kind === 'ok' ? leaseResult.leases : [];
  const leaseByPath = new Map(leases.map((lease) => [resolve(lease.path), lease.leaseId]));
  const findings = records
    .filter((record) => isPathInside(hostRoot, record.path) && basename(record.path).startsWith('agent-'))
    .map((record): HostWorktreeFinding => {
      const managedLeaseId = leaseByPath.get(resolve(record.path)) ?? null;
      return {
        ...record,
        managedLeaseId,
        state: record.prunable ? 'prunable' : managedLeaseId === null ? 'unleased' : 'managed',
      };
    });
  return { hostRoot, findings, unmanaged: findings.filter((finding) => finding.state !== 'managed') };
}
