import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { buildEslintArgs, runEslint } from '../../../../src/services/lint/eslint-runner.js';

// Backlog §2.41: a leg that reports a count of findings must also report the
// population it examined, and refuse when that population is 0 without an
// explicit opt-in. Dot-directories are the population eslint skips silently.

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
    if (queue.length === 0) return { status: 0, stdout: '', stderr: '' } as SpawnResult;
    return queue.shift() as SpawnResult;
  });
}

describe('dot-path scope arguments', () => {
  it('when the scope has no dot segment, should not add --no-ignore', () => {
    // given: an ordinary source scope
    // when: the argument list is built
    const args = buildEslintArgs({ cwd: process.cwd(), scope: 'src/' });

    // then: eslint's default ignore rules are left intact
    expect(args).not.toContain('--no-ignore');
  });

  it('when the scope is a dot-directory, should add --no-ignore so it is examined', () => {
    // given: a scope eslint would otherwise skip wholesale
    // when: the argument list is built
    const args = buildEslintArgs({ cwd: process.cwd(), scope: '.husky/' });

    // then: the dot-directory is forced into the run
    expect(args).toContain('--no-ignore');
    expect(args[args.length - 1]).toBe('.husky/');
  });
});

describe('population reporting (backlog §2.41)', () => {
  beforeEach(() => {
    childMock.spawnSync.mockReset();
  });

  afterEach(() => {
    childMock.spawnSync.mockReset();
  });

  it('when the scope is a dot-directory holding one file, should report population 1 and its finding', () => {
    // given: eslint examined one file in a dot-directory and found one error
    queueSpawnSequence([
      {
        status: 1,
        stdout: JSON.stringify([
          {
            filePath: join(process.cwd(), '.tmp-dot', 'one.mjs'),
            messages: [{ ruleId: 'no-var', severity: 2, message: 'no var', line: 1, column: 1 }]
          }
        ])
      }
    ]);

    // when: runEslint is invoked on that dot-scope
    const result = runEslint({ cwd: process.cwd(), scope: '.tmp-dot', diffOnly: false });

    // then: the population is reported and the finding survives
    const call = childMock.spawnSync.mock.calls[0] as [string, string[]];
    expect(call[1]).toContain('--no-ignore');
    expect(result.checkedFiles).toBe(1);
    expect(result.findings.map((f) => f.ruleId)).toEqual(['no-var']);
  });

  it('when eslint examined no files, should refuse with empty-scope instead of reporting clean', () => {
    // given: eslint exits 0 having produced no file entries at all
    queueSpawnSequence([{ status: 0, stdout: '[]' }]);

    // when: runEslint is invoked
    const result = runEslint({ cwd: process.cwd() });

    // then: an empty population is refused, and the reason names the opt-in
    expect(result.state).toBe('empty-scope');
    expect(result.checkedFiles).toBe(0);
    expect(result.reason).toContain('examined 0 files');
    expect(result.reason).toContain('--allow-empty');
  });

  it('when the scope matched no file, should refuse as empty-scope rather than eslint-missing', () => {
    // given: eslint exits 2 with empty stdout and its "no files" message
    queueSpawnSequence([
      {
        status: 2,
        stdout: '',
        stderr: 'No files matching the pattern "empty-dir" were found.'
      }
    ]);

    // when: runEslint is invoked
    const result = runEslint({ cwd: process.cwd(), scope: 'empty-dir' });

    // then: the empty population is named as such
    expect(result.state).toBe('empty-scope');
    expect(result.checkedFiles).toBe(0);
  });

  it('when an ignored entry is returned, should count it as skipped rather than as a finding', () => {
    // given: eslint answered the dot-file with only its "File ignored" warning
    queueSpawnSequence([
      {
        status: 0,
        stdout: JSON.stringify([
          {
            filePath: join(process.cwd(), '.husky', 'lint-scope.mjs'),
            messages: [
              {
                ruleId: null,
                severity: 1,
                message: 'File ignored by default.  Use a negated ignore pattern to override.',
                line: 0,
                column: 0
              }
            ]
          }
        ])
      }
    ]);

    // when: runEslint is invoked
    const result = runEslint({ cwd: process.cwd(), scope: '.husky/lint-scope.mjs' });

    // then: the skip is not a lint result, and the empty population is refused
    expect(result.ignoredFiles).toBe(1);
    expect(result.checkedFiles).toBe(0);
    expect(result.findings).toEqual([]);
    expect(result.state).toBe('empty-scope');
  });

  it('when --allow-empty is passed, should accept an empty population with state ok', () => {
    // given: eslint examined no files, but the caller opted in
    queueSpawnSequence([{ status: 0, stdout: '[]' }]);

    // when: runEslint is invoked with allowEmpty
    const result = runEslint({ cwd: process.cwd(), allowEmpty: true });

    // then: the run is reported as ok, with the empty population still visible
    expect(result.state).toBe('ok');
    expect(result.checkedFiles).toBe(0);
  });
});
