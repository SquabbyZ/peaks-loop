import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GuardContext, GuardRunResult } from '../types.js';

// v2: existence is the primary check; the single fragment is best-effort.
// v1 required 3 strict fragments (deepestGate / resume / etc.) and was too strict for
// 4.0.8 — the actual resume service uses camelCase variants and lives under session/.
const CANDIDATE_FILES: ReadonlyArray<string> = [
  'src/services/resume/resume-service.ts',
  'src/services/resume/resume-types.ts',
  'src/services/session/session-resume-service.ts',
  'src/services/session/session-checkpoint-service.ts'
];

export async function runJ06Contract(ctx: GuardContext): Promise<GuardRunResult> {
  const existing = CANDIDATE_FILES.filter((f) => existsSync(join(ctx.projectRoot, f)));
  if (existing.length === 0) {
    return {
      journeyId: 'J06',
      contract: 'workflow-trace',
      status: 'fail',
      diff: { before: 'a resume service file exists', after: 'none of the candidates found', reason: 'J06#1 broken: no resume service file is present' },
      artifactPath: 'src/services/resume/'
    };
  }
  // Soft check: at least one existing file mentions "resume".
  const mentionsResume = existing.some((f) => {
    const src = readFileSync(join(ctx.projectRoot, f), 'utf8');
    return src.toLowerCase().includes('resume');
  });
  if (!mentionsResume) {
    return {
      journeyId: 'J06',
      contract: 'workflow-trace',
      status: 'fail',
      diff: { before: 'resume service files mention "resume"', after: 'none mention resume', reason: 'J06#1 broken: resume service files do not reference the resume concept' },
      artifactPath: existing[0]!
    };
  }
  return {
    journeyId: 'J06',
    contract: 'workflow-trace',
    status: 'pass',
    artifactPath: existing[0]!
  };
}
