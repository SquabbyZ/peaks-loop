// src/services/capability-guard-runner/contracts/J09.ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GuardContext, GuardRunResult } from '../types.js';

const REQUIRED_FRAGMENTS: ReadonlyArray<string> = [
  'gate',
  'checkable',
  'register'
];

export async function runJ09Contract(ctx: GuardContext): Promise<GuardRunResult> {
  const candidates = [
    'src/services/sop/sop-service.ts',
    'src/services/sop/sop-register.ts',
    'src/services/sop/sop-check-service.ts',
    'src/services/sop/sop-types.ts'
  ];
  const existing = candidates.filter((f) => existsSync(join(ctx.projectRoot, f)));
  if (existing.length === 0) {
    return {
      journeyId: 'J09',
      contract: 'sop-register',
      status: 'fail',
      diff: { before: 'a SOP service file exists', after: 'no candidate found', reason: 'J09#1 broken: no SOP service is present' },
      artifactPath: 'src/services/sop/'
    };
  }
  let allOk = true;
  let missing: string[] = [];
  for (const file of existing) {
    const src = readFileSync(join(ctx.projectRoot, file), 'utf8');
    for (const frag of REQUIRED_FRAGMENTS) {
      if (!src.toLowerCase().includes(frag.toLowerCase())) {
        allOk = false;
        missing.push(`${file} missing fragment ${frag}`);
      }
    }
  }
  return {
    journeyId: 'J09',
    contract: 'sop-register',
    status: allOk ? 'pass' : 'fail',
    ...(allOk ? {} : { diff: { before: 'all SOP service files reference gate/checkable/register', after: missing.join('; '), reason: 'J09#1 broken: SOP service does not enforce gate-able registration' } }),
    artifactPath: existing[0]
  };
}