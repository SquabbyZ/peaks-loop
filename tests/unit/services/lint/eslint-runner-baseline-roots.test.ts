import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runEslint } from '../../../../src/services/lint/eslint-runner.js';

// Split out of eslint-runner.test.ts (rid-6f1df581 repair 1). The four cases
// below are the cross-root normalisation family; they moved because the host
// file crossed the `max-lines` cap once they landed. No assertion changed —
// only the host file and the scaffolding around them.

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

describe('runEslint baseline path roots', () => {
  beforeEach(() => {
    childMock.spawnSync.mockReset();
  });

  afterEach(() => {
    childMock.spawnSync.mockReset();
  });

  // The agreeing-forms case in `eslint-runner.test.ts` (`:177` at HEAD) cannot
  // reach this: it makes BOTH sides relative, so the exact-string compare
  // succeeds and the cross-checkout mismatch is invisible. ESLint really
  // reports an ABSOLUTE `filePath` (measured on this repo:
  // `D:\peaks-loop\src\cli\commands\cron-commands.ts`) while a committed
  // baseline must be root-independent. The first three cases below pin that
  // disagreement; the fourth pins the boundary, where a foreign root must
  // still refuse to waive.

  it('when the baseline holds a repo-relative key and ESLint reports an absolute path, should waive across roots', () => {
    // given: a tmp root, a baseline keyed repo-relative (the portable form),
    //   and ESLint reporting the finding absolute under this root
    const tmp = mkdtempSync(join(tmpdir(), 'peaks-rd-prd002b-'));
    try {
      mkdirSync(join(tmp, '.peaks/lint'), { recursive: true });
      writeFileSync(
        join(tmp, '.peaks/lint/baseline.json'),
        JSON.stringify({
          version: 1,
          generatedAt: '2026-08-07T00:00:00.000Z',
          toolVersion: 'peaks-loop-4.0.54',
          violations: [
            {
              ruleId: 'no-magic-numbers',
              file: 'src/foo.ts',
              line: 42,
              severity: 'warn',
              message: 'magic 7'
            }
          ]
        }),
        'utf8'
      );
      const absolute = join(tmp, 'src', 'foo.ts');
      queueSpawnSequence([
        {
          status: 1,
          stdout: JSON.stringify([
            {
              filePath: absolute,
              messages: [
                { ruleId: 'no-magic-numbers', severity: 1, message: 'magic 7', line: 42, column: 1 }
              ]
            }
          ])
        }
      ]);

      // when: runEslint is invoked with diffOnly=false (baseline matcher only)
      const result = runEslint({ cwd: tmp, diffOnly: false });

      // then: the absolute finding matched the relative key and was waived
      expect(result.findings).toEqual([]);
      expect(result.baselineWaived.length).toBe(1);
      expect(result.baselineWaived[0]?.filePath).toBe(absolute);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('when the baseline key was authored with backslash separators, should still waive the absolute finding', () => {
    // given: a baseline key holding a Windows-authored relative path — the
    //   exact form `path.relative()` returns on win32 — and an absolute finding
    const tmp = mkdtempSync(join(tmpdir(), 'peaks-rd-prd002b-'));
    try {
      mkdirSync(join(tmp, '.peaks/lint'), { recursive: true });
      writeFileSync(
        join(tmp, '.peaks/lint/baseline.json'),
        JSON.stringify({
          version: 1,
          generatedAt: '2026-08-07T00:00:00.000Z',
          toolVersion: 'peaks-loop-4.0.54',
          violations: [
            {
              ruleId: 'no-magic-numbers',
              file: 'src\\foo.ts',
              line: 42,
              severity: 'warn',
              message: 'magic 7'
            }
          ]
        }),
        'utf8'
      );
      queueSpawnSequence([
        {
          status: 1,
          stdout: JSON.stringify([
            {
              filePath: join(tmp, 'src', 'foo.ts'),
              messages: [
                { ruleId: 'no-magic-numbers', severity: 1, message: 'magic 7', line: 42, column: 1 }
              ]
            }
          ])
        }
      ]);

      // when: runEslint is invoked with diffOnly=false
      const result = runEslint({ cwd: tmp, diffOnly: false });

      // then: separator folding is applied to BOTH sides, so the pair matches
      expect(result.findings).toEqual([]);
      expect(result.baselineWaived.length).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('when git names the file repo-relative and ESLint names it absolute, should waive through the diff gate', () => {
    // given: a portable baseline key, an absolute ESLint path, and a git diff
    //   naming the same file repo-relative with a hunk at the finding's line
    const tmp = mkdtempSync(join(tmpdir(), 'peaks-rd-prd002b-'));
    try {
      mkdirSync(join(tmp, '.peaks/lint'), { recursive: true });
      writeFileSync(
        join(tmp, '.peaks/lint/baseline.json'),
        JSON.stringify({
          version: 1,
          generatedAt: '2026-08-07T00:00:00.000Z',
          toolVersion: 'peaks-loop-4.0.54',
          violations: [
            {
              ruleId: 'no-magic-numbers',
              file: 'src/foo.ts',
              line: 42,
              severity: 'warn',
              message: 'magic 7'
            }
          ]
        }),
        'utf8'
      );
      queueSpawnSequence([
        {
          status: 1,
          stdout: JSON.stringify([
            {
              filePath: join(tmp, 'src', 'foo.ts'),
              messages: [
                { ruleId: 'no-magic-numbers', severity: 1, message: 'magic 7', line: 42, column: 1 }
              ]
            }
          ])
        },
        {
          status: 0,
          stdout:
            'diff --git a/src/foo.ts b/src/foo.ts\n--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -42 +42 @@\n+const seven = 7;\n'
        }
      ]);

      // when: runEslint is invoked with the default diffOnly=true
      const result = runEslint({ cwd: tmp });

      // then: the finding survived the diff gate and was waived, not reported as new
      expect(result.findings).toEqual([]);
      expect(result.baselineWaived.length).toBe(1);
      expect(result.baselineWaived[0]?.line).toBe(42);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('when the baseline still holds another machine absolute root, should not waive on this root', () => {
    // given: a baseline keyed to a DIFFERENT absolute root than this run
    const tmp = mkdtempSync(join(tmpdir(), 'peaks-rd-prd002b-'));
    try {
      mkdirSync(join(tmp, '.peaks/lint'), { recursive: true });
      writeFileSync(
        join(tmp, '.peaks/lint/baseline.json'),
        JSON.stringify({
          version: 1,
          generatedAt: '2026-08-07T00:00:00.000Z',
          toolVersion: 'peaks-loop-4.0.16+',
          violations: [
            {
              ruleId: 'no-magic-numbers',
              file: join(tmpdir(), 'other-machine', 'peaks-loop', 'src', 'foo.ts'),
              line: 42,
              severity: 'warn',
              message: 'magic 7'
            }
          ]
        }),
        'utf8'
      );
      queueSpawnSequence([
        {
          status: 1,
          stdout: JSON.stringify([
            {
              filePath: join(tmp, 'src', 'foo.ts'),
              messages: [
                { ruleId: 'no-magic-numbers', severity: 1, message: 'magic 7', line: 42, column: 1 }
              ]
            }
          ])
        }
      ]);

      // when: runEslint is invoked with diffOnly=false
      const result = runEslint({ cwd: tmp, diffOnly: false });

      // then: no waiver — a foreign absolute key cannot be re-rooted, which is
      //   exactly why the committed baseline had to be rewritten in place
      expect(result.baselineWaived).toEqual([]);
      expect(result.findings.length).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
