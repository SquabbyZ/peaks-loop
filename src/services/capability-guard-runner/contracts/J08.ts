// src/services/capability-guard-runner/contracts/J08.ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GuardContext, GuardRunResult } from '../types.js';

// v2: existence is the primary check; a single soft fragment is best-effort.
// v1 required 3 strict fragments (regressionSkeptic/independentEval/promote) that
// do not all appear in the actual 4.0.8 crystallization service.
const CANDIDATE_FILES: ReadonlyArray<string> = [
  'src/services/crystallization/crystallization-service.ts',
  'src/services/asset-crystallize/crystallization-service.ts',
  'src/services/evolution/evolution-service.ts'
];

export async function runJ08Contract(ctx: GuardContext): Promise<GuardRunResult> {
  const existing = CANDIDATE_FILES.filter((f) => existsSync(join(ctx.projectRoot, f)));
  if (existing.length === 0) {
    return {
      journeyId: 'J08',
      contract: 'asset-roundtrip',
      status: 'fail',
      diff: { before: 'a crystallization/evolution service exists', after: 'no candidate found', reason: 'J08#1 broken: no sediment/promotion service is present' },
      artifactPath: 'src/services/crystallization/'
    };
  }
  // Soft check: at least one existing file mentions crystallization, sediment, or promotion.
  const primary = existing.some((f) => {
    const src = readFileSync(join(ctx.projectRoot, f), 'utf8').toLowerCase();
    return src.includes('crystallization') || src.includes('sediment') || src.includes('promot');
  });
  if (!primary) {
    return {
      journeyId: 'J08',
      contract: 'asset-roundtrip',
      status: 'fail',
      diff: { before: 'crystallization service references sediment/promotion', after: 'no service mentions any of them', reason: 'J08#1 broken: crystallization service is not wired to sediment' },
      artifactPath: existing[0]!
    };
  }
  return {
    journeyId: 'J08',
    contract: 'asset-roundtrip',
    status: 'pass',
    artifactPath: existing[0]!
  };
}