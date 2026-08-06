import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildEslintArgs, ESLINT_PACKAGE_PINS, runEslint } from '../../../../src/services/lint/eslint-runner.js';

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
    // given: eslint emits JSON with five messages
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
    queueSpawnSequence([{ status: 1, stdout: JSON.stringify(payload) }]);

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
    expect(call[0]).toBe('npx');
    expect(call[1]).toContain('--no-warn-ignored');
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
});

describe('buildEslintArgs', () => {
  it('when --scope is supplied, should pin the four packages and pass --no-warn-ignored', () => {
    // given: a scope value
    // when: buildEslintArgs is called
    const args = buildEslintArgs({ cwd: process.cwd(), scope: 'src/' });

    // then: the args pin all 4 packages and include the read-only flag
    expect(args).toContain(`eslint@${ESLINT_PACKAGE_PINS.eslint}`);
    expect(args).toContain(`@typescript-eslint/parser@${ESLINT_PACKAGE_PINS.typescriptEslintParser}`);
    expect(args).toContain(`@typescript-eslint/eslint-plugin@${ESLINT_PACKAGE_PINS.typescriptEslintPlugin}`);
    expect(args).toContain(`eslint-plugin-import@${ESLINT_PACKAGE_PINS.importPlugin}`);
    expect(args).toContain('--no-warn-ignored');
    expect(args[args.length - 1]).toBe('src/');
  });
});
