// src/services/capability-guard-runner/contracts/J10.ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GuardContext, GuardRunResult } from '../types.js';

const CANDIDATE_FILES: ReadonlyArray<string> = [
  'src/cli/commands/hooks-commands.ts',
  'src/cli/commands/ide-commands.ts',
  'src/cli/commands/hook-handle.ts',
  'src/hooks/pre-tool-use-sub-agent.ts'
];

export async function runJ10Contract(ctx: GuardContext): Promise<GuardRunResult> {
  const existing = CANDIDATE_FILES.filter((f) => existsSync(join(ctx.projectRoot, f)));
  if (existing.length === 0) {
    return {
      journeyId: 'J10',
      contract: 'hook-assertion',
      status: 'fail',
      diff: { before: 'a hooks/ide/handle CLI file exists', after: 'no candidate found', reason: 'J10#1 broken: no IDE install/hook infrastructure is present' },
      artifactPath: 'src/cli/commands/hooks-commands.ts'
    };
  }
  const primary = existing.some((f) => {
    const src = readFileSync(join(ctx.projectRoot, f), 'utf8').toLowerCase();
    return src.includes('hook') || src.includes('install') || src.includes('ide') || src.includes('adapter');
  });
  if (!primary) {
    return {
      journeyId: 'J10',
      contract: 'hook-assertion',
      status: 'fail',
      diff: { before: 'hooks/ide commands reference install/hook/ide/adapter', after: 'no such reference', reason: 'J10#1 broken: hooks/ide commands do not implement install/hook/ide/adapter' },
      artifactPath: existing[0]!
    };
  }
  return {
    journeyId: 'J10',
    contract: 'hook-assertion',
    status: 'pass',
    artifactPath: existing[0]!
  };
}
