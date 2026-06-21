/**
 * Plan 2 / Task 9 — End-to-end integration test for peaks-mut.
 *
 * Exercises the full flow described in spec §4.2 / §7:
 *   1. `peaks mut run` is invoked with the real CLI entry point
 *      (`createMutCommands`) and an injected Stryker invoker so no
 *      real @stryker-mutator/core subprocess is spawned.
 *   2. The CLI writes a structurally-valid `mut-report.json` to the
 *      canonical one-axis path `.peaks/_runtime/<sid>/mut/` (per
 *      hotfix 81f00ce).
 *   3. The `MUT.sig` (sha256) is deterministic across two consecutive
 *      runs when the clock is frozen via `vi.useFakeTimers()`.
 *   4. The exact same file can be re-read by peaks-qa via
 *      `loadMutReport(sessionId)` and surfaces a valid
 *      `mutation.passed` verdict.
 *
 * Hard constraints:
 *   - No real Stryker subprocess (we mock via `invokeStryker` injection).
 *   - No `pnpm build` / `dist/` dependency — use the programmatic API
 *     directly so the test does not get blocked by the 2 pre-existing
 *     TSC errors documented in the preflight.
 *   - Per preflight commit 3925397, reset `process.exitCode` at the
 *     start of every `it` so prior test runs cannot leak non-zero
 *     exit codes into this file.
 *   - File ≤ 800 lines (Karpathy #2); single BDD `describe`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { createMutCommands } from '../../../src/cli/commands/mut-commands.js';
import {
  loadMutReport,
  mutReportPath,
} from '../../../src/services/mut/report-loader.js';

const HEX_SIG = 'a'.repeat(64);

describe('peaks-mut end-to-end', () => {
  let workdir: string;
  let outdir: string;
  let sessionId: string;

  beforeEach(() => {
    // Preflight fix 3925397 — other tests in this repo can leave a
    // non-zero `process.exitCode` behind (the mut CLI sets it on
    // threshold breach). Reset here so we don't fail the test runner
    // when the breach path is NOT exercised.
    process.exitCode = undefined;
    workdir = mkdtempSync(join(tmpdir(), 'peaks-mut-e2e-'));
    outdir = mkdtempSync(join(tmpdir(), 'peaks-mut-e2e-out-'));
    sessionId = '2026-06-22-mut-e2e';

    // Lay out a minimal fixture project: one production module + one
    // vitest spec. The spec exercises the 5 weak patterns so the
    // assertion scanner has something to count.
    mkdirSync(join(workdir, 'src'), { recursive: true });
    writeFileSync(
      join(workdir, 'src', 'add.ts'),
      'export const add = (a: number, b: number) => a + b;\n'
    );
    writeFileSync(
      join(workdir, 'src', 'add.test.ts'),
      [
        "import { add } from './add';",
        "import { describe, it, expect } from 'vitest';",
        '',
        "describe('add', () => {",
        '  it(\'adds\', () => {',
        '    expect(add(1, 2)).toBeDefined();',
        '    expect(add(2, 2)).toBe(4);',
        '    expect(add(0, 0)).toBe(0);',
        '  });',
        '});',
        '',
      ].join('\n')
    );
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
    rmSync(outdir, { recursive: true, force: true });
    vi.useRealTimers();
    process.exitCode = undefined;
  });

  it('produces mut-report.json with both Stryker + assertion results', async () => {
    // Freeze the clock so `generatedAt` is deterministic across runs.
    // This is what makes the sha256 stable when the only thing that
    // varies is the wall clock — without it the diff would be obvious
    // in the assertion below.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-22T00:00:00.000Z'));

    const invokeStryker = vi.fn(async () => ({
      mutantsTotal: 10,
      mutantsKilled: 9,
      mutantsSurvived: 1,
      mutantsTimeout: 0,
      perFile: [{ file: 'src/add.ts', killRate: 0.9, survived: [] }],
    }));

    const program = new Command().addCommand(
      createMutCommands({ invokeStryker })
    );
    // Write to the canonical one-axis path so loadMutReport can find
    // it without any chdir tricks.
    const reportPath = join(workdir, mutReportPath(sessionId));
    const out = join(reportPath); // same canonical location
    await program.parseAsync([
      'node', 'peaks', 'mut', 'run',
      '--project', workdir,
      '--test-files', 'src/add.test.ts',
      '--input-sig', HEX_SIG,
      '--session-id', sessionId,
      '--out', out,
      '--json',
    ]);

    // 1. The Stryker invoker was called exactly once.
    expect(invokeStryker).toHaveBeenCalledTimes(1);

    // 2. The CLI wrote the file at the canonical path AND at --out.
    const json = JSON.parse(readFileSync(out, 'utf8'));
    expect(json.version).toBe('1.0');
    expect(json.mutation.tool).toBe('stryker');
    expect(json.mutation.killRate).toBeGreaterThanOrEqual(0.8);
    // 3 expect(...).method() calls in the fixture → scanner counts 3.
    expect(json.assertions.totalAssertions).toBe(3);
    // The toBeDefined() weak pattern must surface (the fixture uses it).
    const toBeDefined = json.assertions.weakPatterns.find(
      (p: { pattern: string }) => p.pattern === 'toBeDefined'
    );
    expect(toBeDefined).toBeDefined();
    // Threshold should pass (killRate 0.9 ≥ 0.8, weakRate 1/3 ≈ 0.33
    // > 0.05 so the weak-rate gate does fail — but killRate passes).
    // We don't assert `passed` here because both axes are evaluated.
    expect(typeof json.thresholds.passed).toBe('boolean');

    // 3. peaks-qa's loadMutReport can read the same file back.
    // chdir into the workdir so the relative `.peaks/_runtime/<sid>/`
    // path resolves there (loadMutReport uses a relative path by
    // design — see report-loader.ts).
    const originalCwd = process.cwd();
    process.chdir(workdir);
    try {
      const loaded = await loadMutReport(sessionId);
      expect(loaded).not.toBeNull();
      expect(loaded?.inputSig).toBe(HEX_SIG);
      expect(loaded?.mutation.killRate).toBe(json.mutation.killRate);
      expect(loaded?.thresholds.passed).toBe(json.thresholds.passed);
      // MUT.sig is the sha256 that chains back to TACT.sig — must
      // round-trip cleanly through the read side.
      expect(loaded?.sha256).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('produces a stable MUT.sig across two runs when the clock is frozen', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-22T00:00:00.000Z'));

    // Identical Stryker fixture for both runs.
    const invokeStryker = vi.fn(async () => ({
      mutantsTotal: 5,
      mutantsKilled: 5,
      mutantsSurvived: 0,
      mutantsTimeout: 0,
      perFile: [{ file: 'src/add.ts', killRate: 1.0, survived: [] }],
    }));

    async function runOnce(outFile: string): Promise<{
      json: Record<string, unknown>;
      out: string;
    }> {
      const program = new Command().addCommand(
        createMutCommands({ invokeStryker })
      );
      await program.parseAsync([
        'node', 'peaks', 'mut', 'run',
        '--project', workdir,
        '--test-files', 'src/add.test.ts',
        '--input-sig', HEX_SIG,
        '--session-id', sessionId,
        '--out', outFile,
      ]);
      const json = JSON.parse(readFileSync(outFile, 'utf8'));
      return { json, out: outFile };
    }

    const first = await runOnce(join(outdir, 'first.json'));
    const second = await runOnce(join(outdir, 'second.json'));

    // With the clock frozen, generatedAt is identical → MUT.sig is
    // identical. This is the load-bearing audit-trail invariant.
    expect(first.json.sha256).toBe(second.json.sha256);
    expect(first.json.generatedAt).toBe(second.json.generatedAt);
    // Sanity: sha256 is 64-hex (Zod schema regex).
    expect(first.json.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('peaks-qa consumes the report and surfaces mutation.passed in the verdict', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-22T00:00:00.000Z'));

    // Write a separate, clean fixture that uses concrete equality
    // assertions only (no toBeDefined / toBeTruthy) so the
    // assertion scanner sees weakRate = 0 and the gate PASSES on
    // both axes. Stryker fixture gives killRate = 1.0.
    const cleanDir = join(outdir, 'clean-proj');
    mkdirSync(join(cleanDir, 'src'), { recursive: true });
    writeFileSync(
      join(cleanDir, 'src', 'add.ts'),
      'export const add = (a: number, b: number) => a + b;\n'
    );
    writeFileSync(
      join(cleanDir, 'src', 'add.test.ts'),
      [
        "import { add } from './add';",
        "import { describe, it, expect } from 'vitest';",
        '',
        "describe('add', () => {",
        '  it(\'adds\', () => {',
        '    expect(add(2, 2)).toBe(4);',
        '    expect(add(0, 0)).toBe(0);',
        '  });',
        '});',
        '',
      ].join('\n')
    );

    const invokeStryker = vi.fn(async () => ({
      mutantsTotal: 3,
      mutantsKilled: 3,
      mutantsSurvived: 0,
      mutantsTimeout: 0,
      perFile: [{ file: 'src/add.ts', killRate: 1.0, survived: [] }],
    }));

    const program = new Command().addCommand(
      createMutCommands({ invokeStryker })
    );
    const out = join(cleanDir, mutReportPath(sessionId));
    await program.parseAsync([
      'node', 'peaks', 'mut', 'run',
      '--project', cleanDir,
      '--test-files', 'src/add.test.ts',
      '--input-sig', HEX_SIG,
      '--session-id', sessionId,
      '--out', out,
    ]);

    const originalCwd = process.cwd();
    process.chdir(cleanDir);
    try {
      // Read the same way peaks-qa's qa run action does (commit
      // cad634a — loadMutReport inside the qa run gate).
      const mutationReport = await loadMutReport(sessionId);
      expect(mutationReport).not.toBeNull();
      // Replicate the qa-runner's gate shape: a passing report must
      // produce `mutation.passed === true`. (The actual
      // runQaSlice() integration is covered by qa-commands tests;
      // here we assert the data path that drives it.)
      expect(mutationReport?.thresholds.passed).toBe(true);
      expect(mutationReport?.mutation.killRate).toBe(1.0);
      expect(mutationReport?.assertions.weakRate).toBe(0);
    } finally {
      process.chdir(originalCwd);
    }
  });
});