import { execFileSync } from 'node:child_process';

export type MergePlan =
  | { readonly kind: 'fast-forward'; readonly command: ReadonlyArray<string> }
  | { readonly kind: 'no-ff'; readonly command: ReadonlyArray<string> }
  | { readonly kind: 'conflict'; readonly conflictingFiles: ReadonlyArray<string> }
  | { readonly kind: 'noop' }
  | { readonly kind: 'missing'; readonly reason: string };

export function planMergeBack(input: {
  readonly callerBranch: string;
  readonly agentBranch: string;
  readonly commitsBehind: number;
  readonly conflictingFiles: ReadonlyArray<string>;
}): MergePlan {
  if (input.agentBranch.length === 0) return { kind: 'missing', reason: 'agent-branch-empty' };
  if (input.callerBranch === input.agentBranch) return { kind: 'noop' };
  if (input.conflictingFiles.length > 0) return { kind: 'conflict', conflictingFiles: input.conflictingFiles };
  const base = ['git', 'merge', '--no-ff'];
  if (input.callerBranch === 'main' && input.commitsBehind === 0) {
    return { kind: 'fast-forward', command: ['git', 'merge', '--ff-only', input.agentBranch] };
  }
  return { kind: 'no-ff', command: [...base, input.agentBranch] };
}