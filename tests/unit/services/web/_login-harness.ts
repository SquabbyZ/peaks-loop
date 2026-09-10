// tests/unit/services/web/_login-harness.ts
//
// The per-test setup and CLI helpers for the `peaks web login` tests: a fresh
// tmp workspace per test with HOME/USERPROFILE pointed at it, the knob reset,
// and the `runWeb`/envelope helpers. Extracted from `web-login-profile.test.ts`
// when the S4 repair round pushed that file past the 800-line scan limit.
//
// Imported STATICALLY by the test file — never from inside a `vi.mock` factory.
// A factory must `await import('./_login-fake.js')` instead, because this module
// (transitively) imports the mocked `node:fs` and `playwright-loader.js`; a
// factory awaiting a module that needs that same mock is a deadlock.
//
// `vi.mock` itself is FILE-SCOPED and cannot live here, so each test file
// declares its own two calls and pulls only the factory BODIES from
// `_login-fake.js`.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { Command } from 'commander';
import { afterEach, beforeEach, vi } from 'vitest';

import { makeCapturedIo, type CapturedIo } from '../../_setup/io.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';

import { registerWebCommands } from '../../../../src/cli/commands/web-commands.js';
import { loginStorageStatePath, webProfileDir } from '../../../../src/services/web/web-login-profile.js';
import { pw, resetPw } from './_login-fake.js';

export { pw } from './_login-fake.js';

/** A fresh tmp workspace per test, with HOME and USERPROFILE pointed at it. */
const ws = withTmpWorkspacePerTest('peaks-web-login-');

const HOME_KEYS = ['HOME', 'USERPROFILE'] as const;
const savedHome = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of HOME_KEYS) {
    savedHome.set(key, process.env[key]);
    process.env[key] = ws().path;
  }
  resetPw();
});

afterEach(() => {
  for (const [key, value] of savedHome) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  savedHome.clear();
  process.exitCode = 0;
  vi.restoreAllMocks();
});

/** The path the runner should capture into. */
export function statePathFor(name: string): string {
  return loginStorageStatePath(name);
}

/** The cookies array of the artifact at the resolved path for `name`. */
export function readStateCookies(name: string): Array<{ value: string }> {
  const parsed = JSON.parse(readFileSync(statePathFor(name), 'utf8')) as {
    cookies: Array<{ value: string }>;
  };
  return parsed.cookies;
}

/**
 * Every staging file left in the profile directory. The staging NAME is per-run
 * (S4 R5), so a test that asserted one fixed filename would assert nothing; this
 * asks the directory instead, and is how the "no staging residue" contract is
 * checked on every path.
 */
export function stagingLeftovers(name: string): string[] {
  const dir = webProfileDir(name);
  return existsSync(dir) ? readdirSync(dir).filter((entry) => entry.endsWith('.staging')) : [];
}

export interface Envelope {
  readonly ok: boolean;
  readonly code?: string;
  readonly message?: string;
  readonly data: Record<string, unknown>;
  readonly warnings: readonly string[];
  readonly nextActions: readonly string[];
}

export async function runWeb(argv: readonly string[]): Promise<CapturedIo> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  program.exitOverride();
  registerWebCommands(program, io);
  await program.parseAsync(['web', ...argv], { from: 'user' });
  return captured;
}

export function asEnvelope(captured: { text: () => string }): Envelope {
  return JSON.parse(captured.text()) as Envelope;
}
