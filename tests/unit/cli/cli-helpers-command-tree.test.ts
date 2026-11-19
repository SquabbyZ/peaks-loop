// tests/unit/cli/cli-helpers-command-tree.test.ts
//
// rid-mut-baseline-80 — the COMMAND-TREE half of `src/cli/cli-helpers.ts`.
//
// Split out of `cli-helpers-pure.test.ts` when that file crossed the repo's
// 500-line cap (the ratchet refuses GROWTH past a cap; it does not care that the
// file is otherwise healthy). The split is by SUBJECT: the sibling covers the
// printing and validation helpers, this one covers the helpers that walk a
// Commander tree and the legacy two-field envelope writer.
//
// Same sandbox constraint as its sibling: no tmp dir and no cwd, because
// Stryker's vitest-runner pins `pool: 'threads'` and a chdir-based test cannot
// be a mutation target.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Command } from 'commander';

import {
  printCliEnvelope,
  printMissingRequiredOptionEnvelope,
  resolveInvokedCommandPath,
  type ProgramIO
} from '../../../src/cli/cli-helpers.js';
import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions('tests/unit/cli/cli-helpers-command-tree.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

function makeIo(): { io: ProgramIO; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: (text: string) => {
        out.push(text);
      },
      stderr: (text: string) => {
        err.push(text);
      }
    },
    out,
    err
  };
}

let savedExitCode: number | string | null | undefined;
beforeEach(() => {
  savedExitCode = process.exitCode;
});
afterEach(() => {
  process.exitCode = savedExitCode;
});

describe('Scenario: (render) — the invoked path is derived from the command tree', () => {
  /** A tiny tree: `peaks repo scan|status` and an aliased `st`. */
  function tree(): Command {
    const program = new Command('peaks');
    const repo = program.command('repo');
    repo.command('scan');
    repo.command('status').alias('st');
    program.command('version');
    return program;
  }

  it('when the argv names nested commands, should join their names in order', () => {
    // given: a two-level invocation
    // when: the path is resolved
    // then: it is the dotted-free space-joined path
    expect(resolveInvokedCommandPath(tree(), ['repo', 'scan', '--json'])).toBe('repo scan');
  });

  it('when the argv stops at an option, should stop collecting there', () => {
    // given: options interleaved with the command names
    // when: the path is resolved
    // then: scanning stops at the first `-` token
    expect(resolveInvokedCommandPath(tree(), ['repo', '--json', 'scan'])).toBe('repo');
    expect(resolveInvokedCommandPath(tree(), ['--json', 'repo'])).toBe('peaks');
  });

  it('when the argv names an alias, should resolve it to the canonical name', () => {
    // given: `st` is an alias of `status`
    // when: the path is resolved
    // then: the CANONICAL name is reported — the record must match what got dispatched
    expect(resolveInvokedCommandPath(tree(), ['repo', 'st'])).toBe('repo status');
  });

  it('when the token matches only an ALIAS, should still resolve it', () => {
    // given: a command registered under one name with a second alias
    // when: the path is resolved
    // then: the alias branch of the find predicate is what answers — a mutation that drops the `c.aliases().includes(token)` disjunct leaves every other arm green, because they all match by NAME
    const program = new Command('peaks');
    program.command('alpha').alias('a1');
    expect(resolveInvokedCommandPath(program, ['a1'])).toBe('alpha');
    // and a token that is neither name nor alias stops the walk
    expect(resolveInvokedCommandPath(program, ['a2'])).toBe('peaks');
  });

  it('when nothing matches, should fall back to the program name', () => {
    // given: argv that names no registered command
    // when: the path is resolved
    // then: the program's own name is the answer, not an empty string
    expect(resolveInvokedCommandPath(tree(), ['nope'])).toBe('peaks');
    expect(resolveInvokedCommandPath(tree(), [])).toBe('peaks');
  });

  it('when a name is valid but the deeper one is not, should keep the valid prefix', () => {
    // given: `repo` exists, `repo nope` does not
    // when: the path is resolved
    // then: the resolvable prefix is reported rather than nothing
    expect(resolveInvokedCommandPath(tree(), ['repo', 'nope'])).toBe('repo');
  });
});

describe('Scenario: (render) — printCliEnvelope writes the legacy two-field shape', () => {
  it('when the envelope is ok, should print { ok: true, data } with null for absent data', () => {
    // given: a success with no data, and one with data
    // when: both are printed
    // then: the absent field becomes an explicit null, not an omitted key
    const a = makeIo();
    const b = makeIo();
    printCliEnvelope(a.io, { ok: true });
    printCliEnvelope(b.io, { ok: true, data: { x: 1 } });
    expect(JSON.parse(a.out[0] ?? '')).toEqual({ ok: true, data: null });
    expect(JSON.parse(b.out[0] ?? '')).toEqual({ ok: true, data: { x: 1 } });
  });

  it('when the envelope failed, should print the error and set a non-zero exit code', () => {
    // given: a failure carrying an error message
    // when: printed
    // then: the error reaches STDOUT (this legacy shape puts it there) and the exit code is set — the two facts a caller branches on
    const { io, out, err } = makeIo();
    printCliEnvelope(io, { ok: false, error: 'boom' });
    expect(JSON.parse(out[0] ?? '')).toEqual({ ok: false, error: 'boom' });
    expect(err).toEqual([]);
    expect(process.exitCode).toBe(1);
  });
});

describe('Scenario: (a11y) — a missing required option names the option it wants', () => {
  it('when the message names an option, should quote it and say it is required', () => {
    // given: Commander's own message text
    // when: the envelope is built
    // then: it goes to STDERR (it delegates to printErrorEnvelope), and the option is extracted verbatim into the message, the data AND the remediation — the caller must not parse the prose again
    const { io, err } = makeIo();
    printMissingRequiredOptionEnvelope(
      io,
      'mut run',
      "error: required option '--test-files <files...>' not specified"
    );
    const parsed = JSON.parse(err[0] ?? '') as {
      code: string;
      message: string;
      data: { option: string };
      nextActions: string[];
    };
    // The CODE is pinned: it is the machine-readable half every caller filters
    // on, and the mutation report showed it surviving as an empty substitution
    // while the prose assertions below stayed green.
    expect(parsed.code).toBe('MISSING_REQUIRED_OPTION');
    expect(parsed.data.option).toBe('--test-files <files...>');
    // The message and BOTH remediations are pinned in full — `toContain` cannot
    // see a substitution that keeps the substring intact.
    expect(parsed.message).toBe(
      "Missing required option '--test-files <files...>' for `peaks mut run`."
    );
    expect(parsed.nextActions).toEqual([
      'Supply --test-files <files...> — it is required, so the command has no default for it.',
      "Run `peaks mut run --help` for the option's accepted values and its siblings."
    ]);
  });

  it('when the message names no option, should fall back to the message and a help hint', () => {
    // given: a message with no `required option '...'` clause
    // when: the envelope is built
    // then: the raw message survives and the data field is an explicit null
    const { io, err } = makeIo();
    printMissingRequiredOptionEnvelope(io, 'x', 'something else went wrong');
    const parsed = JSON.parse(err[0] ?? '') as {
      code: string;
      message: string;
      data: { option: null };
      nextActions: string[];
    };
    expect(parsed.code).toBe('MISSING_REQUIRED_OPTION');
    expect(parsed.message).toBe('something else went wrong');
    expect(parsed.data.option).toBeNull();
    expect(parsed.nextActions).toEqual([
      'Run `peaks x --help` to see the options this command requires.',
      "Run `peaks x --help` for the option's accepted values and its siblings."
    ]);
  });
});
