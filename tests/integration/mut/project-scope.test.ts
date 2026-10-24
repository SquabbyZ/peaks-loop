/**
 * `peaks mut` — REAL Stryker run, project-scoped.
 *
 * This is the acceptance test for the whole point of the slice: a real
 * mutation run against a fixture project that lives OUTSIDE this
 * repository, with no `stryker.conf.js` and no `node_modules` of its own.
 *
 * Why the fixture lives outside the repository: a temp directory nested
 * inside the checkout is picked up by vitest / vite / tsconfig root
 * resolution, and the run then drags the whole repository into the
 * test. `mkdtempSync(join(tmpdir(), ...))` keeps it outside.
 *
 * Why the run is slow and why that is fine: Stryker forks worker
 * processes and drives vitest inside them. The fixture holds ONE source
 * file with two functions, so the whole run is a handful of mutants.
 *
 * Measured toolchain: @stryker-mutator/core 9.6.1,
 * @stryker-mutator/vitest-runner 9.6.1 (both production dependencies of
 * `packages/peaks-loop-mut`).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createProductionStrykerInvoker } from 'peaks-loop-mut';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');
const HEX_SIG = 'c'.repeat(64);
const REAL_RUN_TIMEOUT_MS = 240_000;

describe('peaks mut — real Stryker run, project scoped', () => {
  let fixture: string;
  let callerCwd: string;
  let decoy: string;
  let decoyBefore: string;
  const originalCwd = process.cwd();

  beforeEach(() => {
    // The fixture: one source file, one test file, NO stryker.conf.js and
    // NO node_modules. Both absences are load-bearing for the acceptance
    // criteria (the config file is what AC-3 checks; the missing
    // node_modules is what proves the vitest runner is loaded from
    // peaks-loop's own installation).
    fixture = mkdtempSync(join(tmpdir(), 'peaks-mut-fixture-'));
    mkdirSync(join(fixture, 'src'), { recursive: true });
    writeFileSync(
      join(fixture, 'package.json'),
      JSON.stringify({ name: 'fixture', type: 'module' }, null, 2)
    );
    writeFileSync(
      join(fixture, 'src', 'add.ts'),
      'export const add = (a: number, b: number) => a + b;\nexport const sub = (a: number, b: number) => a - b;\n'
    );
    writeFileSync(
      join(fixture, 'src', 'add.test.ts'),
      [
        "import { describe, it, expect } from 'vitest';",
        "import { add, sub } from './add';",
        '',
        "describe('add', () => {",
        "  it('adds', () => {",
        '    expect(add(2, 2)).toBe(4);',
        '  });',
        "  it('subs', () => {",
        '    expect(sub(5, 2)).toBe(3);',
        '  });',
        '});',
        ''
      ].join('\n')
    );

    // The caller's working directory: a decoy source file that must NOT
    // be mutated. If the run were scoped to the CWD instead of the
    // project, this file would be rewritten.
    callerCwd = mkdtempSync(join(tmpdir(), 'peaks-mut-caller-'));
    mkdirSync(join(callerCwd, 'src'), { recursive: true });
    decoy = join(callerCwd, 'src', 'decoy.ts');
    writeFileSync(decoy, 'export const decoy = (): number => 42;\n');
    decoyBefore = readFileSync(decoy, 'utf8');
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(fixture, { recursive: true, force: true });
    rmSync(callerCwd, { recursive: true, force: true });
  });

  it(
    'when the fixture has no stryker.conf.js, should mutate the fixture and not the caller cwd',
    async () => {
      // given: a fixture project with no stryker.conf.js and no node_modules
      // when: the invoker runs against that fixture from a different cwd
      // then: the fixture's mutants are measured and the caller's cwd is untouched
      expect(existsSync(join(fixture, 'stryker.conf.js'))).toBe(false);
      expect(existsSync(join(fixture, 'node_modules'))).toBe(false);

      // Run from a directory that is NOT the project: the run must still
      // mutate the fixture.
      process.chdir(callerCwd);
      const invokeStryker = createProductionStrykerInvoker();
      const result = await invokeStryker({
        project: fixture,
        testFiles: ['src/add.test.ts'],
        mutate: ['src/add.ts']
      });

      // AC-1: a real measurement, not a mock.
      expect(result.mutantsTotal).toBeGreaterThanOrEqual(1);
      expect(result.mutantsKilled).toBeGreaterThanOrEqual(1);

      // AC-2: the mutated files are the FIXTURE's, reported relative to
      // the project root.
      expect(result.perFile.map((f) => f.file)).toEqual(['src/add.ts']);

      // AC-2 (negative half): the caller's cwd was not mutated.
      expect(readFileSync(decoy, 'utf8')).toBe(decoyBefore);

      // The invoker restores the CWD it found.
      expect(process.cwd()).toBe(callerCwd);
    },
    REAL_RUN_TIMEOUT_MS
  );

  it(
    'when --json is passed, should print exactly one JSON object on stdout',
    async () => {
      // given: a fixture project with one mutated source file
      // when: the CLI runs `mut mutants --json` against that fixture
      // then: stdout carries exactly one parseable JSON object
      const out = join(fixture, 'mut-report.json');
      // The source CLI (the `peaks` on PATH is a global 4.1.17 install,
      // not this worktree). It runs from the repo root while --project
      // points at the fixture — the same "different cwd" proof.
      //
      // `spawnSync`, not `execFileSync`: a kill-rate threshold breach is
      // a NON-ZERO exit by contract (preserved behavior), and the stdout
      // hygiene claim has to hold for that exit too.
      const result = spawnSync(
        process.execPath,
        [
          join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
          join(REPO_ROOT, 'src', 'cli', 'index.ts'),
          'mut',
          'mutants',
          '--project',
          fixture,
          '--test-files',
          'src/add.test.ts',
          '--mutate',
          'src/add.ts',
          '--input-sig',
          HEX_SIG,
          '--session-id',
          '2026-10-24-session-5e40e0',
          '--out',
          out,
          '--json'
        ],
        {
          cwd: REPO_ROOT,
          encoding: 'utf8',
          timeout: REAL_RUN_TIMEOUT_MS,
          windowsHide: true
        }
      );
      const stdout = result.stdout ?? '';

      // AC-4: stdout is EXACTLY one JSON object — no extra lines.
      const lines = stdout.split('\n').filter((line) => line.trim().length > 0);
      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(stdout) as { ok: boolean; sha256: string; passed: boolean };
      expect(parsed.ok).toBe(true);
      expect(parsed.sha256).toMatch(/^[a-f0-9]{64}$/);

      // The report the CLI wrote is a valid mut-report.json.
      const report = JSON.parse(readFileSync(out, 'utf8')) as {
        mutation: { mutantsTotal: number; tool: string };
      };
      expect(report.mutation.tool).toBe('stryker');
      expect(report.mutation.mutantsTotal).toBeGreaterThanOrEqual(1);
    },
    REAL_RUN_TIMEOUT_MS
  );
});
