import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GuardContext, GuardRunResult } from '../types.js';

const CANDIDATE_FILES: ReadonlyArray<string> = [
  'skills/peaks-content/SKILL.md',
  'src/services/content/',
  'src/services/workflow/workflow-router-service.ts',
  '.peaks/standards/loop-engineering-guidelines.md'
];

const STAGES: ReadonlyArray<string> = ['draft', 'edit', 'tone', 'publish', 'archive'];

export async function runJ13Contract(ctx: GuardContext): Promise<GuardRunResult> {
  const existing = CANDIDATE_FILES.filter((f) => existsSync(join(ctx.projectRoot, f)));
  if (existing.length === 0) {
    return {
      journeyId: 'J13',
      contract: 'workflow-trace',
      status: 'fail',
      diff: { before: 'a content / peaks-content skill exists', after: 'no candidate found', reason: 'J13#1 broken: no content production surface is present' },
      artifactPath: 'skills/peaks-content/SKILL.md'
    };
  }
  // Soft check: at least 3 of 5 stages appear in any existing file's content.
  const matchedStages = new Set<string>();
  for (const file of existing) {
    const src = readFileSync(join(ctx.projectRoot, file), 'utf8').toLowerCase();
    for (const stage of STAGES) {
      if (src.includes(stage)) matchedStages.add(stage);
    }
  }
  if (matchedStages.size < 3) {
    return {
      journeyId: 'J13',
      contract: 'workflow-trace',
      status: 'fail',
      diff: { before: 'at least 3 of draft/edit/tone/publish/archive stages are referenced', after: `only ${[...matchedStages].join(',')} found`, reason: 'J13#1 broken: content pipeline has too few stages' },
      artifactPath: existing[0]!
    };
  }
  return {
    journeyId: 'J13',
    contract: 'workflow-trace',
    status: 'pass',
    artifactPath: existing[0]!
  };
}