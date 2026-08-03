import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GuardContext, GuardRunResult } from '../types.js';

const CANDIDATE_FILES: ReadonlyArray<string> = [
  'src/services/doctor/doctor-service.ts',
  'src/services/audit/audit-service.ts',
  'src/cli/commands/openspec-commands.ts',
  'src/services/openspec/openspec-propose-from-doctor-service.ts'
];

export async function runJ11Contract(ctx: GuardContext): Promise<GuardRunResult> {
  const existing = CANDIDATE_FILES.filter((f) => existsSync(join(ctx.projectRoot, f)));
  if (existing.length === 0) {
    return {
      journeyId: 'J11',
      contract: 'cli-output-golden',
      status: 'fail',
      diff: { before: 'a doctor/audit/openspec service exists', after: 'no candidate found', reason: 'J11#1 broken: no doctor surface is present' },
      artifactPath: 'src/services/doctor/doctor-service.ts'
    };
  }
  const primary = existing.some((f) => {
    const src = readFileSync(join(ctx.projectRoot, f), 'utf8').toLowerCase();
    return src.includes('doctor') || src.includes('audit') || src.includes('openspec') || src.includes('health');
  });
  if (!primary) {
    return {
      journeyId: 'J11',
      contract: 'cli-output-golden',
      status: 'fail',
      diff: { before: 'doctor/audit/openspec references health/audit/openspec', after: 'no such reference', reason: 'J11#1 broken: doctor/audit/openspec services are not wired' },
      artifactPath: existing[0]!
    };
  }
  return {
    journeyId: 'J11',
    contract: 'cli-output-golden',
    status: 'pass',
    artifactPath: existing[0]!
  };
}