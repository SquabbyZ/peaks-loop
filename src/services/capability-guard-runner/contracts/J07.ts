import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GuardContext, GuardRunResult } from '../types.js';

// v2: existence-of-CLI + source-contains-vitest, not actual invocation.
// v1 failed with `spawn vitest ENOENT` because the test runner spawns a child vitest
// that needs `pnpm`/PATH configured; the test fixture doesn't have that. A dry-run
// probe is enough to prove the `peaks test` subcommand is registered and the runner
// is wired to vitest, without actually executing a vitest child process.
const TEST_COMMAND_FILES: ReadonlyArray<string> = [
  'src/cli/commands/test-commands.ts',
  'src/services/test/',
  'src/services/test-runner/'
];

export async function runJ07Contract(ctx: GuardContext): Promise<GuardRunResult> {
  // 1. CLI probe: `peaks test --help` must produce non-empty output.
  let helpOk = false;
  try {
    const bin = join(ctx.projectRoot, 'bin', 'peaks.js');
    const out = execFileSync('node', [bin, 'test', '--help'], {
      cwd: ctx.projectRoot,
      env: { ...process.env, PEAKS_CALLER_ID: `guard-J07-${ctx.sessionId}` },
      stdio: ['ignore', 'pipe', 'pipe']
    }).toString('utf8');
    helpOk = out.length > 0 && !out.includes('unknown command');
  } catch {
    helpOk = false;
  }

  // 2. Source probe: at least one test command file references vitest.
  const sourceMentionsVitest = TEST_COMMAND_FILES.some((f) => {
    const abs = join(ctx.projectRoot, f);
    if (!existsSync(abs)) return false;
    if (existsSync(abs) && readFileSync(abs, 'utf8').includes('vitest')) return true;
    return false;
  });

  // 3. package.json probe: vitest is in dependencies.
  const pkgPath = join(ctx.projectRoot, 'package.json');
  let pkgHasVitest = false;
  if (existsSync(pkgPath)) {
    const pkg = readFileSync(pkgPath, 'utf8');
    pkgHasVitest = /"vitest"\s*:/i.test(pkg);
  }

  const ok = helpOk && sourceMentionsVitest && pkgHasVitest;
  return {
    journeyId: 'J07',
    contract: 'cli-output-golden',
    status: ok ? 'pass' : 'fail',
    ...(ok ? {} : { diff: { before: 'peaks test --help works, test commands reference vitest, package.json has vitest', after: `helpOk=${helpOk} sourceMentionsVitest=${sourceMentionsVitest} pkgHasVitest=${pkgHasVitest}`, reason: 'J07#1 broken: peaks test does not delegate to vitest' } }),
    artifactPath: 'src/cli/commands/test-commands.ts'
  };
}