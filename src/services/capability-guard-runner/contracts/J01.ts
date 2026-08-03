import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { GuardContext, GuardRunResult } from '../types.js';

const FIXTURES: ReadonlyArray<readonly [string, string]> = [
  ['make', 'implement a CLI parser'],
  ['make', 'refactor the service'],
  ['make', 'write a blog article'],
  ['learn', 'author an SOP checklist'],
  ['check', 'run red-lines audit'],
  ['run',  'execute a workflow']
];

export async function runJ01Contract(ctx: GuardContext): Promise<GuardRunResult> {
  const bin = process.env.PEAKS_BIN_OVERRIDE ?? join(ctx.projectRoot, 'bin', 'peaks.js');
  let allOk = true;
  let firstFailure = '';
  for (const [command, input] of FIXTURES) {
    try {
      const stdout = execFileSync('node', [bin, command, input], {
        cwd: ctx.projectRoot,
        env: { ...process.env, PEAKS_CALLER_ID: `guard-J01-${ctx.sessionId}` }
      }).toString('utf8');
      const env = JSON.parse(stdout) as { ok: boolean };
      if (!env.ok) {
        allOk = false;
        firstFailure = `${command} ${input}`;
        break;
      }
    } catch (e) {
      allOk = false;
      firstFailure = `${command} ${input}: ${(e as Error).message}`;
      break;
    }
  }
  return allOk
    ? {
        journeyId: 'J01',
        contract: 'envelope-arg-shapes',
        status: 'pass',
        artifactPath: 'tests/integration/super-command-routing.test.ts'
      }
    : {
        journeyId: 'J01',
        contract: 'envelope-arg-shapes',
        status: 'fail',
        diff: { before: 'all 6 routing cases ok', after: firstFailure, reason: 'J01#1 broken: super-command routing NL path deviates from frozen baseline' },
        artifactPath: 'tests/integration/super-command-routing.test.ts'
      };
}