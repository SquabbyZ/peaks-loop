import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GuardContext, GuardRunResult } from '../types.js';

const CANDIDATE_FILES: ReadonlyArray<string> = [
  'src/services/worktree/lease-store.ts',
  'src/services/worktree/worktree-lease.ts',
  'src/services/dispatch/sub-agent-dispatcher.ts',
  'src/services/lease-metrics/lease-metrics-service.ts'
];

const REQUIRED_FRAGMENTS: ReadonlyArray<string> = ['lease', 'release'];

export async function runJ12Contract(ctx: GuardContext): Promise<GuardRunResult> {
  const existing = CANDIDATE_FILES.filter((f) => existsSync(join(ctx.projectRoot, f)));
  if (existing.length === 0) {
    return {
      journeyId: 'J12',
      contract: 'concurrency-lease',
      status: 'fail',
      diff: { before: 'a worktree/lease/dispatch service exists', after: 'no candidate found', reason: 'J12#1 broken: no lease infrastructure is present' },
      artifactPath: 'src/services/worktree/'
    };
  }
  // Soft: at least one file references BOTH 'lease' AND 'release' in its content.
  const fullCoverage = existing.some((f) => {
    const src = readFileSync(join(ctx.projectRoot, f), 'utf8').toLowerCase();
    return REQUIRED_FRAGMENTS.every((frag) => src.includes(frag));
  });
  const ok = fullCoverage;
  return {
    journeyId: 'J12',
    contract: 'concurrency-lease',
    status: ok ? 'pass' : 'fail',
    ...(ok ? {} : { diff: { before: 'a worktree/lease service references both lease and release', after: 'no such file', reason: 'J12#1 broken: lease lifecycle (lease + release) is incomplete' } }),
    artifactPath: existing[0]!
  };
}
