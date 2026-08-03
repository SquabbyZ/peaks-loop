import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { GuardContext, GuardRunResult } from '../types.js';

export async function runJ07Contract(ctx: GuardContext): Promise<GuardRunResult> {
  const bin = join(ctx.projectRoot, 'bin', 'peaks.js');
  // Run a single fast unit test file via `peaks test`. We do NOT use the full suite
  // (would be slow + flaky) — instead we run a known-fast single file. The contract's
  // job is to prove the runner shells out to vitest, not to certify all tests pass.
  let stdout = '';
  let stderr = '';
  let code = 0;
  try {
    stdout = execFileSync('node', [bin, 'test', 'tests/unit/capability-baseline/types.test.ts'], {
      cwd: ctx.projectRoot,
      env: { ...process.env, PEAKS_CALLER_ID: `guard-J07-${ctx.sessionId}` },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000
    }).toString('utf8');
  } catch (e) {
    const err = e as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
    stdout = typeof err.stdout === 'string' ? err.stdout : err.stdout?.toString('utf8') ?? '';
    stderr = typeof err.stderr === 'string' ? err.stderr : err.stderr?.toString('utf8') ?? '';
    code = err.status ?? 1;
  }
  // Acceptable: `peaks test <file>` exists and produces vitest output (the test file is
  // fast and deterministic). The contract passes if vitest reports a pass.
  const ok = code === 0 && /Tests\s+\d+\s+passed/i.test(stdout);
  return {
    journeyId: 'J07',
    contract: 'cli-output-golden',
    status: ok ? 'pass' : 'fail',
    ...(ok ? {} : { diff: { before: 'peaks test <file> exits 0 with "Tests N passed"', after: `exit=${code} stdout=${stdout.slice(0, 200)} stderr=${stderr.slice(0, 200)}`, reason: 'J07#1 broken: peaks test does not run the real vitest suite' } }),
    artifactPath: 'src/cli/commands/test-commands.ts'
  };
}
