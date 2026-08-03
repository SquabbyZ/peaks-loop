// src/services/capability-guard-runner/contracts/J03.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GuardContext, GuardRunResult } from '../types.js';

const REQUIRED_DIMENSIONS: ReadonlyArray<string> = [
  'functional-completeness',
  'problem-resolution',
  'no-new-bugs',
  'existing-functionality-intact'
];

export async function runJ03Contract(ctx: GuardContext): Promise<GuardRunResult> {
  // Static check: the 4-dim final-review type module MUST still export those 4 dimension strings.
  // This is a contract against accidental removal, not a runtime test of an LLM.
  const typesPath = join(ctx.projectRoot, 'src', 'services', 'final-review', 'final-review-types.ts');
  const src = readFileSync(typesPath, 'utf8');
  const missing = REQUIRED_DIMENSIONS.filter((d) => !src.includes(`'${d}'`));
  const ok = missing.length === 0;
  return {
    journeyId: 'J03',
    contract: 'workflow-trace',
    status: ok ? 'pass' : 'fail',
    ...(ok ? {} : { diff: { before: REQUIRED_DIMENSIONS.join(','), after: missing.join(','), reason: `J03#1 broken: missing dimensions ${missing.join(',')}` } }),
    artifactPath: 'src/services/final-review/final-review-types.ts'
  };
}