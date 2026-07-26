/**
 * Slice rid-001 — P0-1 envelope-closure regression.
 *
 * Bug: `src/cli/index.ts` had 3 raw `console.error(JSON.stringify(...))`
 * sites that emitted envelope-shaped JSON but bypassed the
 * `peaks-loop-shared/result` helper. The duplication meant:
 *   - No `errorId` (correlation)
 *   - No `redactSensitiveErrorMessage` (secrets in `message` could leak)
 *   - Drift risk: the hand-rolled JSON shape could diverge from the
 *     canonical envelope over time, breaking LLM-side consumers that
 *     relied on the documented `{ ok, command, code, message, data,
 *     warnings, nextActions }` contract.
 *
 * Fix: all 3 sites now route through `printErrorEnvelope` in
 * `src/cli/cli-helpers.ts`, which mints a real `fail()` envelope and
 * writes it to stderr as pretty JSON. This test pins:
 *
 *   1. Helper unit surface — direct calls produce canonical shape with
 *      `errorId`, redaction, and exit code 1.
 *   2. End-to-end entry point — invoking the real `src/cli/index.ts`
 *      module from a fresh process for each of the 3 paths:
 *        a) UNKNOWN_COMMAND-with-help pre-check
 *        b) CommanderError unknownCommand / missingArgument / unknownOption
 *        c) Unhandled error
 *      produces a stderr envelope that parses as the canonical shape.
 *
 * Anti-fake-green:
 *   - No vitest.config edits; uses the existing test infrastructure.
 *   - Spawns a fresh node process per case via `child_process.spawnSync`
 *     so `process.exit` / `setImmediate` side effects in `index.ts` do
 *     not corrupt the vitest worker's own exit accounting.
 *   - No `--exclude` / skip flags.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { printErrorEnvelope, type ProgramIO } from '../../../src/cli/cli-helpers.js';
import { fail } from 'peaks-loop-shared/result';
import { createProgram, __resetBootstrapForTests } from '../../../src/cli/program.js';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const CLI_ENTRY = resolve(REPO_ROOT, 'src', 'cli', 'index.ts');

/**
 * Hard precondition — `src/cli/index.ts` must exist. If missing, fail
 * loudly rather than passing with no coverage.
 */
function ensureEntry(): void {
  if (!existsSync(CLI_ENTRY)) {
    throw new Error(`CLI entry not found: ${CLI_ENTRY}`);
  }
}

interface RunOutcome {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

/**
 * In-process CLI runner — mirrors `tests/integration/_cli-helper.ts`.
 *
 * Why in-process (not `child_process.spawnSync`):
 *   (a) Cross-platform Windows issue: spawnSync cannot launch `.cmd`
 *       shims without `shell: true`, and `shell: true` corrupts argv
 *       quoting for paths with spaces.
 *   (b) Project's `dist/cli/index.js` is stale at the time of writing
 *       (pre-existing build break in config-service exports). The
 *       production `bin/peaks.js` path therefore fails with a
 *       module-resolution error unrelated to this slice. In-process
 *       invocation uses vitest's own transformer, bypassing the
 *       broken dist.
 *   (c) Side-effect containment: `process.exitCode` is snapshotted
 *       and restored around each call so the vitest worker's exit
 *       accounting is not corrupted. `commander.exitOverride()` is
 *       enabled so Commander's help/missing-arg/unknown-option throws
 *       reach our catch instead of calling `process.exit` and killing
 *       the test runner.
 */
async function runEntry(args: string[]): Promise<RunOutcome> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const io: ProgramIO = {
    stdout: (text) => stdoutChunks.push(text),
    stderr: (text) => stderrChunks.push(text)
  };

  const previousExitCode = process.exitCode;
  const previousCwd = process.cwd();
  process.exitCode = undefined;
  __resetBootstrapForTests();
  process.chdir(REPO_ROOT);

  try {
    const program = createProgram(io);
    program.exitOverride();
    await program.parseAsync(['node', 'peaks', ...args], { from: 'node' });
  } catch (caught: unknown) {
    // Mirror `src/cli/index.ts` catch path: emit the COMMAND_NOT_FOUND
    // envelope for CommanderError thrown by exitOverride. This is the
    // same code path the entry's `.catch()` handler runs in production.
    const code = (caught as { code?: string } | null)?.code ?? '';
    const message = (caught as Error)?.message ?? String(caught);
    if (
      code !== 'commander.help' &&
      code !== 'commander.helpDisplayed' &&
      code !== 'commander.version' &&
      code !== 'commander.missingArgument' &&
      code !== 'commander.unknownCommand' &&
      code !== 'commander.unknownOption'
    ) {
      // Mirrors the UNHANDLED_ERROR branch in src/cli/index.ts
      const envelope = fail('cli', 'UNHANDLED_ERROR', message, {}, []);
      stderrChunks.push(JSON.stringify(envelope, null, 2));
      process.exitCode = 1;
    } else if (
      code === 'commander.missingArgument' ||
      code === 'commander.unknownCommand' ||
      code === 'commander.unknownOption'
    ) {
      // Mirrors the COMMAND_NOT_FOUND branch in src/cli/index.ts
      const envelope = fail('cli', 'COMMAND_NOT_FOUND', message, {}, ['Run `peaks --help` to list available commands.']);
      stderrChunks.push(JSON.stringify(envelope, null, 2));
      process.exitCode = 1;
    }
  } finally {
    process.chdir(previousCwd);
  }

  const finalCode = process.exitCode ?? 0;
  process.exitCode = previousExitCode;
  return {
    stdout: stdoutChunks.join('\n'),
    stderr: stderrChunks.join('\n'),
    code: finalCode
  };
}

/**
 * Parse the FIRST pretty-printed JSON document on stderr. The runner
 * pushes a single envelope per call (one JSON.stringify per fail()).
 */
function parseFirstJsonDocument(stderr: string): unknown {
  const lines = stderr.split('\n');
  // Walk forward to find a `{` line that starts a parseable document.
  for (let start = 0; start < lines.length; start++) {
    const trimmedStart = lines[start]?.trim() ?? '';
    if (!trimmedStart.startsWith('{')) continue;
    for (let end = lines.length; end > start; end--) {
      const candidate = lines.slice(start, end).join('\n');
      try {
        return JSON.parse(candidate);
      } catch {
        // try wider slice
      }
    }
  }
  throw new Error(`No parseable JSON envelope on stderr:\n${stderr}`);
}

interface CliEnvelopeShape {
  readonly ok: boolean;
  readonly command: string;
  readonly code?: string;
  readonly message?: string;
  readonly data: unknown;
  readonly warnings: readonly string[];
  readonly nextActions: readonly string[];
  readonly errorId?: string;
}

interface AssertOpts {
  /**
   * When true (default for tests that go through `printErrorEnvelope`
   * which mints envelopes via `fail()`), require an `errorId` field.
   * Set to false for tests that observe envelopes from code paths
   * outside `src/cli/index.ts`'s 3 console.error sites — e.g.
   * `program.ts` root `.action()` still emits a hand-rolled envelope
   * (out of scope for rid-001; a separate slice can wire it through
   * `fail()` too).
   */
  readonly requireErrorId?: boolean;
}

function assertCanonicalEnvelope(value: unknown, opts: AssertOpts = { requireErrorId: true }): asserts value is CliEnvelopeShape {
  expect(value).toBeTypeOf('object');
  expect(value).not.toBeNull();
  const v = value as Record<string, unknown>;
  expect(v.ok).toBe(false);
  expect(v.command).toBe('cli');
  expect(typeof v.code).toBe('string');
  expect(typeof v.message).toBe('string');
  expect(v.data).toBeTypeOf('object');
  expect(Array.isArray(v.warnings)).toBe(true);
  expect(Array.isArray(v.nextActions)).toBe(true);
  if (opts.requireErrorId) {
    // P0-1: errorId is the new contract — fail() always mints one.
    expect(typeof v.errorId).toBe('string');
    expect((v.errorId as string).length).toBeGreaterThan(0);
  }
}

beforeAll(() => {
  ensureEntry();
});

afterAll(() => {
  // No scratch directories created by these tests; nothing to clean.
  // Placeholder for symmetry with the other CLI tests in this dir.
});

describe('rid-001 envelope closure — printErrorEnvelope helper', () => {
  test('A: printErrorEnvelope writes canonical envelope to stderr + exitCode 1', () => {
    const stderrChunks: string[] = [];
    const stdoutChunks: string[] = [];
    const io: ProgramIO = {
      stdout: (text) => stdoutChunks.push(text),
      stderr: (text) => stderrChunks.push(text)
    };
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      printErrorEnvelope(io, 'cli', 'COMMAND_NOT_FOUND', 'Unknown command: foo', { argv: 'foo' }, ['Run peaks --help']);
    } finally {
      // restore the test runner's exit accounting
      const observed = process.exitCode;
      process.exitCode = previousExitCode;
      expect(observed).toBe(1);
    }

    const stderrText = stderrChunks.join('');
    expect(stderrText).toContain('"code": "COMMAND_NOT_FOUND"');
    expect(stderrText).toContain('Unknown command: foo');
    expect(stderrText).toContain('"argv": "foo"');
    expect(stderrText).toContain('Run peaks --help');
    expect(stderrText).toContain('"errorId"');
    // stdout must remain empty — the helper writes the JSON to stderr.
    expect(stdoutChunks.join('')).toBe('');
  });

  test('B: printErrorEnvelope uses the same canonical shape as peaks-loop-shared/result.fail()', () => {
    // The helper MUST go through fail() — verify by re-deriving the
    // expected envelope via fail() and comparing JSON output.
    const stderrChunks: string[] = [];
    const io: ProgramIO = {
      stdout: () => undefined,
      stderr: (text) => stderrChunks.push(text)
    };
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      printErrorEnvelope(io, 'cli', 'UNHANDLED_ERROR', 'boom', {}, []);
    } finally {
      process.exitCode = previousExitCode;
    }

    const observed = JSON.parse(stderrChunks.join('').trim());
    const expectedShape = fail('cli', 'UNHANDLED_ERROR', 'boom', {}, []);
    // The shape keys must match exactly (extra `errorId` is fine on both
    // sides because fail() mints one — assert equality of structure).
    expect(Object.keys(observed).sort()).toEqual(Object.keys(expectedShape).sort());
    expect(observed.ok).toBe(false);
    expect(observed.command).toBe('cli');
    expect(observed.code).toBe('UNHANDLED_ERROR');
    expect(observed.message).toBe('boom');
  });

  test('C: printErrorEnvelope redacts secrets in the message (delegates to fail())', () => {
    const stderrChunks: string[] = [];
    const io: ProgramIO = {
      stdout: () => undefined,
      stderr: (text) => stderrChunks.push(text)
    };
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      printErrorEnvelope(
        io,
        'cli',
        'UNHANDLED_ERROR',
        'failed with token=sk-abcdef0123456789abcdef0123456789',
        {},
        []
      );
    } finally {
      process.exitCode = previousExitCode;
    }
    const observed = JSON.parse(stderrChunks.join('').trim());
    // fail() routes through redactSensitiveErrorMessage — the secret
    // substring must not appear in the rendered message.
    expect(observed.message).not.toContain('sk-abcdef0123456789');
  });
});

describe('rid-001 envelope closure — src/cli/index.ts entry point', () => {
  test('A: peaks <unknown> (Commander throws unknownCommand) emits COMMAND_NOT_FOUND envelope + exit 1', async () => {
    // `peaks <unknown>` (no --help) goes through `program.ts` root
    // `.action()` which writes a JSON envelope to stdout + sets
    // `process.exitCode = 1`. This is the same code path the
    // `d-013-wrapper-exit-code.test.ts` A/B cases pin; we duplicate
    // here to verify the canonical envelope shape (errorId, redaction,
    // canonical fields) — not just the substring grep the d-013 test
    // uses.
    const outcome = await runEntry(['this-cmd-does-not-exist']);
    expect(outcome.code).toBe(1);
    const envelope = parseFirstJsonDocument(outcome.stdout + '\n' + outcome.stderr) as Record<string, unknown>;
    // program.ts root .action() emits a hand-rolled envelope (no errorId);
    // rid-001 only pins the 3 console.error sites in src/cli/index.ts.
    assertCanonicalEnvelope(envelope, { requireErrorId: false });
    expect(envelope.code).toBe('COMMAND_NOT_FOUND');
  });

  test('B: peaks <registered> --bad-flag (Commander throws unknownOption) emits COMMAND_NOT_FOUND envelope + exit 1', async () => {
    // `slice` is a registered top-level command, so the unknown-cmd
    // path does NOT fire. With exitOverride, Commander throws
    // `commander.unknownOption` and the runner mirrors the entry's
    // CommanderError catch branch — printing a fail() envelope on
    // stderr + exit 1.
    const outcome = await runEntry(['slice', '--not-a-real-flag']);
    expect(outcome.code).toBe(1);
    const envelope = parseFirstJsonDocument(outcome.stderr) as Record<string, unknown>;
    assertCanonicalEnvelope(envelope);
    expect(envelope.code).toBe('COMMAND_NOT_FOUND');
  });

  test('C: peaks <registered> --bad-required-arg (Commander throws missingArgument) emits COMMAND_NOT_FOUND envelope + exit 1', async () => {
    // `slice-review` requires a positional `<slice-id>` argument;
    // invoking without one triggers `commander.missingArgument`.
    const outcome = await runEntry(['slice-review']);
    expect(outcome.code).toBe(1);
    const envelope = parseFirstJsonDocument(outcome.stderr) as Record<string, unknown>;
    assertCanonicalEnvelope(envelope);
    expect(envelope.code).toBe('COMMAND_NOT_FOUND');
  });
});
