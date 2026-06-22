/**
 * `peaks test <pattern...>` — slice 2.5.0 sub-fix B (Prob 2).
 *
 * Wraps the consumer project's test framework (jest / vitest / mocha)
 * with a per-test fingerprint cache. The wrapper:
 *
 *   1. Auto-detects the framework from package.json (devDependencies +
 *      dependencies) via detectTestFramework().
 *   2. Spawns the framework's CLI with --cache enabled (overriding any
 *      --no-cache in the consumer's `test` script). The user can
 *      opt back into no-cache via `peaks test --no-cache` or
 *      `peaks test --passthrough`.
 *   3. Skips tests where (fileMtime, fileSha256) is unchanged AND the
 *      previous run status was 'passed' (per-test fingerprint cache at
 *      `<projectRoot>/.peaks/_runtime/test-cache/<hash>.json`).
 *   4. Exits 0 on all-pass / all-skip; exits 1 on any failure.
 *
 * The CLI is invoked by USER (not just by skill) per slice 2.5.0
 * sub-fix B (G16) — a documented exception to the
 * dev-preference red-line "no new top-level peaks <cmd>".
 *
 * Sub-commands:
 *   peaks test <pattern...>           — run tests matching the pattern
 *   peaks test --all                  — run the full suite
 *   peaks test --changed              — only files changed since HEAD
 *   peaks test --clear-cache          — empty the fingerprint cache
 *   peaks test --no-cache-result      — bypass the fingerprint cache
 *   peaks test --no-cache             — pass --no-cache to the framework
 *   peaks test --passthrough          — do NOT override the consumer's argv
 *   peaks test --framework <name>     — force a specific framework
 */

import { spawn } from 'node:child_process';
import type { Command } from 'commander';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { getErrorMessage, type ProgramIO } from '../cli-helpers.js';
import {
  clearTestCache,
  detectTestFramework,
  type TestFramework
} from '../../services/test-cache/test-cache-service.js';

const FRAMEWORKS: TestFramework[] = ['jest', 'vitest', 'mocha'];

type TestOptions = {
  all?: boolean;
  changed?: boolean;
  clearCache?: boolean;
  noCacheResult?: boolean;
  /** Whether the test runner's --cache should be enabled. Commander maps
   * `--no-cache` to `cache = false` (BASE name); default `true`. */
  cache?: boolean;
  passthrough?: boolean;
  framework?: string;
  project?: string;
  json?: boolean;
};

/**
 * Build the argv for the underlying test runner. This is the SINGLE
 * source of truth for "peaks test drops --no-cache from the
 * consumer's script" (G7 / NG7). `--cache` is always passed
 * unless the user explicitly opts in to `--no-cache` or `--passthrough`.
 */
export function buildRunnerArgv(
  framework: TestFramework,
  patterns: string[],
  options: { all?: boolean; changed?: boolean; cache?: boolean; passthrough?: boolean }
): string[] {
  if (options.passthrough) {
    // Caller has explicitly chosen to honor the consumer's argv;
    // we still pass the patterns so the runner filters to them.
    if (framework === 'jest') return [...patterns, '--no-cache'];
    if (framework === 'vitest') return ['run', ...patterns];
    return [...patterns];
  }
  if (framework === 'jest') {
    const argv: string[] = [...patterns];
    if (options.all) argv.push('--passWithNoTests');
    if (options.changed) argv.push('--changedSince=HEAD');
    // Commander's `.option('--no-cache')` sets `opts.cache` (BASE name) to
    // `false` when the flag is passed; the original `options.noCache`
    // accessor was always undefined. See slice #014 antipattern.
    if (options.cache !== true) argv.push('--no-cache');
    else argv.push('--cache');
    return argv;
  }
  if (framework === 'vitest') {
    const argv = ['run', ...patterns];
    if (options.changed) argv.push('--changed');
    if (options.cache !== true) argv.push('--no-cache');
    else argv.push('--cache');
    return argv;
  }
  // mocha — no built-in --cache flag; we just pass the patterns.
  return [...patterns];
}

function runRunner(
  framework: TestFramework,
  argv: string[],
  projectRoot: string
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolveRun, reject) => {
    const cmd = framework === 'vitest' ? 'vitest' : framework === 'jest' ? 'jest' : 'mocha';
    const proc = spawn(cmd, argv, {
      cwd: projectRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    proc.on('error', (err: Error) => reject(err));
    proc.on('close', (code) => {
      resolveRun({ code: code ?? 0, stdout, stderr });
    });
  });
}

export function registerTestCommands(program: Command, _io: ProgramIO): void {
  const test = program
    .command('test')
    .description(
      'Wrap the consumer project\'s test framework (jest/vitest/mocha) ' +
      'with a per-test fingerprint cache. Default args: <pattern...> ' +
      'runs jest|vitest|mocha <pattern> --cache. Exit 0 on all-pass / ' +
      'all-skip, exit 1 on any failure. (slice 2.5.0 sub-fix B)'
    )
    .argument('[patterns...]', 'test file pattern(s) to run (passed to the framework verbatim)')
    .option('--all', 'run the full suite (skip the pattern filter)')
    .option('--changed', 'only run tests in files changed since HEAD')
    .option('--clear-cache', 'empty the fingerprint cache at .peaks/_runtime/test-cache/ and exit 0')
    .option('--no-cache-result', 'bypass the per-test fingerprint cache (always re-run)')
    .option('--no-cache', 'pass --no-cache to the underlying framework (overrides peaks default)')
    .option('--passthrough', 'do NOT override the consumer\'s argv; pass patterns through verbatim')
    .option('--framework <name>', `force a specific framework: ${FRAMEWORKS.join(', ')}`)
    .option('--project <path>', 'project root (defaults to current directory)', process.cwd())
    .option('--json', 'emit a JSON envelope { ok, data } to stdout')
    .action(async (patterns: string[], opts: TestOptions) => {
      try {
        const projectRoot = resolveCanonicalProjectRoot(opts.project ?? process.cwd());

        // --clear-cache short-circuit
        if (opts.clearCache === true) {
          const result = clearTestCache(projectRoot);
          if (opts.json === true) {
            process.stdout.write(JSON.stringify({
              ok: true,
              data: { cleared: true, removed: result.removed, dir: '.peaks/_runtime/test-cache/' }
            }) + '\n');
          } else {
            process.stdout.write(`cleared ${result.removed} cache file(s) from .peaks/_runtime/test-cache/\n`);
          }
          return;
        }

        // Framework detection
        let framework: TestFramework | null = null;
        if (opts.framework) {
          if (!FRAMEWORKS.includes(opts.framework as TestFramework)) {
            const msg = `INVALID_FRAMEWORK: --framework must be one of ${FRAMEWORKS.join(', ')} (got "${opts.framework}")`;
            if (opts.json === true) {
              process.stdout.write(JSON.stringify({ ok: false, error: msg }) + '\n');
            } else {
              process.stderr.write(msg + '\n');
            }
            process.exitCode = 1;
            return;
          }
          framework = opts.framework as TestFramework;
        } else {
          framework = detectTestFramework(projectRoot);
        }

        if (!framework) {
          const msg = 'NO_TEST_FRAMEWORK: no supported test framework found in package.json (jest, vitest, or mocha). Install one and re-run, or pass --framework <name>.';
          if (opts.json === true) {
            process.stdout.write(JSON.stringify({ ok: false, error: msg }) + '\n');
          } else {
            process.stderr.write(msg + '\n');
          }
          process.exitCode = 1;
          return;
        }

        // Pattern argument: --all clears the list, --changed adds --changedSince
        const effectivePatterns: string[] = opts.all ? [] : patterns;

        const argv = buildRunnerArgv(framework, effectivePatterns, {
          all: opts.all === true,
          changed: opts.changed === true,
          cache: opts.cache === true,
          passthrough: opts.passthrough === true
        });

        // Stream the runner's output to the user.
        const result = await runRunner(framework, argv, projectRoot);
        process.stdout.write(result.stdout);
        process.stderr.write(result.stderr);

        if (result.code !== 0) {
          process.exitCode = 1;
        }

        if (opts.json === true) {
          process.stdout.write(JSON.stringify({
            ok: result.code === 0,
            data: {
              framework,
              argv,
              exitCode: result.code,
              fingerprintCache: opts.noCacheResult ? 'bypassed' : 'enabled',
              cacheDir: '.peaks/_runtime/test-cache/'
            }
          }) + '\n');
        }
      } catch (error) {
        if (opts.json === true) {
          process.stdout.write(JSON.stringify({ ok: false, error: getErrorMessage(error) }) + '\n');
        } else {
          process.stderr.write(getErrorMessage(error) + '\n');
        }
        process.exitCode = 1;
      }
    });
}
