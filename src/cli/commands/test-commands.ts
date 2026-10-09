/**
 * `peaks test <pattern...>` — slice 2.5.0 sub-fix B (Prob 2).
 *
 * Wraps the consumer project's test framework (jest / vitest / mocha)
 * with a per-test fingerprint cache. The wrapper:
 *
 *   1. Auto-detects the framework from package.json (devDependencies +
 *      dependencies) via detectTestFramework().
 *   2. Resolves the project-LOCAL runner binary (node_modules) and spawns
 *      that, so the command works where the runner is not on PATH — notably
 *      Windows, where node_modules/.bin/vitest.cmd is not spawnable without
 *      a shell. PATH is a last resort and is reported, not silent.
 *   3. Spawns the framework's CLI with --cache enabled (overriding any
 *      --no-cache in the consumer's `test` script). The user can
 *      opt back into no-cache via `peaks test --no-cache` or
 *      `peaks test --passthrough`.
 *   4. Skips tests where (fileMtime, fileSha256) is unchanged AND the
 *      previous run status was 'passed' (per-test fingerprint cache at
 *      `<projectRoot>/.peaks/_runtime/test-cache/<hash>.json`).
 *   5. Exits 0 on all-pass / all-skip; exits 1 on any failure.
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
 *
 * The runner resolution and this file's spawn site live here; the action body
 * it dispatches to lives in `test-command-run.ts` and the argv/probe rules in
 * `test-command-runner-resolution.ts`.
 */

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { Command } from 'commander';
import { getErrorMessage, type ProgramIO } from '../cli-helpers.js';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import type { TestFramework } from '../../services/test-cache/test-cache-service.js';
import {
  buildRunnerArgv,
  formatRunnerNotFound,
  FRAMEWORKS,
  resolveRunner,
  type ResolveRunnerDeps
} from './test-command-runner-resolution.js';
import {
  clearCacheAndReport,
  emitTestFailure,
  reportRunResult,
  resolveFramework,
  type TestOptions
} from './test-command-run-helpers.js';

export type RunRunnerDeps = ResolveRunnerDeps & { spawnFn?: typeof spawn };

export function runRunner(
  framework: TestFramework,
  argv: string[],
  projectRoot: string,
  deps: RunRunnerDeps = {}
): Promise<{ code: number; stdout: string; stderr: string; notice: string | null }> {
  const resolution = resolveRunner(framework, argv, projectRoot, deps);
  if (!resolution.ok) {
    return Promise.reject(new Error(formatRunnerNotFound(framework, resolution.searched)));
  }
  const notice = resolution.fromPath
    ? `[peaks test] no local ${framework} under ${join(projectRoot, 'node_modules')}; falling back to ${resolution.via}\n`
    : null;
  return new Promise((resolveRun, reject) => {
    const spawnFn = deps.spawnFn ?? spawn;
    const proc = spawnFn(resolution.command, resolution.args, {
      cwd: projectRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    proc.on('error', (err: Error) => reject(err));
    proc.on('close', (code) => {
      resolveRun({ code: code ?? 0, stdout, stderr, notice });
    });
  });
}

export function registerTestCommands(program: Command, _io: ProgramIO): void {
  program
    .command('test')
    .description(
      "Wrap the consumer project's test framework (jest/vitest/mocha) " +
        'with a per-test fingerprint cache. Default args: <pattern...> ' +
        'runs jest|vitest|mocha <pattern> --cache. Exit 0 on all-pass / ' +
        'all-skip, exit 1 on any failure. (slice 2.5.0 sub-fix B)'
    )
    .argument('[patterns...]', 'test file pattern(s) to run (passed to the framework verbatim)')
    .option('--all', 'run the full suite (skip the pattern filter)')
    .option('--changed', 'only run tests in files changed since HEAD')
    .option(
      '--clear-cache',
      'empty the fingerprint cache at .peaks/_runtime/test-cache/ and exit 0'
    )
    .option('--no-cache-result', 'bypass the per-test fingerprint cache (always re-run)')
    .option('--no-cache', 'pass --no-cache to the underlying framework (overrides peaks default)')
    .option('--passthrough', "do NOT override the consumer's argv; pass patterns through verbatim")
    .option('--framework <name>', `force a specific framework: ${FRAMEWORKS.join(', ')}`)
    .option('--project <path>', 'project root (defaults to current directory)', process.cwd())
    .option('--json', 'emit a JSON envelope { ok, data } to stdout')
    .action(async (patterns: string[], options: TestOptions) => {
      try {
        const projectRoot = resolveCanonicalProjectRoot(options.project ?? process.cwd());
        if (options.clearCache === true) {
          clearCacheAndReport(options, projectRoot);
          return;
        }
        const framework = resolveFramework(options, projectRoot);
        if (framework === null) return;

        // Pattern argument: --all clears the list, --changed adds --changedSince
        const argv = buildRunnerArgv(framework, options.all ? [] : patterns, {
          all: options.all === true,
          changed: options.changed === true,
          cache: options.cache === true,
          passthrough: options.passthrough === true
        });
        reportRunResult(options, framework, argv, await runRunner(framework, argv, projectRoot));
      } catch (error) {
        emitTestFailure(options, getErrorMessage(error));
      }
    });
}

// Re-export for tests / external consumers: the runner resolver is driven
// directly (with injected fs / spawn / platform seams) by
// `tests/unit/cli/commands/test-commands-runner-resolution.test.ts`.
export {
  buildRunnerArgv,
  formatRunnerNotFound,
  resolveRunner,
  type ResolveRunnerDeps,
  type RunnerFound,
  type RunnerResolution
} from './test-command-runner-resolution.js';
export type { TestOptions } from './test-command-run-helpers.js';
