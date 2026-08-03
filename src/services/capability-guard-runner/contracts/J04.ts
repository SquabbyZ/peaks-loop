import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GuardContext, GuardRunResult } from '../types.js';

export async function runJ04Contract(ctx: GuardContext): Promise<GuardRunResult> {
  const bin = join(ctx.projectRoot, 'bin', 'peaks.js');
  const tmp = mkdtempSync(join(tmpdir(), 'cbl-J04-'));

  // Probe: `peaks audit goal` must be a registered subcommand (returns a help-like response or a structured envelope).
  let helpOk = false;
  try {
    const stdout = execFileSync('node', [bin, 'audit', 'goal', '--help'], {
      cwd: ctx.projectRoot,
      env: { ...process.env, PEAKS_CALLER_ID: `guard-J04-${ctx.sessionId}` }
    }).toString('utf8');
    helpOk = stdout.length > 0 && !stdout.includes('unknown command');
  } catch {
    helpOk = false;
  }

  // Probe: `peaks audit goal` without a goal must not silently succeed.
  let rejectsEmpty = false;
  try {
    execFileSync('node', [bin, 'audit', 'goal', '--project', tmp, '--json'], {
      cwd: ctx.projectRoot,
      env: { ...process.env, PEAKS_CALLER_ID: `guard-J04-${ctx.sessionId}` },
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (e) {
    rejectsEmpty = true;
  }

  const ok = helpOk && rejectsEmpty;
  return {
    journeyId: 'J04',
    contract: 'hook-assertion',
    status: ok ? 'pass' : 'fail',
    ...(ok ? {} : { diff: { before: 'audit goal is registered and rejects empty input', after: `helpOk=${helpOk} rejectsEmpty=${rejectsEmpty}`, reason: 'J04#1 broken: audit goal binding is bypassed or missing' } }),
    artifactPath: 'src/services/audit/audit-goal-service.ts'
  };
}
