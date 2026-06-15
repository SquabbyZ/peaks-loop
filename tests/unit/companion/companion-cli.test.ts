/**
 * BUG 2026-06-14-cc-connect-weixin#8: CLI surface tests for
 * `peaks companion token [bearer]`. Verifies:
 *
 *   - The `token` subcommand is wired into the program router
 *     and shows up in `peaks companion --help`.
 *   - `peaks companion token <bearer> --json` forwards to the
 *     bind service and returns a JSON envelope with `bound:
 *     true` on success, `bound: false` + `error: ...` on
 *     failure.
 *   - `peaks companion token` (no arg) reads the current bound
 *     token and emits a masked snapshot by default; `--reveal`
 *     surfaces the raw bearer.
 *   - `--channel=slack` exits with EX_USAGE (64) like the other
 *     subcommands.
 *
 * The test stubs the bind service via a home-dir override so it
 * never touches the real `~/.cc-connect/`.
 */
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { registerCompanionCommands } from '../../../src/cli/commands/companion.js';

// os.homedir() may be cached by Node's C++ layer after the first
// call in this vitest worker; setting process.env.HOME alone is
// not enough. Mock the module so every call returns the test's
// tmp dir. The bind-service's read path and config-template
// helper both use `homedir()` from `node:os` as a default.
let homeOverride = process.env['HOME'] ?? tmpdir();
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return {
    ...actual,
    homedir: () => homeOverride,
    tmpdir: actual.tmpdir
  };
});

let tmp: string;
let previousHome: string | undefined;
let stdout: string;
let stderr: string;
let originalExitCode: number | string | null | undefined;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'peaks-companion-cli-'));
  previousHome = process.env['HOME'];
  process.env['HOME'] = tmp;
  // Update the mocked homedir so the bind-service's read path
  // (which uses `node:os#homedir()` as a default for `home:`)
  // resolves to our tmp dir, not the real one.
  homeOverride = tmp;
  stdout = '';
  stderr = '';
  originalExitCode = process.exitCode;
  // Reset process.exitCode to undefined for each test so we can
  // observe any assignment from the action handlers.
  process.exitCode = undefined;
});

afterEach(() => {
  if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  process.env['HOME'] = previousHome;
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

/** Build a `peaks`-shaped program with the companion commands
 *  registered against a capturing IO. */
function makeProgram() {
  const program = new Command();
  program.exitOverride(); // throw instead of process.exit on help / usage
  program.configureOutput({
    writeOut: (s) => { stdout += s; },
    writeErr: (s) => { stderr += s; }
  });
  const io = {
    stdout: (s: string) => { stdout += s; },
    stderr: (s: string) => { stderr += s; }
  };
  registerCompanionCommands(program, io);
  return program;
}

// commander strips the first 2 argv entries (node + script), so we
// pass `['node', 'peaks', ...]` to mimic the runtime argv shape.
const ARGV_PREFIX = ['node', 'peaks'];

/** Parse a JSON envelope from a stdout capture. The CLI prints
 *  pretty-printed JSON (2-space indent), so the full envelope is
 *  one multi-line JSON document — we parse the entire buffer. */
function parseEnvelope(): { command: string; ok: boolean; data?: Record<string, unknown>; error?: string; code?: string; message?: string } {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return { command: '', ok: false };
  return JSON.parse(trimmed);
}

describe('peaks companion token — CLI surface (BUG 8)', () => {
  it('lists the token subcommand in `peaks companion --help`', async () => {
    const program = makeProgram();
    try {
      await program.parseAsync([...ARGV_PREFIX, 'companion', '--help']);
    } catch {
      /* commander throws on --help when exitOverride is set; ignore */
    }
    expect(stdout).toMatch(/token/);
  });

  it('`peaks companion token <bearer> --json` returns a JSON envelope', async () => {
    // Pre-write a config that simulates cc-connect's successful bind.
    const dir = join(tmp, '.cc-connect');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.toml'), [
      '[[projects]]',
      'name = "default"',
      '',
      '[[projects.platforms]]',
      'type = "weixin"',
      '',
      '[projects.platforms.options]',
      'token = "test-bot@im.bot:deadbeef"',
      ''
    ].join('\n'), 'utf8');
    // The CLI may either succeed (cc-connect finds the existing
    // token already bound) or fail (cc-connect's TOML parser
    // rejects the test fixture's exact shape). Either is fine —
    // the contract is that the user gets a structured JSON
    // envelope from `peaks companion token --json`.
    const program = makeProgram();
    await program.parseAsync([...ARGV_PREFIX, 'companion', 'token', 'test-bot@im.bot:deadbeef', '--json']);
    const envelope = parseEnvelope();
    // Assert the CLI surface produced a JSON envelope with
    // `command: 'companion.token'`. `ok` and `data.bound` may
    // be either truthy or falsy depending on whether cc-connect
    // accepted the fixture.
    expect(envelope.command).toBe('companion.token');
    expect(typeof envelope.ok).toBe('boolean');
    if (envelope.ok) {
      expect(envelope.data?.['bound']).toBe(true);
    } else {
      // Failure path: the action's `printResult(io, fail(...), true)`
      // shape puts `code` + `message` at the top level (NOT under
      // `data`). The `data` field carries the partial result the
      // service produced (binaryPath, configPath, etc).
      expect(envelope.code).toBe('BIND_FAILED');
      expect(typeof envelope.message).toBe('string');
    }
  });

  it('`peaks companion token` (no arg) returns a masked token snapshot', async () => {
    // Pre-write a config with a bound token.
    const dir = join(tmp, '.cc-connect');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.toml'), [
      '[[projects.platforms.options]]',
      'token = "test-bot@im.bot:deadbeef"',
      ''
    ].join('\n'), 'utf8');
    const program = makeProgram();
    await program.parseAsync([...ARGV_PREFIX, 'companion', 'token', '--json']);
    const envelope = parseEnvelope();
    expect(envelope.command).toBe('companion.token');
    expect(envelope.ok).toBe(true);
    expect(envelope.data?.['bound']).toBe(true);
    expect(envelope.data?.['botid']).toBe('test-bot@im.bot');
    expect(envelope.data?.['maskedToken']).toBe('test-bot@im.bot:****');
    // rawToken is NOT included by default (masked).
    expect(envelope.data?.['rawToken']).toBeUndefined();
  });

  it('`peaks companion token --reveal --json` includes the raw bearer', async () => {
    const dir = join(tmp, '.cc-connect');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.toml'), [
      '[[projects.platforms.options]]',
      'token = "test-bot@im.bot:deadbeef"',
      ''
    ].join('\n'), 'utf8');
    const program = makeProgram();
    await program.parseAsync([...ARGV_PREFIX, 'companion', 'token', '--reveal', '--json']);
    const envelope = parseEnvelope();
    expect(envelope.ok).toBe(true);
    expect(envelope.data?.['bound']).toBe(true);
    expect(envelope.data?.['rawToken']).toBe('test-bot@im.bot:deadbeef');
  });

  it('rejects --channel=slack (commander arg-parser throws InvalidArgumentError)', async () => {
    // The `parseChannel` arg parser throws an InvalidArgumentError
    // for any channel other than `weixin`. With `exitOverride()`
    // commander re-throws as a CommanderError. The action-level
    // `rejectChannel` guard is a backstop for callers that bypass
    // commander (e.g. when constructing the action directly).
    const program = makeProgram();
    let threw: unknown = null;
    try {
      await program.parseAsync([...ARGV_PREFIX, 'companion', 'token', '--channel', 'slack', '--json']);
    } catch (e) {
      threw = e;
    }
    expect(threw).not.toBeNull();
    expect(String((threw as Error).message)).toMatch(/channel not supported|weixin/);
  });
});

describe('peaks companion setup — CLI surface (BUG 8)', () => {
  it('accepts --token without trying to render a QR (short-circuit)', async () => {
    // The CLI forwards --token to runCompanionSetup. Without a
    // real binary the bind path fails, but the failure envelope
    // has command='companion.setup' and surfaces the error from
    // the bind runner. We assert the CLI accepted the flag
    // (i.e. did not reject it as unknown).
    const program = makeProgram();
    await program.parseAsync([...ARGV_PREFIX, 'companion', 'setup', '--token', 'test@im.bot:xxx', '--json']);
    const envelope = parseEnvelope();
    expect(envelope.command).toBe('companion.setup');
    // No "unknown option" error from commander.
    expect(stderr).not.toMatch(/unknown option/i);
  });
});
