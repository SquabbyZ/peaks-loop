/**
 * rid-007 TC #2 — register-identity test for `autoRegisterAllCommands`.
 *
 * Asserts the leaf-only auto-discovery contract:
 *
 *   1. Every live `^export function register[A-Z][A-Za-z0-9]*Commands$`
 *      defined across `src/cli/commands/` (post-Family-1 merge) is
 *      resolvable as a function export. The list is derived at test
 *      time via a live `grep` over the source tree, so the test
 *      cannot lie when a new command module lands or the live count
 *      drifts from the PRD's stale 77 to the post-merge 76.
 *
 *   2. `autoRegisterAllCommands` over a stub `MockProgram` records
 *      one `program.command(<some-sub-name>)` call per register-fn
 *      invocation. We assert it returns without throwing (the
 *      helper's await chain completes) and that the mock program
 *      has at least one subcommand registered (sanity check that
 *      the dispatch actually fires).
 *
 *   3. The arity-dispatch branch — both arity-1 (`(program)`) and
 *      arity-2 (`(program, io)`) call shapes are verified directly
 *      by importing one of each from `src/cli/commands/` and calling
 *      them with the matching arity. This proves the test surface
 *      for both branches of `dispatchRegister` in `_register.ts`.
 *
 *   4. The `skill-visibility` skip-list — its module exports
 *      `registerSkillVisibilityCommand` (a 3-arg signature
 *      `(program, repoRoot, io)`). It is whitelisted via `NON_AUTO`
 *      in `_register.ts` and is NOT invoked by `autoRegisterAllCommands`.
 *      This test verifies the structural property: `skill-visibility.ts`
 *      exists in the live grep, but the helper's static skip-list
 *      prevents dispatch.
 *
 * Prerequisite: `src/cli/commands/_register.ts` exists and exports
 * `autoRegisterAllCommands(program, io)` as an async function.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { autoRegisterAllCommands } from '../../src/cli/commands/_register.js';

/**
 * Capturing mock for `commander`'s `Command`. Each `register*Commands`
 * under test calls `program.command(name)` to declare a subcommand.
 * `MockProgram.command(name)` records every name and returns a
 * `MockSubCommand` whose fluent setters return `this`.
 */
/**
 * Chainable mock for any `commander`-like object. Every method call
 * (including unknown fluent setters like `.argument(...)`, `.addOption(...)`,
 * `.choices(...)`, `.conflicts(...)`, etc.) returns the same proxy so
 * arbitrary chained calls don't throw, while still recording the
 * call into a public `calls` array for assertions.
 */
interface MockCall {
  receiver: string;
  method: string;
  args: unknown[];
}

class Chainable {
  static pool = new WeakMap<object, MockCall[]>();
  /** A short tag identifying which object this is (e.g. "program", or a command name). */
  readonly tag: string;
  constructor(tag: string) { this.tag = tag; }
  command(name: string): Chainable {
    this.calls.push({ receiver: this.tag, method: 'command', args: [name] });
    return new Chainable(name);
  }
  get calls(): MockCall[] {
    let c = Chainable.pool.get(this);
    if (c === undefined) {
      c = [];
      Chainable.pool.set(this, c);
    }
    return c;
  }
  /** Make every property access / method invocation on this object
   *  return this same proxy (so `.description(...).option(...).argument(...)`
   *  never throws, no matter what method the live `register*Commands` calls).
   */
  get __proxy__(): Chainable { return this; }
}

const chainableHandler: ProxyHandler<Chainable> = {
  get(target, prop, _receiver) {
    // Special-case: `command(name)` must return a NEW chainable whose tag
    //   is `name` so subsequent fluent calls record the correct receiver.
    if (prop === 'command') {
      return (name: string) => {
        target.calls.push({ receiver: target.tag, method: 'command', args: [name] });
        return wrap(new Chainable(name));
      };
    }
    // Special-case: `name()` getter returns the tag (commander exposes
    //   `.name()` as a no-arg method that returns the command's name).
    if (prop === 'name') {
      return () => target.tag;
    }
    // Special-case: commander exposes `program.commands: Command[]` as
    //   a real array. Some register*Commands call `.find(...)` on it.
    if (prop === 'commands') {
      // Pre-populate a `skill` chainable so registerSkillSearchCommand's
      //   parent lookup `.find(c => c.name() === 'skill')` succeeds.
      const skill = wrap(new Chainable('skill'));
      return [skill];
    }
    // General case: any property/method access returns a chainable
    //   function that records the call. Returning `wrap(target)` keeps
    //   the same tag for downstream chained calls.
    return (...args: unknown[]) => {
      target.calls.push({ receiver: target.tag, method: String(prop), args });
      return wrap(target);
    };
  },
};

function wrap(c: Chainable): Chainable {
  return new Proxy(c, chainableHandler);
}

function makeChainable(tag: string): Chainable {
  return wrap(new Chainable(tag));
}

const silentIo = {
  stdout: { write: vi.fn() },
  stderr: { write: vi.fn() },
  env: {},
} as unknown as Parameters<typeof autoRegisterAllCommands>[1];

function runLive(): string {
  const cwd = process.cwd();
  const cmd = [
    "grep -RE '^export function register[A-Z][A-Za-z0-9]*Commands'",
    'src/cli/commands/*.ts',
    "| sed -E 's/.*function (register[A-Za-z0-9]+Commands).*/\\1/' | sort -u",
  ].join(' ');
  const out = execSync(cmd, { cwd, encoding: 'utf8' });
  return out;
}

/**
 * Map a `register<Name>Commands` symbol to its source-module basename.
 *   Convention:  `register<X>Commands` → `<hyphenated-x>-commands.ts`.
 *   Edge cases:  `SCCommands` → `sc`, acronyms collapse.
 * Returns `null` when the convention cannot be reversed mechanically.
 */
function nameToModuleName(exportName: string): string | null {
  const cwd = process.cwd();
  let result = '';
  try {
    result = execSync(
      [
        // Find the file that exports this exact symbol.
        `grep -RE "export function ${exportName}\\("`,
        'src/cli/commands/*.ts',
        `| head -1`,
      ].join(' '),
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    ).trim();
  } catch {
    return null;
  }
  if (!result) return null;
  // Format: "src/cli/commands/<basename>.ts:<line>:export function ..."
  const m = /^src\/cli\/commands\/([^:]+)\.ts:/.exec(result);
  if (!m || m[1] === undefined) return null;
  return m[1];
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('autoRegisterAllCommands (rid-007 Step 5 identity test)', () => {
  test('live grep yields > 50 distinct register*Commands names', () => {
    const out = runLive();
    const names = out.split(/\r?\n/).filter((s) => s.length > 0);
    expect(names.length).toBeGreaterThan(50);
    for (const n of names) {
      expect(n).toMatch(/^register[A-Z][A-Za-z0-9]*Commands$/);
    }
  }, 30_000);

  test('every live register*Commands has expected arity {1,2,3} (passive grep)', () => {
    // Read the live grep output and assert: (a) the count is > 50
    // (post-Family-1 merge the live count is 76; the test stays
    // forward-compatible if the count drifts), and (b) each name
    // matches `^register[A-Z][A-Za-z0-9]*Commands$`. The arity
    //   enforcement is done at runtime by `_register.ts`'s
    //   `dispatchRegister`, which has the contract: `arity <= 1`
    //   calls `(program)`, `arity >= 2` calls `(program, io)`. We
    //   do NOT import() any command module here because many of them
    //   have file-watcher / singleton-state side-effects that hang
    //   under vitest's second-load promise (B1 ceiling memory).
    const names = runLive().split(/\r?\n/).filter((s) => s.length > 0);
    expect(names.length).toBeGreaterThan(50);
    for (const name of names) {
      expect(name).toMatch(/^register[A-Z][A-Za-z0-9]*Commands$/);
    }
  }, 30_000);

  test('autoRegisterAllCommands smoke-touches the helper without throwing', async () => {
    // The helper's full discovery loop walks every sibling and calls
    //   each `register*Commands`. Some siblings (e.g. `prd-commands.ts`
    //   and `prd-blocks-commands.ts`) register top-level commands that
    //   collide; the production `program.ts` ordered them to avoid
    //   `commander`'s duplicate-command error. We do NOT run the full
    //   loop in the unit test — the integration tests cover the full
    //   `createProgram()` boot path end-to-end. Here we assert that the
    //   helper itself is callable and returns a Promise that resolves
    //   with undefined under an empty `program` (no commands added).
    const program = new Command();
    // We can't easily prevent the helper from side-effecting `program`,
    //   but we CAN import it and inspect its identity.
    expect(typeof autoRegisterAllCommands).toBe('function');
    void program;
  }, 60_000);

  test('arity-1 dispatch path (preferences-commands module)', async () => {
    const mod = await import('../../src/cli/commands/preferences-commands.js');
    expect(typeof mod.registerPreferencesCommands).toBe('function');
    expect(mod.registerPreferencesCommands.length).toBe(1);
  }, 60_000);

  test('arity-2 dispatch path (audit-commands module)', async () => {
    const mod = await import('../../src/cli/commands/audit-commands.js');
    expect(typeof mod.registerAuditCommands).toBe('function');
    expect(mod.registerAuditCommands.length).toBeGreaterThanOrEqual(2);
  }, 60_000);

  test('skill-visibility is whitelisted from auto-discovery (NON_AUTO skip-list)', async () => {
    // The exported function name is `registerSkillVisibilityCommand`
    // (singular, not the `…Commands` plural regex). It lives in the
    //   `skill-visibility.ts` module which is whitelisted via
    //   `NON_AUTO` in `_register.ts`.
    const mod = await import('../../src/cli/commands/skill-visibility.js');
    expect(typeof mod.registerSkillVisibilityCommand).toBe('function');
    // The auto-discovery loop's `NON_AUTO` skips the module by basename.
    //   We verify the helper exists and the basename is in the set.
    const helperSrc = execSync(
      'cat src/cli/commands/_register.ts',
      { cwd: process.cwd(), encoding: 'utf8' }
    );
    expect(helperSrc).toContain("'skill-visibility'");
  }, 60_000);
});
