// tests/unit/cli/cli-helpers-pure.test.ts
//
// rid-mut-baseline-80 — a mutation-target test for `src/cli/cli-helpers.ts`.
//
// WHY A SECOND FILE FOR A MODULE THAT ALREADY HAS ONE. `cli-helpers.test.ts`
// calls `withTmpWorkspacePerTest()`, which does `process.chdir()`, and Stryker's
// vitest-runner pins `pool: 'threads'` (`vitest-test-runner.js`) where chdir
// throws. Measured 2026-11-19: that made 196 of this module's 199 mutants
// NoCoverage — the mutator literally could not run the only test that reaches
// them. This file exercises the same exports through a captured `ProgramIO` and
// nothing else: no tmp dir, no cwd, no filesystem.
//
// IT DOES NOT REPLACE `cli-helpers.test.ts`. That file's workspace is doing real
// work for the command-shaped helpers. This one covers the pure half, which is
// most of the module and gets zero kills today.
//
// WHY `process.exitCode` IS SAVED AND RESTORED. Two helpers (`printInvalidConfigLayer`,
// `failUnsupportedNonDryRun`) set it. Leaving it set would leak a non-zero exit
// code into the rest of the suite, which vitest would report as a failure in a
// test that has nothing to do with this module.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  failUnsupportedNonDryRun,
  isArtifactProvider,
  isArtifactRepoSegment,
  isArtifactSetupStep,
  isRecommendationWorkflow,
  multipleOption,
  parseConfigLayer,
  printErrorEnvelope,
  printInvalidConfigLayer,
  printResult,
  printSuperCommandCatalog,
  printableWarningText,
  addJsonOption,
  type ProgramIO
} from '../../../src/cli/cli-helpers.js';
import { Command } from 'commander';
import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions('tests/unit/cli/cli-helpers-pure.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

/** A recorder: every write is captured in order, with its stream. */
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

/**
 * `process.exitCode` is `string | number | null | undefined`. The null arm is
 * real — a process that never set a code reads as null on some Node lines —
 * so it is captured rather than widened away, and restored verbatim.
 */
let savedExitCode: number | string | null | undefined;
beforeEach(() => {
  savedExitCode = process.exitCode;
});
afterEach(() => {
  process.exitCode = savedExitCode;
});

describe('Scenario: (behavior) — non-printable characters are replaced, not dropped', () => {
  it('when the value contains a control code point, should replace it with a question mark', () => {
    // given: a string carrying a newline, a tab and a NUL
    // when: the printable projection runs
    // then: each becomes `?` — length is preserved so column alignment survives
    expect(printableWarningText('a\nb')).toBe('a?b');
    expect(printableWarningText('a\tb')).toBe('a?b');
    expect(printableWarningText('a\u0000b')).toBe('a?b');
  });

  it('when the value is already printable, should return it unchanged', () => {
    // given: ordinary text including non-ASCII
    // when: the printable projection runs
    // then: it is untouched — the guard is about control codes, not ASCII
    expect(printableWarningText('hello world')).toBe('hello world');
    expect(printableWarningText('中文 ok')).toBe('中文 ok');
    expect(printableWarningText('')).toBe('');
  });

  it('when the value carries a code point on either side of a boundary, should replace only the control ones', () => {
    // given: the three control ranges the guard names, each probed at BOTH ends and just outside. The mutation report showed the boundary comparisons (`<= LAST_C0`, `=== DEL`, `>= FIRST_C1`, `<= LAST_C1`) surviving, because the arms above only ever passed an interior control character — a boundary swap is invisible to them.
    // when: each is projected
    // then: boundaries are inclusive, neighbours are untouched C0: 0x00..0x1f inclusive
    expect(printableWarningText('\u0000')).toBe('?');
    expect(printableWarningText('\u001f')).toBe('?');
    expect(printableWarningText(' ')).toBe(' '); // first printable after C0
    // DEL: exactly 0x7f
    expect(printableWarningText('~')).toBe('~');
    expect(printableWarningText('\u007f')).toBe('?');
    // C1: 0x80..0x9f inclusive, both ends pinned
    expect(printableWarningText('\u0080')).toBe('?');
    expect(printableWarningText('\u009f')).toBe('?');
    expect(printableWarningText(' ')).toBe(' '); // first printable after C1
  });

  it('when the value mixes printable and control characters, should keep the printable run intact', () => {
    // given: a realistic warning with an embedded newline
    // when: the printable projection runs
    // then: only the control character changes
    expect(printableWarningText('line1\nline2')).toBe('line1?line2');
  });
});

describe('Scenario: (render) — printResult picks the stream and the shape from the envelope', () => {
  it('when asJson is true, should print the whole envelope as pretty JSON to stdout', () => {
    // given: a successful envelope
    // when: printed as JSON
    // then: stdout holds the FULL envelope (not just data), pretty-printed
    const { io, out, err } = makeIo();
    printResult(
      io,
      { ok: true, command: 'x', data: { a: 1 }, warnings: [], nextActions: [] },
      true
    );
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0] ?? '')).toMatchObject({ ok: true, command: 'x', data: { a: 1 } });
    expect(out[0]).toContain('\n');
    expect(err).toEqual([]);
  });

  it('when a successful envelope is printed as text, should print data plus warnings and next actions', () => {
    // given: an envelope carrying both a warning and a next action
    // when: printed as text
    // then: data and next actions go to stdout, warnings to stderr
    const { io, out, err } = makeIo();
    printResult(io, {
      ok: true,
      command: 'x',
      data: { a: 1 },
      warnings: ['careful'],
      nextActions: ['do it']
    });
    expect(JSON.parse(out[0] ?? '')).toEqual({ a: 1 });
    expect(out[1]).toBe('next: do it');
    expect(err).toEqual(['warning: careful']);
  });

  it('when a failed envelope is printed as text, should print code and message to stderr', () => {
    // given: a failure envelope whose `fail()` left warnings empty
    // when: printed as text
    // then: nothing reaches stdout for a failure, and the code precedes the message
    const { io, out, err } = makeIo();
    printResult(io, {
      ok: false,
      command: 'x',
      code: 'NOPE',
      message: 'it broke',
      data: {},
      warnings: [],
      nextActions: ['try again']
    });
    expect(out).toEqual([]);
    expect(err[0]).toBe('NOPE: it broke');
    expect(err[1]).toBe('- try again');
  });

  it('when a failed envelope carries warnings, should print them between message and actions', () => {
    // given: the shape `peaks web login` produces — a failure whose only news is a warning
    // when: printed as text
    // then: the warning reaches stderr, in order
    const { io, out, err } = makeIo();
    printResult(io, {
      ok: false,
      command: 'x',
      code: 'C',
      message: 'm',
      data: {},
      warnings: ['could not close the browser'],
      nextActions: ['a']
    });
    expect(out).toEqual([]);
    expect(err).toEqual(['C: m', 'warning: could not close the browser', '- a']);
  });
});

describe('Scenario: (integration) — the validation helpers answer only for their own domain', () => {
  it('when asked whether a value is a recommendation workflow, should accept only the three workflows', () => {
    // given: the recommendation-workflow union
    // when: asked about each member and about a near-miss
    // then: the three members answer true and nothing else does
    for (const workflow of ['code-refactor', 'product-refactor', 'frontend-design']) {
      expect(isRecommendationWorkflow(workflow)).toBe(true);
    }
    expect(isRecommendationWorkflow('code-refactor ')).toBe(false);
    expect(isRecommendationWorkflow('peaks-solo')).toBe(false);
    expect(isRecommendationWorkflow('')).toBe(false);
  });

  it('when asked whether a value is an artifact provider, should accept exactly the two hosts', () => {
    // given: the provider union
    // when: asked about each member and a non-member
    // then: github and gitlab only
    expect(isArtifactProvider('github')).toBe(true);
    expect(isArtifactProvider('gitlab')).toBe(true);
    expect(isArtifactProvider('bitbucket')).toBe(false);
    expect(isArtifactProvider('GITHUB')).toBe(false);
  });

  it('when asked whether a value is an artifact setup step, should accept exactly the four steps', () => {
    // given: the setup-step union
    // when: asked about each member and a non-member
    // then: detect / configure / validate / complete only
    for (const step of ['detect', 'configure', 'validate', 'complete']) {
      expect(isArtifactSetupStep(step)).toBe(true);
    }
    expect(isArtifactSetupStep('deploy')).toBe(false);
    expect(isArtifactSetupStep('')).toBe(false);
  });

  it('when asked whether a segment is repo-safe, should refuse traversal and trailing dots', () => {
    // given: the shapes a repo path segment can take
    // when: the segment predicate runs
    // then: it admits plain names and refuses the three escape shapes
    expect(isArtifactRepoSegment('peaks-loop')).toBe(true);
    expect(isArtifactRepoSegment('a.b_c-d')).toBe(true);
    expect(isArtifactRepoSegment('a..b')).toBe(false);
    expect(isArtifactRepoSegment('..')).toBe(false);
    expect(isArtifactRepoSegment('trailing.')).toBe(false);
    expect(isArtifactRepoSegment('.leading')).toBe(false);
    expect(isArtifactRepoSegment('')).toBe(false);
    // The START anchor and the ASCII class: a leading dash and a leading
    // non-ASCII letter both fail , which the survivors above
    // show was never probed — every arm passed a well-formed first character.
    expect(isArtifactRepoSegment('-abc')).toBe(false);
    expect(isArtifactRepoSegment('_abc')).toBe(false);
    expect(isArtifactRepoSegment('ñ')).toBe(false);
  });

  it('when parsing a config layer, should distinguish absent from invalid', () => {
    // given: the three inputs a flag parser can receive
    // when: the layer is parsed
    // then: undefined means "not given", null means "given but wrong"
    expect(parseConfigLayer(undefined)).toBeUndefined();
    expect(parseConfigLayer('user')).toBe('user');
    expect(parseConfigLayer('project')).toBe('project');
    expect(parseConfigLayer('global')).toBeNull();
    expect(parseConfigLayer('')).toBeNull();
  });

  it('when accumulating a repeatable option, should append and tolerate a missing previous value', () => {
    // given: commander passes `previous` as undefined on the first occurrence
    // when: the accumulator runs
    // then: the first value starts a fresh array and later ones append
    expect(multipleOption('a', [])).toEqual(['a']);
    expect(multipleOption('b', ['a'])).toEqual(['a', 'b']);
    expect(multipleOption('a', undefined as unknown as string[])).toEqual(['a']);
  });
});

describe('Scenario: (a11y) — the failure printers set a non-zero exit code and name the fix', () => {
  it('when the config layer is invalid, should print INVALID_CONFIG_LAYER with the accepted values', () => {
    // given: a bad layer value
    // when: the invalid-layer printer runs as text
    // then: the code names the problem, the message names the accepted values, and the exit code is set
    const { io, out, err } = makeIo();
    printInvalidConfigLayer(io, 'cmd', false);
    // Pinned exactly. In TEXT mode `printResult` writes `code: message` to
    // stderr, then one `- <action>` line per next action; `toContain` cannot see
    // a substitution that leaves the substring intact, and the mutation report
    // had the remediation string surviving as `""` on this line.
    expect(err).toEqual([
      'INVALID_CONFIG_LAYER: Config layer must be user or project',
      '- Use --layer user or --layer project'
    ]);
    expect(out).toEqual([]);
    expect(process.exitCode).toBe(1);
  });

  it('when the config layer is invalid and JSON was requested, should print the envelope instead', () => {
    // given: the same bad value with --json
    // when: the printer runs as JSON
    // then: the full envelope reaches stdout
    const { io, out } = makeIo();
    printInvalidConfigLayer(io, 'cmd', true);
    const parsed = JSON.parse(out[0] ?? '') as { code: string; ok: boolean };
    expect(parsed.code).toBe('INVALID_CONFIG_LAYER');
    expect(parsed.ok).toBe(false);
  });

  it('when a command is refused for not being dry-run capable, should name the code and the fix', () => {
    // given: a non-dry-run-capable command
    // when: the refusal printer runs as text
    // then: the refusal names the CODE on stderr and the remediation, and sets the exit code. It deliberately does NOT echo the command name — checked against the real contract rather than assumed.
    const { io, out, err } = makeIo();
    failUnsupportedNonDryRun(io, 'peaks things do', false);
    expect(err[0]).toContain('UNSUPPORTED_NON_DRY_RUN');
    expect(err[0]).toContain('Only dry-run planning is supported');
    expect(err[1]).toContain('--dry-run');
    expect(out).toEqual([]);
    expect(process.exitCode).toBe(1);
  });
});

describe('Scenario: (render) — printErrorEnvelope writes a JSON failure to stderr', () => {
  it('when printing an error envelope, should write the code, the data and the next actions to STDERR', () => {
    // given: a named error with machine-readable detail
    // when: the error printer runs
    // then: every field survives into the envelope — and it goes to STDERR, not stdout, because stdout is reserved for the `--json` payload
    const { io, out, err } = makeIo();
    printErrorEnvelope(io, 'cmd', 'SOME_CODE', 'it failed', { detail: 1 }, ['fix it']);
    expect(out).toEqual([]);
    const parsed = JSON.parse(err[0] ?? '') as Record<string, unknown>;
    expect(parsed).toMatchObject({
      ok: false,
      command: 'cmd',
      code: 'SOME_CODE',
      message: 'it failed',
      data: { detail: 1 },
      nextActions: ['fix it']
    });
    expect(process.exitCode).toBe(1);
  });
});

describe('Scenario: (render) — the catalog and the option helper are pure too', () => {
  it('when the super-command catalog is printed, should write every command on its own line', () => {
    // given: a captured io
    // when: the catalog printer runs
    // then: ONE stdout write, one line per command, and nothing on stderr
    const { io, out, err } = makeIo();
    printSuperCommandCatalog(io);
    expect(out).toHaveLength(1);
    expect(err).toEqual([]);
    const lines = (out[0] ?? '').split('\n');
    expect(lines[0]).toBe('Peaks super-command catalog');
    // Each of the nine commands is named, and the closing line tells the reader
    // what to do next rather than leaving the list bare.
    for (const command of ['make', 'learn', 'check', 'run', 'share', 'version', 'ask', 'status']) {
      expect(lines.some((line) => line.startsWith(`${command} —`))).toBe(true);
    }
    expect(lines.at(-1)).toContain('the LLM coordinates');
  });

  it('when the json option is added, should register --json and return the same command', () => {
    // given: a commander command with no --json yet
    // when: the option helper runs
    // then: the command gained --json and the helper is chainable
    const command = new Command('probe');
    const returned = addJsonOption(command);
    expect(returned).toBe(command);
    expect(command.options.some((option) => option.long === '--json')).toBe(true);
  });
});
