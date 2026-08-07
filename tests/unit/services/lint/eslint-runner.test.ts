import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildEslintArgs, runEslint } from '../../../../src/services/lint/eslint-runner.js';

type SpawnResult = {
  status: number | null;
  stdout: string;
  stderr?: string;
  signal?: NodeJS.Signals;
  error?: NodeJS.ErrnoException;
};

interface ChildProcessMock {
  spawnSync: ReturnType<typeof vi.fn>;
}

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn()
}));

const { spawnSync } = await import('node:child_process');
const childMock = { spawnSync } as unknown as ChildProcessMock;

function queueSpawnSequence(results: SpawnResult[]): void {
  const queue = [...results];
  childMock.spawnSync.mockImplementation(() => {
    if (queue.length === 0) {
      return { status: 0, stdout: '', stderr: '' } as SpawnResult;
    }
    return queue.shift() as SpawnResult;
  });
}

describe('runEslint', () => {
  beforeEach(() => {
    childMock.spawnSync.mockReset();
  });

  afterEach(() => {
    childMock.spawnSync.mockReset();
  });

  it('when npx is missing, should return state npx-failed', () => {
    // given: spawnSync reports an ENOENT for the npx binary
    queueSpawnSequence([{ status: null, stdout: '', error: Object.assign(new Error('spawn npx ENOENT'), { code: 'ENOENT' } as NodeJS.ErrnoException) }]);

    // when: runEslint is invoked
    const result = runEslint({ cwd: process.cwd() });

    // then: state must be npx-failed with empty findings
    expect(result.state).toBe('npx-failed');
    expect(result.findings).toEqual([]);
    expect(result.summary).toEqual({ error: 0, warn: 0, info: 0 });
  });

  it('when eslint runs cleanly, should return state ok with empty findings', () => {
    // given: eslint exits 0 with an empty JSON array
    queueSpawnSequence([{ status: 0, stdout: '[]' }]);

    // when: runEslint is invoked
    const result = runEslint({ cwd: process.cwd() });

    // then: state must be ok with zero findings
    expect(result.state).toBe('ok');
    expect(result.findings).toEqual([]);
    expect(result.summary).toEqual({ error: 0, warn: 0, info: 0 });
  });

  it('when eslint reports 3 errors and 2 warnings, should summarize severity buckets', () => {
    // given: eslint emits JSON with five messages; git diff covers src/a.ts lines 1-5
    const payload = [
      {
        filePath: 'src/a.ts', messages: [
          { ruleId: 'no-var', severity: 2, message: 'no var', line: 1, column: 1 },
          { ruleId: 'eqeqeq', severity: 2, message: 'eqeqeq', line: 2, column: 1 },
          { ruleId: 'no-magic-numbers', severity: 2, message: 'magic', line: 3, column: 1 },
          { ruleId: 'no-explicit-any', severity: 1, message: 'any', line: 4, column: 1 },
          { ruleId: 'prefer-const', severity: 1, message: 'prefer const', line: 5, column: 1 }
        ]
      }
    ];
    queueSpawnSequence([
      { status: 1, stdout: JSON.stringify(payload) },
      { status: 0, stdout: 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,5 +1,5 @@\n+line1\n+line2\n+line3\n+line4\n+line5\n' }
    ]);

    // when: runEslint is invoked
    const result = runEslint({ cwd: process.cwd() });

    // then: severity counts reflect the JSON input
    expect(result.state).toBe('ok');
    expect(result.summary).toEqual({ error: 3, warn: 2, info: 0 });
    expect(result.findings.length).toBe(5);
  });

  it('when eslint times out at 60s, should return state execution-failed', () => {
    // given: spawnSync reports a SIGTERM (the spawn timeout default)
    queueSpawnSequence([{ status: null, stdout: '', signal: 'SIGTERM' }]);

    // when: runEslint is invoked with a 60s timeout
    const result = runEslint({ cwd: process.cwd(), timeoutMs: 60_000 });

    // then: state must be execution-failed
    expect(result.state).toBe('execution-failed');
    expect(result.findings).toEqual([]);
  });

  it('when --scope is provided, should append the scope path to the npx args', () => {
    // given: a successful empty run with --scope src/services/
    queueSpawnSequence([{ status: 0, stdout: '[]' }]);

    // when: runEslint is invoked with a scope
    runEslint({ cwd: process.cwd(), scope: 'src/services/' });

    // then: the npx argv must include the scope path
    const call = childMock.spawnSync.mock.calls[0] as [string, string[]];
    expect(call[0]).not.toBe('npx');
    expect(call[1]).toContain('--format');
    expect(call[1][call[1].length - 1]).toBe('src/services/');
  });

  it('when --fix is passed, should refuse and return execution-failed (read-only invariant)', () => {
    // given: --fix is supplied by the caller

    // when: runEslint is invoked
    const result = runEslint({ cwd: process.cwd(), fix: true });

    // then: the wrapper must refuse without spawning npx
    expect(result.state).toBe('execution-failed');
    expect(childMock.spawnSync).not.toHaveBeenCalled();
  });

  // PRD-002b slice — diffOnly / baselineFile / redLineMode / max-lines-error.

  it('when diffOnly true and finding is outside diff hunks, should skip silently (D4/D5 invariant)', () => {
    // given: a tmp cwd; spawnSync returns (1) npx eslint finding + (2) empty git diff
    const tmp = mkdtempSync(join(tmpdir(), 'peaks-rd-prd002b-'));
    try {
      const payload = [
        {
          filePath: 'src/stock.ts',
          messages: [{ ruleId: 'max-lines', severity: 2, message: 'too long', line: 42, column: 1 }]
        }
      ];
      queueSpawnSequence([
        { status: 1, stdout: JSON.stringify(payload) }, // npx eslint first
        { status: 0, stdout: '' } // git diff: no hunks → finding is filtered out
      ]);

      // when: runEslint is invoked with diffOnly=true (default)
      const result = runEslint({ cwd: tmp });

      // then: the stock finding is filtered out; envelope carries empty active findings
      expect(result.state).toBe('ok');
      expect(result.findings).toEqual([]);
      expect(result.summary).toEqual({ error: 0, warn: 0, info: 0 });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('when baselineFile provided and finding matches baseline, should waive into baselineWaived', () => {
    // given: a tmp cwd + baseline.json containing the same finding + eslint emits the same finding
    const tmp = mkdtempSync(join(tmpdir(), 'peaks-rd-prd002b-'));
    try {
      mkdirSync(join(tmp, '.peaks/lint'), { recursive: true });
      writeFileSync(
        join(tmp, '.peaks/lint/baseline.json'),
        JSON.stringify({
          version: 1,
          generatedAt: '2026-08-06T00:00:00.000Z',
          toolVersion: 'peaks-loop-4.0.16+',
          violations: [
            { ruleId: 'no-magic-numbers', file: 'src/foo.ts', line: 42, severity: 'error', message: 'magic 7' }
          ]
        }),
        'utf8'
      );
      const payload = [
        {
          filePath: 'src/foo.ts',
          messages: [{ ruleId: 'no-magic-numbers', severity: 2, message: 'magic 7', line: 42, column: 1 }]
        }
      ];
      queueSpawnSequence([
        { status: 1, stdout: JSON.stringify(payload) }, // npx eslint: finding emitted
        { status: 0, stdout: '' } // git diff: no hunks — finding filtered, then no baseline match possible
      ]);

      // when: runEslint is invoked with diffOnly=false (so diff filter doesn't drop the finding)
      const result = runEslint({ cwd: tmp, diffOnly: false });

      // then: the matched finding is waived; active findings empty; baselineWaived populated
      expect(result.findings).toEqual([]);
      expect(result.baselineWaived.length).toBe(1);
      expect(result.baselineWaived[0]?.ruleId).toBe('no-magic-numbers');
      expect(result.baselineWaived[0]?.line).toBe(42);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('when redLineMode baseline-aware and 5 same-ruleId findings in baseline, should include redLine envelope section', () => {
    // given: baseline.json contains 5 violations of no-magic-numbers across 3 files
    const tmp = mkdtempSync(join(tmpdir(), 'peaks-rd-prd002b-'));
    try {
      mkdirSync(join(tmp, '.peaks/lint'), { recursive: true });
      const violations = [
        { ruleId: 'no-magic-numbers', file: 'src/a.ts', line: 1, severity: 'error', message: 'x' },
        { ruleId: 'no-magic-numbers', file: 'src/a.ts', line: 2, severity: 'error', message: 'x' },
        { ruleId: 'no-magic-numbers', file: 'src/b.ts', line: 1, severity: 'error', message: 'x' },
        { ruleId: 'no-magic-numbers', file: 'src/c.ts', line: 1, severity: 'error', message: 'x' },
        { ruleId: 'no-magic-numbers', file: 'src/c.ts', line: 2, severity: 'error', message: 'x' }
      ];
      writeFileSync(
        join(tmp, '.peaks/lint/baseline.json'),
        JSON.stringify({ version: 1, generatedAt: 'x', toolVersion: 'x', violations }),
        'utf8'
      );
      queueSpawnSequence([
        { status: 0, stdout: '[]' }, // npx eslint: clean
        { status: 0, stdout: '' } // git diff: empty (no extra calls expected, queue exhausted)
      ]);

      // when: runEslint is invoked
      const result = runEslint({ cwd: tmp });

      // then: redLine contains one entry aggregating the 5 occurrences, sorted by count desc
      expect(result.redLine.length).toBe(1);
      expect(result.redLine[0]?.ruleId).toBe('no-magic-numbers');
      expect(result.redLine[0]?.count).toBe(5);
      expect(result.redLine[0]?.topFiles[0]?.count).toBeGreaterThanOrEqual(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('when max-lines rule fires on new 1000-line file in diff, should escalate severity to error', () => {
    // given: a max-lines severity=2 finding (already error in upstream rule, but verifying the severity round-trip)
    const tmp = mkdtempSync(join(tmpdir(), 'peaks-rd-prd002b-'));
    try {
      const payload = [
        {
          filePath: 'src/big.ts',
          messages: [
            { ruleId: 'max-lines', severity: 2, message: 'file has 1000 lines, maximum is 400', line: 401, column: 1 }
          ]
        }
      ];
      queueSpawnSequence([
        { status: 1, stdout: JSON.stringify(payload) }, // npx eslint first
        { status: 0, stdout: '' } // git diff: file absent from diff → finding filtered out
      ]);

      // when: runEslint is invoked with diffOnly=false (so the finding survives)
      const result = runEslint({ cwd: tmp, diffOnly: false });

      // then: the max-lines error is reported as severity 'error' (not warn)
      expect(result.state).toBe('ok');
      const maxLines = result.findings.find((f) => f.ruleId === 'max-lines');
      expect(maxLines).toBeDefined();
      expect(maxLines?.severity).toBe('error');
      expect(result.summary.error).toBeGreaterThanOrEqual(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  // PRD-002b slice 2 (commit A) — config-tune wire confirmation.
  // Loads the live .peaks-rules.cjs, asserts the parsed no-magic-numbers
  // config has the schema-valid options that eslint 8.57.1 accepts:
  //   ignore: [-1, 0, 1, 2, 100, 1000]
  //   ignoreArrayIndexes: true
  //   ignoreDefaultValues: true
  // (ignoreEnums / ignoreReadonlyClassProperties / ignoreNumericLiterals
  // are eslint 9.x only and rejected by 8.57.1 schema with
  // additionalProperties:false, so they are intentionally absent here.)
  it('when no-magic-numbers config is loaded, should contain the slice-2 ignore/option set', () => {
    // given: the live config file at config/eslint/.peaks-rules.cjs
    const configPath = join(process.cwd(), 'config', 'eslint', '.peaks-rules.cjs');
    // Clear require cache to avoid stale config between test runs
    delete require.cache[require.resolve(configPath)];
    const cfg = require(configPath) as { rules: Record<string, unknown> };

    // when: the no-magic-numbers rule is read
    const ruleEntry = cfg.rules['no-magic-numbers'] as [string, Record<string, unknown>] | undefined;

    // then: severity is 'warn' (D5 no-touch-stockcode) and options are the slice-2 set
    expect(ruleEntry).toBeDefined();
    expect(ruleEntry?.[0]).toBe('warn');
    const opts = ruleEntry?.[1] ?? {};
    const ignore = opts['ignore'] as number[];
    expect(Array.isArray(ignore)).toBe(true);
    for (const v of [-1, 0, 1, 2, 100, 1000]) {
      expect(ignore).toContain(v);
    }
    expect(opts['ignoreArrayIndexes']).toBe(true);
    expect(opts['ignoreDefaultValues']).toBe(true);
  });
});

describe('buildEslintArgs', () => {
  it('when --scope is supplied, should include --format json + --config + the scope path, no plugin pin args', () => {
    // given: a scope value
    // when: buildEslintArgs is called
    const args = buildEslintArgs({ cwd: process.cwd(), scope: 'src/' });

    // then: the args are local-binary friendly (format + config + scope, no npx --package wrappers)
    expect(args).toContain('--format');
    expect(args).toContain('json');
    expect(args).toContain('--config');
    expect(args).toContain(join('config', 'eslint', '.peaks-rules.cjs'));
    expect(args.some((arg) => arg.startsWith('--package'))).toBe(false);
    expect(args.some((arg) => arg.includes('eslint-plugin-import'))).toBe(false);
    expect(args[args.length - 1]).toBe('src/');
  });

  it('when eslint runs, should invoke the local eslint.js via node when present', () => {
    // given: eslint returns an empty result and the project root has node_modules/eslint/bin/eslint.js
    queueSpawnSequence([{ status: 0, stdout: '[]' }]);

    // when: runEslint executes the local toolchain
    runEslint({ cwd: process.cwd(), diffOnly: false });

    // then: spawnSync invokes `node <eslint.js>` (not `npx` and not a .cmd shim)
    const call = childMock.spawnSync.mock.calls[0] as [string, string[], Record<string, unknown>];
    expect(call[0]).not.toBe('npx');
    expect(call[0]).toMatch(/node(\.exe)?$/);
    expect(call[1][0]).toMatch(/eslint\.js$/);
    expect(call[1]).toEqual(expect.arrayContaining(['--format', 'json']));
    expect(call[2]).toMatchObject({ encoding: 'utf8' });
  });
});
