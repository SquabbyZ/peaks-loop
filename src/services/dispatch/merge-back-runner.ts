import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { planMergeBack } from './post-merge.js';
import { killRegisteredServices, type ServiceRegistration, type ServiceKillResult } from './service-shutdown.js';
import { buildConflictReplay, type ConflictReplayOutput } from './conflict-replay.js';

const REGISTRATIONS_FILE = 'service-registrations.json';

export type RunMergeBackInput = {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly dispatchId: string;
  readonly callerBranch: string;
  readonly agentBranch: string;
  readonly onConflict: (replay: ConflictReplayOutput) => Promise<{ readonly ok: boolean }>;
};
export type RunMergeBackResult = {
  readonly kind: 'merged' | 'noop' | 'replay-exhausted' | 'replay-still-conflict';
  readonly attempts: number;
  readonly serviceKills: ReadonlyArray<ServiceKillResult>;
};

function registrationsFile(input: RunMergeBackInput): string {
  return join(input.projectRoot, '.peaks', '_runtime', input.sessionId, 'dispatch', input.dispatchId, REGISTRATIONS_FILE);
}

function readRegistrations(input: RunMergeBackInput): ReadonlyArray<ServiceRegistration> {
  const f = registrationsFile(input);
  if (!existsSync(f)) return [];
  try { return JSON.parse(readFileSync(f, 'utf8')) as ReadonlyArray<ServiceRegistration>; } catch { return []; }
}

function captureConflictDiff(input: RunMergeBackInput): string {
  try { return execFileSync('git', ['diff', '--merge', '--no-color'], { cwd: input.projectRoot, encoding: 'utf8' }); } catch { return ''; }
}

function captureTranscript(input: RunMergeBackInput): ReadonlyArray<string> {
  try { return execFileSync('git', ['merge', '--no-edit', '--no-ff', input.agentBranch], { cwd: input.projectRoot, encoding: 'utf8' }).split('\n'); }
  catch { return ['git merge --no-edit --no-ff ' + input.agentBranch]; }
}

export async function runMergeBack(input: RunMergeBackInput): Promise<RunMergeBackResult> {
  const kills = killRegisteredServices({ registrations: readRegistrations(input) });
  const originalPrompt = process.env.PEAKS_DISPATCH_PROMPT ?? '';
  let attempts = 0;
  while (attempts < 2) {
    attempts += 1;
    const plan = planMergeBack({
      callerBranch: input.callerBranch,
      agentBranch: input.agentBranch,
      commitsBehind: 0,
      conflictingFiles: [],
    });
    if (plan.kind === 'noop') return { kind: 'noop', attempts, serviceKills: kills };
    if (plan.kind === 'missing') return { kind: 'replay-exhausted', attempts, serviceKills: kills };
    if (plan.kind === 'conflict') {
      const conflictDiff = captureConflictDiff(input);
      const replay = buildConflictReplay({ originalPrompt, mergeAttemptTranscript: [], conflictDiff, callerBranch: input.callerBranch });
      const replayResult = await input.onConflict(replay);
      if (!replayResult.ok) {
        return { kind: attempts >= 2 ? 'replay-exhausted' : 'replay-still-conflict', attempts, serviceKills: kills };
      }
      continue;
    }
    try {
      execFileSync('git', ['checkout', input.callerBranch], { cwd: input.projectRoot, stdio: 'ignore' });
      execFileSync(plan.command[0] as string, plan.command.slice(1), { cwd: input.projectRoot, stdio: 'ignore' });
      return { kind: 'merged', attempts, serviceKills: kills };
    } catch (error) {
      const transcript = captureTranscript(input);
      const conflictDiff = captureConflictDiff(input);
      const replay = buildConflictReplay({ originalPrompt, mergeAttemptTranscript: transcript, conflictDiff, callerBranch: input.callerBranch });
      const replayResult = await input.onConflict(replay);
      try { execFileSync('git', ['merge', '--abort'], { cwd: input.projectRoot, stdio: 'ignore' }); } catch { /* ignore */ }
      if (!replayResult.ok) {
        return { kind: attempts >= 2 ? 'replay-exhausted' : 'replay-still-conflict', attempts, serviceKills: kills };
      }
    }
  }
  return { kind: 'replay-exhausted', attempts, serviceKills: kills };
}
