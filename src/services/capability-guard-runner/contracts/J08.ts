// src/services/capability-guard-runner/contracts/J08.ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GuardContext, GuardRunResult } from '../types.js';

const REQUIRED_FRAGMENTS: ReadonlyArray<string> = [
  'regressionSkeptic',
  'independentEval',
  'promote'
];

export async function runJ08Contract(ctx: GuardContext): Promise<GuardRunResult> {
  const candidates = [
    'src/services/crystallization/crystallization-service.ts',
    'src/services/asset-crystallize/crystallization-service.ts',
    'src/services/evolution/evolution-service.ts',
    'src/services/loop-engineering/loop-engineering-service.ts'
  ];
  const existing = candidates.filter((f) => existsSync(join(ctx.projectRoot, f)));
  if (existing.length === 0) {
    return {
      journeyId: 'J08',
      contract: 'asset-roundtrip',
      status: 'fail',
      diff: { before: 'a crystallization/loop-engineering service exists', after: 'no candidate found', reason: 'J08#1 broken: no sediment/promotion service is present' },
      artifactPath: 'src/services/crystallization/'
    };
  }
  let allOk = true;
  let missing: string[] = [];
  for (const file of existing) {
    const src = readFileSync(join(ctx.projectRoot, file), 'utf8');
    for (const frag of REQUIRED_FRAGMENTS) {
      if (!src.includes(frag)) {
        allOk = false;
        missing.push(`${file} missing fragment ${frag}`);
      }
    }
  }
  return {
    journeyId: 'J08',
    contract: 'asset-roundtrip',
    status: allOk ? 'pass' : 'fail',
    ...(allOk ? {} : { diff: { before: 'all crystallization/loop-engineering services run anti-drift before promotion', after: missing.join('; '), reason: 'J08#1 broken: regressionSkeptic / independentEval / promote not all present' } }),
    artifactPath: existing[0]
  };
}
