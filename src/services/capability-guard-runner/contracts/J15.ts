import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GuardContext, GuardRunResult } from '../types.js';

const CANDIDATE_FILES: ReadonlyArray<string> = [
  'src/services/openspec/openspec-archive-service.ts',
  'src/services/openspec/coverage-evidence-reader.ts',
  'src/cli/commands/openspec-commands.ts'
];

const REQUIRED_FRAGMENTS: ReadonlyArray<string> = ['Capability Mapping', 'coverage'];

export async function runJ15Contract(ctx: GuardContext): Promise<GuardRunResult> {
  const existing = CANDIDATE_FILES.filter((f) => existsSync(join(ctx.projectRoot, f)));
  if (existing.length === 0) {
    return {
      journeyId: 'J15',
      contract: 'spec-coverage',
      status: 'fail',
      diff: { before: 'an openspec archive/coverage service exists', after: 'no candidate found', reason: 'J15#1 broken: no openspec/coverage surface is present' },
      artifactPath: 'src/services/openspec/'
    };
  }
  // At least one file references BOTH "Capability Mapping" AND "coverage".
  const fullCoverage = existing.some((f) => {
    const src = readFileSync(join(ctx.projectRoot, f), 'utf8');
    return REQUIRED_FRAGMENTS.every((frag) => src.includes(frag));
  });
  if (!fullCoverage) {
    return {
      journeyId: 'J15',
      contract: 'spec-coverage',
      status: 'fail',
      diff: { before: 'openspec services reference both "Capability Mapping" and "coverage"', after: 'no such service', reason: 'J15#1 broken: openspec archive gate is missing the Capability Mapping + coverage cross-check' },
      artifactPath: existing[0]!
    };
  }
  return {
    journeyId: 'J15',
    contract: 'spec-coverage',
    status: 'pass',
    artifactPath: existing[0]!
  };
}