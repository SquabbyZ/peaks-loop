// tests/unit/cli/mut-test-file-not-found.test.ts
//
// The G3 regression guard for rid-t6a-mut-test-file-not-found: a
// `--test-files` path that does not exist must fail with the NAMED code
// `MUT_TEST_FILE_NOT_FOUND` on ALL THREE `peaks mut` subcommands, before any
// Stryker run, assertion scan or report write.
//
// WHAT THIS FILE GUARDS (and why each assertion exists)
//   - the code is named, and `asserts` never answers `UNHANDLED_ERROR`;
//   - the message names the path RELATIVE to the project root and never leaks
//     a machine absolute path;
//   - a near-miss candidate is offered when one exists, capped at 5 and
//     deterministically ordered — and NOT invented when none exists;
//   - two missing paths are BOTH named in one envelope;
//   - a DIRECTORY is rejected with its own named code;
//   - a PATTERN is never reported as a missing file (a working glob must not
//     become "file not found");
//   - the happy path is unchanged: a valid `--test-files` still runs the
//     pipeline and still writes a byte-stable `mut-report.json`.
//
// The fixture lives OUTSIDE the repository (mkdtempSync under os.tmpdir()):
// a temp directory nested inside the repo would be resolved up to the repo
// root config by vitest / vite / tsconfig.
//
// The Stryker invoker is INJECTED, so no @stryker-mutator/core process is
// spawned: the guard is about the CLI's validation and envelope, not about
// Stryker's own behaviour.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createMutCommands } from '~/src/cli/commands/mut-commands';
import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';
import type { StrykerInvoker, StrykerRawResult } from 'peaks-loop-mut';

declareDimensions('tests/unit/cli/mut-test-file-not-found.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const HEX_SIG = 'b'.repeat(64);
const SESSION_ID = '2026-10-24-session-5e40e0';
const SUBCOMMANDS = ['run', 'mutants', 'asserts'] as const;

interface Envelope {
  readonly ok: boolean;
  readonly command: string;
  readonly code: string;
  readonly message: string;
  readonly data: Record<string, unknown>;
}

function stubResult(): StrykerRawResult {
  return {
    mutantsTotal: 3,
    mutantsKilled: 3,
    mutantsSurvived: 0,
    mutantsTimeout: 0,
    perFile: [{ file: 'src/add.ts', killRate: 1, survived: [] }]
  };
}

describe('peaks mut — a missing --test-files path', () => {
  let project: string;
  let out: string;

  beforeEach(() => {
    process.exitCode = undefined;
    project = mkdtempSync(join(tmpdir(), 'peaks-mut-missing-'));
    mkdirSync(join(project, 'src'), { recursive: true });
    mkdirSync(join(project, 'tests'), { recursive: true });
    writeFileSync(
      join(project, 'src', 'add.ts'),
      ['export function add(a: number, b: number): number {', '  return a + b;', '}', ''].join('\n')
    );
    writeFileSync(
      join(project, 'tests', 'add.test.ts'),
      [
        "import { expect, it } from 'vitest';",
        '',
        "it('adds', () => {",
        '  expect(1).toBe(1);',
        '});',
        ''
      ].join('\n')
    );
    // Six more files in the same directory with the same extension: they are
    // the near-miss candidates, and there are more of them than the cap.
    for (let index = 1; index <= 6; index += 1) {
      writeFileSync(
        join(project, 'tests', `cand-${index}.test.ts`),
        [
          "import { expect, it } from 'vitest';",
          '',
          "it('cand', () => {",
          '  expect(1).toBe(1);',
          '});',
          ''
        ].join('\n')
      );
    }
    out = join(project, 'mut-report.json');
  });

  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  async function runMut(
    argv: string[],
    invokeStryker: StrykerInvoker
  ): Promise<{ stdout: string; stderr: string }> {
    const { io, captured } = makeCapturedIo();
    const program = new Command().addCommand(createMutCommands({ invokeStryker, io }));
    await program.parseAsync(['node', 'peaks', ...argv]);
    return { stdout: captured.text(), stderr: captured.stderrText() };
  }

  function argvFor(subcommand: string, testFiles: string[]): string[] {
    const argv = [
      'mut',
      subcommand,
      '--project',
      project,
      '--test-files',
      ...testFiles,
      '--input-sig',
      HEX_SIG,
      '--session-id',
      SESSION_ID,
      '--out',
      out
    ];
    if (subcommand !== 'asserts') {
      argv.push('--mutate', 'src/add.ts');
    }
    argv.push('--json');
    return argv;
  }

  function parseEnvelope(stderr: string): Envelope {
    return JSON.parse(stderr) as Envelope;
  }

  describe('(behavior) — the failure is named and happens before any work', () => {
    it('when `mut run` names a missing test file, should fail with MUT_TEST_FILE_NOT_FOUND', async () => {
      // given: a Stryker invoker that must never be reached
      // when: the subcommand is pointed at a test file that does not exist
      // then: the envelope carries the named code, and the invoker never ran
      const invokeStryker = vi.fn(async () => stubResult());
      const { stderr } = await runMut(
        argvFor('run', ['tests/does-not-exist.test.ts']),
        invokeStryker
      );
      const envelope = parseEnvelope(stderr);
      expect(envelope.ok).toBe(false);
      expect(envelope.code).toBe('MUT_TEST_FILE_NOT_FOUND');
      expect(envelope.code).not.toBe('MUT_FAILED');
      expect(envelope.code).not.toBe('UNHANDLED_ERROR');
      expect(stderr).not.toContain('UNHANDLED_ERROR');
      expect(process.exitCode).toBe(1);
      expect(invokeStryker).not.toHaveBeenCalled();
    });

    it('when `mut mutants` names a missing test file, should fail with MUT_TEST_FILE_NOT_FOUND', async () => {
      // given: a Stryker invoker that must never be reached
      // when: the subcommand is pointed at a test file that does not exist
      // then: the envelope carries the named code, and the invoker never ran
      const invokeStryker = vi.fn(async () => stubResult());
      const { stderr } = await runMut(
        argvFor('mutants', ['tests/does-not-exist.test.ts']),
        invokeStryker
      );
      const envelope = parseEnvelope(stderr);
      expect(envelope.ok).toBe(false);
      expect(envelope.code).toBe('MUT_TEST_FILE_NOT_FOUND');
      expect(envelope.code).not.toBe('MUT_FAILED');
      expect(envelope.code).not.toBe('UNHANDLED_ERROR');
      expect(stderr).not.toContain('UNHANDLED_ERROR');
      expect(process.exitCode).toBe(1);
      expect(invokeStryker).not.toHaveBeenCalled();
    });

    it('when `mut asserts` names a missing test file, should fail with MUT_TEST_FILE_NOT_FOUND', async () => {
      // given: a Stryker invoker that must never be reached
      // when: the subcommand is pointed at a test file that does not exist
      // then: the envelope carries the named code, and the invoker never ran
      const invokeStryker = vi.fn(async () => stubResult());
      const { stderr } = await runMut(
        argvFor('asserts', ['tests/does-not-exist.test.ts']),
        invokeStryker
      );
      const envelope = parseEnvelope(stderr);
      expect(envelope.ok).toBe(false);
      expect(envelope.code).toBe('MUT_TEST_FILE_NOT_FOUND');
      expect(envelope.code).not.toBe('MUT_FAILED');
      expect(envelope.code).not.toBe('UNHANDLED_ERROR');
      expect(stderr).not.toContain('UNHANDLED_ERROR');
      expect(process.exitCode).toBe(1);
      expect(invokeStryker).not.toHaveBeenCalled();
    });

    it('when the three subcommands are pointed at the same missing file, should answer identically', async () => {
      // given: three runs of the same missing path
      // when: each subcommand runs
      // then: one code, one exit code, one message shape
      const invokeStryker = vi.fn(async () => stubResult());
      const envelopes: Envelope[] = [];
      for (const subcommand of SUBCOMMANDS) {
        const { stderr } = await runMut(
          argvFor(subcommand, ['tests/does-not-exist.test.ts']),
          invokeStryker
        );
        envelopes.push(parseEnvelope(stderr));
      }
      expect(envelopes.map((e) => e.code)).toEqual([
        'MUT_TEST_FILE_NOT_FOUND',
        'MUT_TEST_FILE_NOT_FOUND',
        'MUT_TEST_FILE_NOT_FOUND'
      ]);
      expect(new Set(envelopes.map((e) => e.message)).size).toBe(1);
      expect(envelopes.every((e) => e.command === 'mut')).toBe(true);
    });

    it('when a test file path is a directory, should fail with a distinct named code', async () => {
      // given: a Stryker invoker that must never be reached
      // when: the subcommand is pointed at a directory
      // then: the code is neither "not found" nor the catch-all
      const invokeStryker = vi.fn(async () => stubResult());
      const { stderr } = await runMut(argvFor('asserts', ['tests']), invokeStryker);
      const envelope = parseEnvelope(stderr);
      expect(envelope.code).toBe('MUT_TEST_FILE_NOT_A_FILE');
      expect(envelope.code).not.toBe('MUT_TEST_FILE_NOT_FOUND');
      expect(envelope.code).not.toBe('UNHANDLED_ERROR');
      expect(invokeStryker).not.toHaveBeenCalled();
    });

    it('when a test file value is a pattern, should not report it as a missing file', async () => {
      // given: a Stryker invoker that records whether it was reached
      // when: the subcommand is pointed at a glob pattern
      // then: the pattern is passed through, never reported as "file not found"
      const invokeStryker = vi.fn(async () => stubResult());
      const { stdout, stderr } = await runMut(
        argvFor('mutants', ['tests/**/*.test.ts']),
        invokeStryker
      );
      expect(stderr).not.toContain('MUT_TEST_FILE_NOT_FOUND');
      expect(stderr).not.toContain('UNHANDLED_ERROR');
      expect(invokeStryker).toHaveBeenCalledTimes(1);
      expect((JSON.parse(stdout) as { ok: boolean }).ok).toBe(true);
    });

    it('when a test file value is a pattern and the scanner needs files, should use the pattern code', async () => {
      // given: a Stryker invoker that must never be reached
      // when: the assertion scan is pointed at a glob pattern
      // then: the outcome is named, and it is not "file not found"
      const invokeStryker = vi.fn(async () => stubResult());
      const { stderr } = await runMut(argvFor('asserts', ['tests/**/*.test.ts']), invokeStryker);
      const envelope = parseEnvelope(stderr);
      expect(envelope.code).toBe('MUT_TEST_FILE_PATTERN_UNSUPPORTED');
      expect(envelope.code).not.toBe('MUT_TEST_FILE_NOT_FOUND');
      expect(envelope.code).not.toBe('UNHANDLED_ERROR');
    });
  });

  describe('(render) — the --json envelope contract is unchanged', () => {
    it('when the failure envelope is printed, should keep stdout free of the envelope', async () => {
      // given: a Stryker invoker that must never be reached
      // when: the subcommand fails
      // then: stdout is empty and stderr carries exactly one JSON envelope
      const invokeStryker = vi.fn(async () => stubResult());
      const { stdout, stderr } = await runMut(
        argvFor('mutants', ['tests/does-not-exist.test.ts']),
        invokeStryker
      );
      expect(stdout).toBe('');
      const envelope = parseEnvelope(stderr);
      expect(envelope.ok).toBe(false);
      expect(envelope.command).toBe('mut');
      expect(typeof envelope.message).toBe('string');
    });

    it('when the failure envelope is printed, should carry the machine-readable detail', async () => {
      // given: a Stryker invoker that must never be reached
      // when: the subcommand fails
      // then: the detail names the project root, the missing path and the candidates
      const invokeStryker = vi.fn(async () => stubResult());
      const { stderr } = await runMut(
        argvFor('asserts', ['tests/does-not-exist.test.ts']),
        invokeStryker
      );
      const envelope = parseEnvelope(stderr);
      expect(envelope.data.project).toBe(project);
      expect(envelope.data.missing).toEqual(['tests/does-not-exist.test.ts']);
      expect(Array.isArray(envelope.data.candidates)).toBe(true);
    });
  });

  describe('(integration) — the validator reads the project on disk', () => {
    it('when the test file exists, should run the pipeline and write the report', async () => {
      // given: a Stryker invoker that returns a measurement
      // when: the subcommand is pointed at an existing test file
      // then: the pipeline ran, the payload is on stdout and the report is written
      const invokeStryker = vi.fn(async () => stubResult());
      const { stdout } = await runMut(argvFor('mutants', ['tests/add.test.ts']), invokeStryker);
      const payload = JSON.parse(stdout) as { ok: boolean; sha256: string; passed: boolean };
      expect(payload.ok).toBe(true);
      expect(payload.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(payload.passed).toBe(true);
      expect(invokeStryker).toHaveBeenCalledTimes(1);
      const written = JSON.parse(readFileSync(out, 'utf8')) as { sha256: string };
      expect(written.sha256).toBe(payload.sha256);
    });

    it('when the happy path runs twice, should write the same report sha256', async () => {
      // given: a Stryker invoker that returns a measurement
      // when: the same valid run is executed twice
      // then: the report digest is unchanged — the pipeline's output is byte-stable
      const invokeStryker = vi.fn(async () => stubResult());
      const first = JSON.parse(
        (await runMut(argvFor('mutants', ['tests/add.test.ts']), invokeStryker)).stdout
      ) as { sha256: string };
      const second = JSON.parse(
        (await runMut(argvFor('mutants', ['tests/add.test.ts']), invokeStryker)).stdout
      ) as { sha256: string };
      expect(second.sha256).toBe(first.sha256);
    });
  });

  describe('(a11y) — the message a human reads', () => {
    it('when a test file is missing, should name it relative to the project root', async () => {
      // given: a Stryker invoker that must never be reached
      // when: the subcommand is pointed at a missing test file
      // then: the message names the relative path and no machine absolute path
      const invokeStryker = vi.fn(async () => stubResult());
      const { stderr } = await runMut(
        argvFor('asserts', ['tests/does-not-exist.test.ts']),
        invokeStryker
      );
      const envelope = parseEnvelope(stderr);
      expect(envelope.message).toContain('tests/does-not-exist.test.ts');
      expect(envelope.message).not.toContain(project);
      expect(envelope.message).not.toContain('ENOENT');
    });

    it('when a near-miss exists, should list at most five candidates in a stable order', async () => {
      // given: a Stryker invoker that must never be reached
      // when: the subcommand is pointed at a missing test file
      // then: the candidates are listed, capped at five and deterministically ordered
      const invokeStryker = vi.fn(async () => stubResult());
      const { stderr } = await runMut(
        argvFor('asserts', ['tests/does-not-exist.test.ts']),
        invokeStryker
      );
      const envelope = parseEnvelope(stderr);
      const candidateLines = envelope.message
        .split('\n')
        .filter((line) => line.startsWith('- '))
        .map((line) => line.slice(2));
      expect(candidateLines.length).toBe(5);
      expect(candidateLines).toEqual([...candidateLines].sort());
      expect(candidateLines[0]).toBe('tests/add.test.ts');
      expect(candidateLines).not.toContain('tests/cand-6.test.ts');
    });

    it('when no near-miss exists, should not invent a candidate', async () => {
      // given: a Stryker invoker that must never be reached
      // when: the subcommand is pointed at a missing file with no plausible neighbour
      // then: the message names the file and offers nothing
      const invokeStryker = vi.fn(async () => stubResult());
      const { stderr } = await runMut(argvFor('asserts', ['tests/nothing-here.md']), invokeStryker);
      const envelope = parseEnvelope(stderr);
      expect(envelope.message).toContain('tests/nothing-here.md');
      expect(envelope.message).not.toContain('Near-miss candidates');
    });

    it('when two test files are missing, should name both in one envelope', async () => {
      // given: a Stryker invoker that must never be reached
      // when: the subcommand is pointed at two missing test files
      // then: both are named, in a deterministic order
      const invokeStryker = vi.fn(async () => stubResult());
      const { stderr } = await runMut(
        argvFor('asserts', ['tests/alpha-missing.test.ts', 'tests/beta-missing.test.ts']),
        invokeStryker
      );
      const envelope = parseEnvelope(stderr);
      expect(envelope.code).toBe('MUT_TEST_FILE_NOT_FOUND');
      expect(envelope.message).toContain('tests/alpha-missing.test.ts');
      expect(envelope.message).toContain('tests/beta-missing.test.ts');
      expect(envelope.message.indexOf('tests/alpha-missing.test.ts')).toBeLessThan(
        envelope.message.indexOf('tests/beta-missing.test.ts')
      );
    });
  });
});
