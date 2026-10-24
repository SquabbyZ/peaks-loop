/**
 * `peaks mut` CLI surface — flag parsing and the named-error contract.
 *
 * These tests drive `createMutCommands` with an INJECTED Stryker
 * invoker, so no @stryker-mutator/core process is spawned. That keeps
 * the unit suite fast while still exercising the real Commander wiring:
 * the options the CLI parses, the arguments it hands the invoker, and
 * the envelope it prints when the invoker fails.
 *
 * Covered:
 *   - `--mutate <patterns...>` reaches the invoker on `run` and `mutants`
 *   - an absent `--mutate` reaches the invoker as an empty list (the
 *     project config file, not the CLI, then decides the scope)
 *   - a named error code from the invoker surfaces in the stderr
 *     envelope (R7) with a non-zero exit code — never UNHANDLED_ERROR
 *   - the `--json` stdout is exactly ONE parseable JSON object (R6)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMutCommands } from '~/src/cli/commands/mut-commands';
import { makeCapturedIo } from '../../_setup/io.js';
import type { StrykerInvoker, StrykerRawResult } from 'peaks-loop-mut';

type InvokerInput = Parameters<StrykerInvoker>[0];

const HEX_SIG = 'b'.repeat(64);

function stubResult(): StrykerRawResult {
  return {
    mutantsTotal: 3,
    mutantsKilled: 3,
    mutantsSurvived: 0,
    mutantsTimeout: 0,
    perFile: [{ file: 'src/add.ts', killRate: 1, survived: [] }]
  };
}

describe('peaks mut CLI', () => {
  let project: string;
  let out: string;

  beforeEach(() => {
    process.exitCode = undefined;
    project = mkdtempSync(join(tmpdir(), 'peaks-mut-cli-'));
    mkdirSync(join(project, 'src'), { recursive: true });
    writeFileSync(
      join(project, 'src', 'add.test.ts'),
      ["import { expect } from 'vitest';", 'expect(1).toBe(1);', ''].join('\n')
    );
    out = join(project, 'mut-report.json');
  });

  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  async function runMut(
    argv: string[],
    invokeStryker: Parameters<typeof createMutCommands>[0]['invokeStryker']
  ): Promise<{ stdout: string; stderr: string }> {
    const { io, captured } = makeCapturedIo();
    const program = new Command().addCommand(createMutCommands({ invokeStryker, io }));
    await program.parseAsync(['node', 'peaks', ...argv]);
    return { stdout: captured.text(), stderr: captured.stderrText() };
  }

  it('when --mutate is passed to `mut run`, should forward it to the invoker', async () => {
    // given: a stub Stryker invoker that records its input
    // when: the CLI parses `mut run --mutate src/**/*.ts`
    // then: the invoker receives the project, the test files and the mutate patterns
    let captured: InvokerInput | undefined;
    const invokeStryker = vi.fn(async (opts: InvokerInput) => {
      captured = opts;
      return stubResult();
    });

    await runMut(
      [
        'mut',
        'run',
        '--project',
        project,
        '--test-files',
        'src/add.test.ts',
        '--mutate',
        'src/**/*.ts',
        '--input-sig',
        HEX_SIG,
        '--session-id',
        '2026-10-24-session-5e40e0',
        '--out',
        out,
        '--json'
      ],
      invokeStryker
    );

    expect(invokeStryker).toHaveBeenCalledTimes(1);
    expect(captured?.project).toBe(project);
    expect(captured?.mutate).toEqual(['src/**/*.ts']);
    expect(captured?.testFiles).toEqual(['src/add.test.ts']);
  });

  it('when --mutate is passed to `mut mutants`, should forward it to the invoker', async () => {
    // given: a stub Stryker invoker that records its input
    // when: the CLI parses `mut mutants --mutate src/a.ts src/b.ts`
    // then: the invoker receives both mutate patterns
    let captured: InvokerInput | undefined;
    const invokeStryker = vi.fn(async (opts: InvokerInput) => {
      captured = opts;
      return stubResult();
    });

    await runMut(
      [
        'mut',
        'mutants',
        '--project',
        project,
        '--test-files',
        'src/add.test.ts',
        '--mutate',
        'src/a.ts',
        'src/b.ts',
        '--input-sig',
        HEX_SIG,
        '--session-id',
        '2026-10-24-session-5e40e0',
        '--out',
        out,
        '--json'
      ],
      invokeStryker
    );

    expect(captured?.mutate).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('when --mutate is absent, should hand an empty mutate list to the invoker', async () => {
    // given: a stub Stryker invoker that records its input
    // when: the CLI parses `mut mutants` without --mutate
    // then: the invoker receives an empty mutate list
    let captured: InvokerInput | undefined;
    const invokeStryker = vi.fn(async (opts: InvokerInput) => {
      captured = opts;
      return stubResult();
    });

    await runMut(
      [
        'mut',
        'mutants',
        '--project',
        project,
        '--test-files',
        'src/add.test.ts',
        '--input-sig',
        HEX_SIG,
        '--session-id',
        '2026-10-24-session-5e40e0',
        '--out',
        out,
        '--json'
      ],
      invokeStryker
    );

    expect(captured?.mutate).toEqual([]);
  });

  it('when the toolchain fails, should print a NAMED error code and exit non-zero', async () => {
    // given: an invoker that throws a named MUT_* error
    // when: the CLI reports the failed run
    // then: the stderr envelope carries the named code and the exit code is 1
    const failure = Object.assign(new Error('Cannot find package @stryker-mutator/vitest-runner'), {
      code: 'MUT_TOOLCHAIN_UNAVAILABLE'
    });
    const invokeStryker = vi.fn(async () => {
      throw failure;
    });

    const { stdout, stderr } = await runMut(
      [
        'mut',
        'mutants',
        '--project',
        project,
        '--test-files',
        'src/add.test.ts',
        '--mutate',
        'src/**/*.ts',
        '--input-sig',
        HEX_SIG,
        '--session-id',
        '2026-10-24-session-5e40e0',
        '--out',
        out,
        '--json'
      ],
      invokeStryker
    );

    expect(stdout).toBe('');
    const envelope = JSON.parse(stderr) as { ok: boolean; code: string; message: string };
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('MUT_TOOLCHAIN_UNAVAILABLE');
    expect(envelope.message).toContain('Cannot find package');
    expect(process.exitCode).toBe(1);
  });

  it('when --json is passed, should print exactly one JSON object on stdout', async () => {
    // given: a stub Stryker invoker that succeeds
    // when: the CLI parses `mut mutants --json`
    // then: stdout carries exactly one parseable JSON object
    const invokeStryker = vi.fn(async () => stubResult());

    const { stdout } = await runMut(
      [
        'mut',
        'mutants',
        '--project',
        project,
        '--test-files',
        'src/add.test.ts',
        '--mutate',
        'src/**/*.ts',
        '--input-sig',
        HEX_SIG,
        '--session-id',
        '2026-10-24-session-5e40e0',
        '--out',
        out,
        '--json'
      ],
      invokeStryker
    );

    const lines = stdout.split('\n').filter((line) => line.trim().length > 0);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(stdout) as { ok: boolean; sha256: string; passed: boolean };
    expect(parsed.ok).toBe(true);
    expect(parsed.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
