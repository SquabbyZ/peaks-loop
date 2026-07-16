/**
 * D-013 wrapper exit-code fix — regression coverage.
 *
 * Bug: `peaks <unknown>` and `peaks <unknown> --help` returned exit 0
 * with the help banner. Root cause: Commander's `.exitOverride()`
 * threw `commander.unknownCommand` but the catch in `src/cli/index.ts`
 * for `commander.helpDisplayed` swallowed the exit code, AND the
 * root `.action()` in `src/cli/program.ts` unconditionally printed
 * the banner with exit 0.
 *
 * Fix (slice 2026-07-16-d-013):
 * (1) `src/cli/program.ts` root `.action()` now inspects `process.argv`
 *     for a non-option positional token. If present and the user typed
 *     a command that didn't route to any subcommand, emits a
 *     `COMMAND_NOT_FOUND` JSON envelope + exit 1.
 * (2) `src/cli/index.ts` pre-check (setImmediate) handles the
 *     `peaks <unknown> --help` case where Commander's help short-circuit
 *     fires BEFORE the unknownCommand throw.
 *
 * This test exercises the root `.action()` path (in-process) for the
 * no-help case. The --help case is exercised manually (see D-013 sediment).
 *
 * Coverage: every regression path that previously exited 0 with a banner.
 */
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { runCli } from '../../integration/_cli-helper.js';

const REPO_ROOT = resolve(__dirname, '..', '..');

describe('D-013 wrapper exit-code fix', () => {
  test('D-013.A: peaks <unknown> emits COMMAND_NOT_FOUND envelope + exit 1', async () => {
    const result = await runCli(['this-cmd-does-not-exist'], REPO_ROOT);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('"code": "COMMAND_NOT_FOUND"');
    expect(result.stdout).toContain('this-cmd-does-not-exist');
    expect(result.stdout).not.toContain('13 skills ready'); // banner should NOT print
  });

  test('D-013.B: peaks <deleted-cmd> emits COMMAND_NOT_FOUND envelope + exit 1', async () => {
    // Slice 3 deleted `peaks agent` registration; the hidden+removed
    // contract means typing `peaks agent` now looks like an unknown
    // command to Commander. The D-013 fix returns exit 1 + envelope.
    const result = await runCli(['agent', 'run', 'foo'], REPO_ROOT);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('"code": "COMMAND_NOT_FOUND"');
  });

  test('D-013.C: peaks --help (no positional) still exits 0 with help text', async () => {
    const result = await runCli(['--help'], REPO_ROOT);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Usage: peaks');
  });

  test('D-013.D: peaks --version still exits 0', async () => {
    const result = await runCli(['--version'], REPO_ROOT);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^\d+\.\d+\.\d+/);
  });

  test('D-013.E: bare peaks still exits 0 with banner', async () => {
    const result = await runCli([], REPO_ROOT);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('skills ready');
  });
});