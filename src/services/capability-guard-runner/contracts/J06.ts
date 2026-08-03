import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { GuardContext, GuardRunResult } from '../types.js';

const RESUME_SERVICE_FILES: ReadonlyArray<string> = [
  'src/services/resume/resume-service.ts',
  'src/services/resume/resume-types.ts',
  'src/services/session/session-resume-service.ts'
];

const REQUIRED_FRAGMENTS: ReadonlyArray<string> = [
  'deepestGate',
  'resume'
];

export async function runJ06Contract(ctx: GuardContext): Promise<GuardRunResult> {
  // At least one of the candidate resume service files must exist on disk.
  const existing = RESUME_SERVICE_FILES.filter((f) => existsSync(join(ctx.projectRoot, f)));
  // At least one existing resume service file must reference both "deepestGate" and "resume".
  const matched = existing.length > 0;
  if (!matched) {
    return {
      journeyId: 'J06',
      contract: 'workflow-trace',
      status: 'fail',
      diff: { before: 'a resume service file exists', after: 'none of the candidates found', reason: 'J06#1 broken: no resume service file is present' },
      artifactPath: 'src/services/resume/'
    };
  }
  let allOk = true;
  let missing: string[] = [];
  for (const file of existing) {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(join(ctx.projectRoot, file), 'utf8');
    for (const frag of REQUIRED_FRAGMENTS) {
      if (!src.toLowerCase().includes(frag.toLowerCase())) {
        allOk = false;
        missing.push(`${file} missing fragment ${frag}`);
      }
    }
  }
  return {
    journeyId: 'J06',
    contract: 'workflow-trace',
    status: allOk ? 'pass' : 'fail',
    ...(allOk ? {} : { diff: { before: 'all required fragments present in resume service', after: missing.join('; '), reason: 'J06#1 broken: resume service is missing deepestGate/resume references' } }),
    artifactPath: existing[0] ?? 'src/services/resume/'
  };
}
