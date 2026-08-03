import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GuardContext, GuardRunResult } from '../types.js';

const REQUIRED_FRAGMENTS: ReadonlyArray<string> = [
  "'functional-completeness'",
  "'problem-resolution'",
  "'no-new-bugs'",
  "'existing-functionality-intact'"
];

export async function runJ05Contract(ctx: GuardContext): Promise<GuardRunResult> {
  const servicePath = join(ctx.projectRoot, 'src', 'services', 'final-review', 'final-review-service.ts');
  const src = readFileSync(servicePath, 'utf8');
  const missing = REQUIRED_FRAGMENTS.filter((f) => !src.includes(f));
  const ok = missing.length === 0;
  return {
    journeyId: 'J05',
    contract: 'workflow-trace',
    status: ok ? 'pass' : 'fail',
    ...(ok ? {} : { diff: { before: 'all 4 dim strings present in final-review-service.ts', after: missing.join(','), reason: `J05#1 broken: missing fragments ${missing.join(',')}` } }),
    artifactPath: 'src/services/final-review/final-review-service.ts'
  };
}