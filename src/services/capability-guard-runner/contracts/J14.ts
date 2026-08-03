import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GuardContext, GuardRunResult } from '../types.js';

const CANDIDATE_FILES: ReadonlyArray<string> = [
  'skills/peaks-issue-fix-orchestrator/SKILL.md',
  '.peaks/memory/peaks-loop-positioning-loop-engineering.md',
  '.peaks/standards/loop-engineering-guidelines.md'
];

const REQUIRED_STAGES: ReadonlyArray<string> = ['triage', 'classify', 'fix', 'commit'];

export async function runJ14Contract(ctx: GuardContext): Promise<GuardRunResult> {
  const existing = CANDIDATE_FILES.filter((f) => existsSync(join(ctx.projectRoot, f)));
  if (existing.length === 0) {
    return {
      journeyId: 'J14',
      contract: 'workflow-trace',
      status: 'fail',
      diff: { before: 'a peaks-issue-fix-orchestrator skill or memory file exists', after: 'no candidate found', reason: 'J14#1 broken: no issue-sweep surface is present' },
      artifactPath: 'skills/peaks-issue-fix-orchestrator/SKILL.md'
    };
  }
  const matched = new Set<string>();
  for (const file of existing) {
    const src = readFileSync(join(ctx.projectRoot, file), 'utf8').toLowerCase();
    for (const stage of REQUIRED_STAGES) {
      if (src.includes(stage)) matched.add(stage);
    }
  }
  const ok = matched.size >= 2;
  return {
    journeyId: 'J14',
    contract: 'workflow-trace',
    status: ok ? 'pass' : 'fail',
    ...(ok ? {} : { diff: { before: 'at least 2 of triage/classify/fix/commit are referenced', after: `only ${[...matched].join(',')} found`, reason: 'J14#1 broken: issue-sweep pipeline has too few stages' } }),
    artifactPath: existing[0]!
  };
}
