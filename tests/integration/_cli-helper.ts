/**
 * In-process CLI runner for integration tests.
 *
 * Why this exists: the previous `cli()` helper used
 * `execFileSync(TSX, [CLI_ENTRY, ...])` to spawn a fresh node + tsx
 * process per call. On Windows + vitest single-fork + full-suite
 * execution, this accumulated fs handle pressure + cold-start spawn
 * overhead and produced `Test timed out in 120000ms` failures that did
 * NOT reproduce when the test files were run in isolation. The
 * underlying CLI logic is fast (single `peaks asset crystallize` runs
 * in <100ms in-process) — the spawn itself was the cost.
 *
 * Replaces `execFileSync(TSX_BIN, ...)` with a direct in-process call
 * to `createProgram(io).parseAsync(...)`. Side-effects preserved:
 *   - `process.exitCode` is set by the command's action callback
 *     (same code path as the real CLI). We snapshot/restore around
 *     each call so the test runner's own exit accounting is not
 *     corrupted.
 *   - `process.cwd()` is changed to the test's per-case project root
 *     and restored afterward. Commands like `peaks asset crystallize`
 *     resolve `.peaks/state.db` relative to cwd.
 *   - Commander `exitOverride()` is enabled so `commander.helpDisplayed`
 *     and `commander.missingArgument` throw into our catch instead of
 *     calling `process.exit` and killing the test runner.
 *
 * The exported signature `{ stdout, stderr, code }` matches the
 * previous `cli()` 1:1 so call sites don't need further changes.
 */
import { createProgram, __resetBootstrapForTests } from '../../src/cli/program.js';
import type { ProgramIO } from '../../src/cli/cli-helpers.js';

export interface CliResult {
  stdout: string;
  stderr: string;
  code: number;
}

export async function runCli(args: string[], cwd: string): Promise<CliResult> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const io: ProgramIO = {
    stdout: (text: string) => stdoutChunks.push(text),
    stderr: (text: string) => stderrChunks.push(text)
  };

  const previousExitCode = process.exitCode;
  const previousCwd = process.cwd();
  process.exitCode = undefined;
  // Reset bootstrap-guard so the per-test peaks-loop start line is
  // emitted cleanly (process is shared across tests in single-fork mode).
  __resetBootstrapForTests();
  process.chdir(cwd);

  try {
    const program = createProgram(io);
    program.exitOverride();
    await program.parseAsync(['node', 'peaks', ...args], { from: 'node' });
  } catch (err: unknown) {
    // Commander's exitOverride throws on --help and on bad CLI input.
    // The human-readable error text has already been routed to stderr
    // via the program's configureOutput(). We mirror the production
    // JSON envelope that src/cli/index.ts writes on its .catch() path
    // so existing integration tests that grep stderr for a JSON
    // envelope continue to find it (e.g. asset-crystallize
    // "missing brief section" — commander rejects on requiredOption
    // before the action runs, so the only JSON the test can see is
    // the envelope written here).
    const code = (err as { code?: string } | null)?.code ?? '';
    if (
      code !== 'commander.help' &&
      code !== 'commander.helpDisplayed' &&
      code !== 'commander.version' &&
      code !== 'commander.missingArgument' &&
      code !== 'commander.unknownCommand' &&
      code !== 'commander.unknownOption'
    ) {
      const message = (err as Error)?.message ?? String(err);
      stderrChunks.push(JSON.stringify({
        ok: false,
        command: 'cli',
        code: 'UNHANDLED_ERROR',
        message,
        data: {},
        warnings: [],
        nextActions: []
      }));
      process.exitCode = 1;
    }
  } finally {
    process.chdir(previousCwd);
  }

  const code = process.exitCode ?? 0;
  process.exitCode = previousExitCode;
  return { stdout: stdoutChunks.join('\n'), stderr: stderrChunks.join('\n'), code };
}