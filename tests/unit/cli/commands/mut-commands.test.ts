/**
 * Plan 2 / Task 6 — `peaks mut` CLI commands.
 *
 * Verifies the four subcommands wired in `mut-commands.ts`:
 *   - `mut run`      — full pipeline (Stryker + assertions + report)
 *   - `mut mutants`  — Stryker-only path
 *   - `mut asserts`  — assertion-scan-only path
 *   - `mut report`   — re-reads a previously-written mut-report.json
 *
 * One-axis invariant (Plan 1 followup hotfix, commit 81f00ce): every
 * artifact-producing subcommand requires `--session-id` and the
 * `--change-id` flag must NEVER appear on the parser.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { createMutCommands } from '../../../../src/cli/commands/mut-commands.js';

let workdir: string;
let outdir: string;

const HEX_SIG = 'a'.repeat(64);

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'peaks-mut-cli-'));
  outdir = mkdtempSync(join(tmpdir(), 'peaks-mut-cli-out-'));
  mkdirSync(join(workdir, 'src'), { recursive: true });
  writeFileSync(join(workdir, 'src', 'A.ts'), 'export const add = (a: number, b: number) => a + b;\n');
  writeFileSync(
    join(workdir, 'src', 'A.test.ts'),
    [
      "import { add } from './A';",
      "test('adds', () => {",
      '  expect(add(1, 2)).toBeDefined();',
      '  expect(add(1, 2)).toBe(3);',
      '});',
      ''
    ].join('\n')
  );
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
  rmSync(outdir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('peaks mut commands', () => {
  it('run produces mut-report.json via CLI (using injected Stryker + scanner)', async () => {
    const invokeStryker = vi.fn(async () => ({
      mutantsTotal: 5,
      mutantsKilled: 4,
      mutantsSurvived: 1,
      mutantsTimeout: 0,
      perFile: [
        {
          file: 'src/A.ts',
          killRate: 0.8,
          survived: [{ line: 1, mutation: '+ -> -', survivedBecause: 'shouldX' }],
        },
      ],
    }));
    const program = new Command().addCommand(createMutCommands({ invokeStryker }));
    const out = join(outdir, 'mut.json');
    await program.parseAsync([
      'node', 'peaks', 'mut', 'run',
      '--project', workdir,
      '--test-files', 'src/A.test.ts',
      '--input-sig', HEX_SIG,
      '--session-id', '2026-06-22-mut-run',
      '--out', out,
    ]);
    expect(existsSync(out)).toBe(true);
    expect(invokeStryker).toHaveBeenCalledTimes(1);
    const json = JSON.parse(readFileSync(out, 'utf8'));
    expect(json.version).toBe('1.0');
    expect(json.mutation.tool).toBe('stryker');
    expect(json.mutation.mutantsKilled).toBe(4);
    // The toBeDefined() pattern is a known weak assertion; scanner must
    // surface it under weakPatterns.
    expect(json.assertions.weakPatterns.length).toBeGreaterThan(0);
    expect(json.thresholds.passed).toBeDefined();
    // sha256 must be a 64-hex string (one-axis chain to TACT.sig).
    expect(json.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(json.inputSig).toBe(HEX_SIG);
  });

  it('asserts runs only assertion scan and skips Stryker', async () => {
    const invokeStryker = vi.fn(async () => {
      throw new Error('should not be called');
    });
    const program = new Command().addCommand(createMutCommands({ invokeStryker }));
    const out = join(outdir, 'mut.json');
    await program.parseAsync([
      'node', 'peaks', 'mut', 'asserts',
      '--project', workdir,
      '--test-files', 'src/A.test.ts',
      '--input-sig', HEX_SIG,
      '--session-id', '2026-06-22-mut-asserts',
      '--out', out,
    ]);
    expect(existsSync(out)).toBe(true);
    expect(invokeStryker).not.toHaveBeenCalled();
    const json = JSON.parse(readFileSync(out, 'utf8'));
    expect(json.mutation.tool).toBe('stryker');
    expect(json.mutation.mutantsTotal).toBe(0);
    expect(json.mutation.killRate).toBe(0);
    // Asserts-only path still records the weak assertion patterns.
    expect(json.assertions.weakPatterns.length).toBeGreaterThan(0);
  });

  it('mutants runs only Stryker and produces a stub assertions block', async () => {
    const invokeStryker = vi.fn(async () => ({
      mutantsTotal: 3,
      mutantsKilled: 2,
      mutantsSurvived: 1,
      mutantsTimeout: 0,
      perFile: [
        { file: 'src/A.ts', killRate: 0.66, survived: [] },
      ],
    }));
    const program = new Command().addCommand(createMutCommands({ invokeStryker }));
    const out = join(outdir, 'mutants.json');
    await program.parseAsync([
      'node', 'peaks', 'mut', 'mutants',
      '--project', workdir,
      '--test-files', 'src/A.test.ts',
      '--input-sig', HEX_SIG,
      '--session-id', '2026-06-22-mut-mutants',
      '--out', out,
    ]);
    expect(existsSync(out)).toBe(true);
    expect(invokeStryker).toHaveBeenCalledTimes(1);
    const json = JSON.parse(readFileSync(out, 'utf8'));
    expect(json.mutation.mutantsTotal).toBe(3);
    // Mutants-only path leaves the assertion block empty (no scan).
    expect(json.assertions.totalAssertions).toBe(0);
    expect(json.assertions.weakAssertions).toBe(0);
  });

  it('report re-reads a previously-written mut-report.json', async () => {
    const invokeStryker = vi.fn(async () => ({
      mutantsTotal: 1,
      mutantsKilled: 1,
      mutantsSurvived: 0,
      mutantsTimeout: 0,
      perFile: [],
    }));
    // First, write a report with `run`.
    const writeProgram = new Command().addCommand(createMutCommands({ invokeStryker }));
    const out = join(outdir, 'roundtrip.json');
    await writeProgram.parseAsync([
      'node', 'peaks', 'mut', 'run',
      '--project', workdir,
      '--test-files', 'src/A.test.ts',
      '--input-sig', HEX_SIG,
      '--session-id', '2026-06-22-mut-report',
      '--out', out,
    ]);
    expect(existsSync(out)).toBe(true);

    // Then read it back with `report`.
    const reportProgram = new Command().addCommand(createMutCommands({ invokeStryker }));
    await expect(
      reportProgram.parseAsync([
        'node', 'peaks', 'mut', 'report',
        '--in', out,
        '--session-id', '2026-06-22-mut-report-read',
      ])
    ).resolves.toBeDefined();
    // Stryker must NOT have been invoked again — `report` reads the
    // cached JSON only.
    expect(invokeStryker).toHaveBeenCalledTimes(1);
  });

  it('refuses to run a mut-* subcommand without --session-id (one-axis invariant)', async () => {
    const invokeStryker = vi.fn(async () => {
      throw new Error('should not be called');
    });
    const program = new Command().addCommand(createMutCommands({ invokeStryker }));
    const out = join(outdir, 'no-sid.json');
    const exitCode = await new Promise<number>((resolve) => {
      program
        .exitOverride()
        .parseAsync([
          'node', 'peaks', 'mut', 'run',
          '--project', workdir,
          '--test-files', 'src/A.test.ts',
          '--input-sig', HEX_SIG,
          '--out', out,
        ])
        .then(() => resolve(0))
        .catch((err: unknown) => {
          const code = (err as { code?: string }).code;
          resolve(typeof code === 'string' && /^\d+$/.test(code) ? Number(code) : 1);
        });
    });
    // Commander exits with code 1 (missing required option).
    expect(exitCode).toBe(1);
    // The report MUST NOT have been written.
    expect(existsSync(out)).toBe(false);
    expect(invokeStryker).not.toHaveBeenCalled();
  });

  it('does not expose the legacy --change-id flag (one-axis invariant)', async () => {
    const invokeStryker = vi.fn(async () => ({
      mutantsTotal: 1,
      mutantsKilled: 1,
      mutantsSurvived: 0,
      mutantsTimeout: 0,
      perFile: [],
    }));
    const program = new Command().addCommand(createMutCommands({ invokeStryker }));
    const exitCode = await new Promise<number>((resolve) => {
      program
        .exitOverride()
        .parseAsync([
          'node', 'peaks', 'mut', 'run',
          '--project', workdir,
          '--test-files', 'src/A.test.ts',
          '--input-sig', HEX_SIG,
          '--session-id', '2026-06-22-mut-no-change-id',
          '--change-id', 'should-be-rejected',
          '--out', join(outdir, 'no-change-id.json'),
        ])
        .then(() => resolve(0))
        .catch((err: unknown) => {
          const code = (err as { code?: string }).code;
          resolve(typeof code === 'string' && /^\d+$/.test(code) ? Number(code) : 1);
        });
    });
    // Commander rejects unknown options with exit 1.
    expect(exitCode).toBe(1);
    expect(invokeStryker).not.toHaveBeenCalled();
  });
});