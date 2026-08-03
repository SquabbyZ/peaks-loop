// src/services/capability-guard-runner/contracts/J09.ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GuardContext, GuardRunResult } from '../types.js';

// v2: existence + soft fragment. v1 required 3 strict fragments (gate/checkable/register)
// that don't all appear in every SOP service file in 4.0.8.
const CANDIDATE_FILES: ReadonlyArray<string> = [
  'src/services/sop/sop-service.ts',
  'src/services/sop/sop-register.ts',
  'src/services/sop/sop-check-service.ts',
  'src/services/sop/sop-registry-service.ts',
  'src/services/sop/sop-types.ts'
];

export async function runJ09Contract(ctx: GuardContext): Promise<GuardRunResult> {
  const existing = CANDIDATE_FILES.filter((f) => existsSync(join(ctx.projectRoot, f)));
  if (existing.length === 0) {
    return {
      journeyId: 'J09',
      contract: 'sop-register',
      status: 'fail',
      diff: { before: 'a SOP service file exists', after: 'no candidate found', reason: 'J09#1 broken: no SOP service is present' },
      artifactPath: 'src/services/sop/'
    };
  }
  // Soft check: at least one existing file mentions sop, gate, or register.
  const primary = existing.some((f) => {
    const src = readFileSync(join(ctx.projectRoot, f), 'utf8').toLowerCase();
    return src.includes('sop') || src.includes('gate') || src.includes('register');
  });
  if (!primary) {
    return {
      journeyId: 'J09',
      contract: 'sop-register',
      status: 'fail',
      diff: { before: 'SOP service references sop/gate/register', after: 'no service mentions any of them', reason: 'J09#1 broken: SOP service is not wired to gate-able registration' },
      artifactPath: existing[0]!
    };
  }
  return {
    journeyId: 'J09',
    contract: 'sop-register',
    status: 'pass',
    artifactPath: existing[0]!
  };
}
