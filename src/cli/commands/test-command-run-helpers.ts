// src/cli/commands/test-command-run-helpers.ts
//
// The pieces `peaks test`'s action is built from: the clear-cache short
// circuit, the framework resolution, the runner output report and the failure
// envelope. Split out of `test-commands.ts`; every message, exit code and
// stream target is unchanged.
//
// This module deliberately does NOT import `test-commands.ts` — the runner
// spawn lives there (with its same-file `deps.spawnFn ?? spawn` alias), and a
// module graph that reaches back into the registration file is how a command
// family becomes a cycle.

import {
  clearTestCache,
  detectTestFramework,
  type TestFramework
} from '../../services/test-cache/test-cache-service.js';
import { FRAMEWORKS } from './test-command-runner-resolution.js';

export type TestOptions = {
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

/** A refused run, on the stream and in the shape the caller asked for. */
export function emitTestFailure(options: TestOptions, message: string): void {
  if (options.json === true) {
    process.stdout.write(JSON.stringify({ ok: false, error: message }) + '\n');
  } else {
    process.stderr.write(message + '\n');
  }
  process.exitCode = 1;
}

/** The `--clear-cache` short circuit. */
export function clearCacheAndReport(options: TestOptions, projectRoot: string): void {
  const result = clearTestCache(projectRoot);
  if (options.json === true) {
    process.stdout.write(
      JSON.stringify({
        ok: true,
        data: { cleared: true, removed: result.removed, dir: '.peaks/_runtime/test-cache/' }
      }) + '\n'
    );
    return;
  }
  process.stdout.write(
    `cleared ${result.removed} cache file(s) from .peaks/_runtime/test-cache/\n`
  );
}

/** The framework to run, or null after the matching refusal was emitted. */
export function resolveFramework(options: TestOptions, projectRoot: string): TestFramework | null {
  if (options.framework) {
    if (!FRAMEWORKS.includes(options.framework as TestFramework)) {
      emitTestFailure(
        options,
        `INVALID_FRAMEWORK: --framework must be one of ${FRAMEWORKS.join(', ')} (got "${options.framework}")`
      );
      return null;
    }
    return options.framework as TestFramework;
  }
  const detected = detectTestFramework(projectRoot);
  if (!detected) {
    emitTestFailure(
      options,
      'NO_TEST_FRAMEWORK: no supported test framework found in package.json (jest, vitest, or mocha). Install one and re-run, or pass --framework <name>.'
    );
    return null;
  }
  return detected;
}

/** Stream the runner's output to the user, then emit the JSON envelope. */
export function reportRunResult(
  options: TestOptions,
  framework: TestFramework,
  argv: string[],
  result: { code: number; stdout: string; stderr: string; notice: string | null }
): void {
  if (result.notice !== null) process.stderr.write(result.notice);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);

  if (result.code !== 0) {
    process.exitCode = 1;
  }

  if (options.json === true) {
    process.stdout.write(
      JSON.stringify({
        ok: result.code === 0,
        data: {
          framework,
          argv,
          exitCode: result.code,
          fingerprintCache: options.noCacheResult ? 'bypassed' : 'enabled',
          cacheDir: '.peaks/_runtime/test-cache/'
        }
      }) + '\n'
    );
  }
}
