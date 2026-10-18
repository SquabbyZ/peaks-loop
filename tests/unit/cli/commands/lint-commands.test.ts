import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { join } from 'node:path';
import type * as NodeFs from 'node:fs';
import { parseCliEnvelope } from '~/src/cli/cli-envelope';

interface ChildProcessMock {
  spawnSync: ReturnType<typeof vi.fn>;
}

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn()
}));

/**
 * Spy on the two write-side fs calls only, passing every read through to the
 * real module: the point of these tests is the payload handed to
 * `writeFileSync`, and a real write would create directories in the checkout.
 * `readFileSync` is a pass-through spy as well, so a test can hand back a
 * scratch baseline for one path and prove which baseline the runner read.
 */
const fsHooks = vi.hoisted(() => ({
  readFileSync: undefined as unknown as typeof NodeFs.readFileSync
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>();
  fsHooks.readFileSync = actual.readFileSync;
  return {
    ...actual,
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(actual.readFileSync)
  };
});

const { spawnSync } = await import('node:child_process');
const childMock = { spawnSync } as unknown as ChildProcessMock;

/**
 * Loose view of the mocked `node:fs` exports: the real signatures are
 * overloaded, and these assertions only need the recorded calls.
 */
const fsMock = (await import('node:fs')) as unknown as {
  readFileSync: {
    mockReset(): void;
    mockImplementation(fn: (path: string) => string): void;
    mock: { calls: unknown[][] };
  };
  writeFileSync: {
    mockClear(): void;
    mock: { calls: unknown[][] };
  };
};

function readWrittenBaseline(): { violations: unknown[] } {
  return JSON.parse(fsMock.writeFileSync.mock.calls[0]?.[1] as string) as { violations: unknown[] };
}

function missingFile(path: string): never {
  throw Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), {
    code: 'ENOENT'
  });
}

type Capture = {
  stdout: string;
  stderr: string;
  /**
   * Mirrors the real Node surface rather than a narrowed `number | undefined`:
   * `process.exitCode` is typed `string | number | null | undefined` (Node
   * accepts a numeric string), so deriving the type keeps this capture honest
   * as @types/node widens.
   */
  exitCode: typeof process.exitCode;
};

function makeIo(): { io: { stdout(s: string): void; stderr(s: string): void }; capture: Capture } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: (s: string) => stdout.push(s),
      stderr: (s: string) => stderr.push(s)
    },
    capture: {
      get stdout() {
        return stdout.join('');
      },
      get stderr() {
        return stderr.join('');
      },
      get exitCode() {
        return process.exitCode;
      }
    }
  };
}

async function importFresh(): Promise<
  typeof import('../../../../src/cli/commands/lint-commands.js')
> {
  vi.resetModules();
  return import('../../../../src/cli/commands/lint-commands.js');
}

describe('registerLintCommands', () => {
  beforeEach(() => {
    childMock.spawnSync.mockReset();
    fsMock.readFileSync.mockReset();
    fsMock.readFileSync.mockImplementation((path: string) => fsHooks.readFileSync(path, 'utf8'));
    fsMock.writeFileSync.mockClear();
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  it('when invoked with detect-eslint subcommand, should return 5-state envelope with pinnedVersions', async () => {
    // given: a fresh program and a callable io
    const { io, capture } = makeIo();
    const mod = await importFresh();
    const program = new Command();
    mod.registerLintCommands(program, io);
    childMock.spawnSync.mockImplementation(() => ({ status: 0, stdout: '10.8.0\n' }) as never);

    // when: parseAsync invoked with `lint detect-eslint --json`
    await program.parseAsync(['lint', 'detect-eslint', '--json'], { from: 'user' });

    // then: the io receives the detect envelope payload (pinnedVersions + state)
    expect(capture.stdout).toMatch(/"pinnedVersions"/);
    expect(capture.stdout).toMatch(/"state"/);
  });

  it('when --json is supplied, should print a JSON envelope with state field', async () => {
    // given: a fresh program and a JSON-flagged call
    const { io, capture } = makeIo();
    const mod = await importFresh();
    const program = new Command();
    mod.registerLintCommands(program, io);
    childMock.spawnSync.mockImplementation(() => ({ status: 0, stdout: '10.8.0\n' }) as never);

    // when: parseAsync runs the default subcommand with --json
    await program.parseAsync(['lint', '--json'], { from: 'user' });

    // then: stdout must contain parseable JSON
    const out = capture.stdout.trim();
    expect(() => parseCliEnvelope(out)).not.toThrow();
    const parsed = parseCliEnvelope(out);
    expect(parsed.data).toBeDefined();
  });

  it('when lint baseline writes the file, should key violations repo-relative so another checkout can match them', async () => {
    // given: ESLint reporting an ABSOLUTE filePath for this machine (its real
    //   form) and a fresh program wired to the baseline subcommand
    const { io, capture } = makeIo();
    const mod = await importFresh();
    const program = new Command();
    mod.registerLintCommands(program, io);
    childMock.spawnSync.mockImplementation(
      () =>
        ({
          status: 1,
          stdout: JSON.stringify([
            {
              filePath: join(
                process.cwd(),
                'src',
                'services',
                'lint',
                'fixture-not-in-any-baseline.ts'
              ),
              messages: [
                {
                  ruleId: 'no-magic-numbers',
                  severity: 1,
                  message: 'magic 16',
                  line: 38,
                  column: 1
                }
              ]
            }
          ])
        }) as never
    );

    // when: parseAsync runs `lint baseline --json`
    await program.parseAsync(
      ['lint', 'baseline', '--json', '--baseline-file', 'ignored/baseline.json'],
      { from: 'user' }
    );

    // then: the written key is repo-relative POSIX with no drive letter, so a
    //   different checkout can match it; nothing was actually written to disk
    const written = (await import('node:fs')).writeFileSync as unknown as ReturnType<typeof vi.fn>;
    const payload = JSON.parse(written.mock.calls[0]?.[1] as string) as {
      violations: { file: string; ruleId: string }[];
    };
    expect(payload.violations.length).toBe(1);
    expect(payload.violations[0]?.ruleId).toBe('no-magic-numbers');
    expect(payload.violations[0]?.file).toBe('src/services/lint/fixture-not-in-any-baseline.ts');
    expect(payload.violations.some((v) => /^[A-Za-z]:/.test(v.file))).toBe(false);
    expect(capture.stdout).toMatch(/"violations"/);
  });

  it('when a scratch baseline is named, should subtract its tuples on the read side too', async () => {
    // given: one finding that the NAMED scratch baseline already waives, and
    //   a read of any other path failing as a missing file
    const { io } = makeIo();
    const mod = await importFresh();
    const program = new Command();
    mod.registerLintCommands(program, io);
    childMock.spawnSync.mockImplementation(
      () =>
        ({
          status: 1,
          stdout: JSON.stringify([
            {
              filePath: join(process.cwd(), 'src', 'fixture-scratch.ts'),
              messages: [
                {
                  ruleId: 'no-magic-numbers',
                  severity: 1,
                  message: 'magic 16',
                  line: 38,
                  column: 1
                }
              ]
            }
          ])
        }) as never
    );
    fsMock.readFileSync.mockImplementation((path: string) =>
      path.endsWith('scratch-baseline.json')
        ? JSON.stringify({
            version: 1,
            violations: [
              {
                ruleId: 'no-magic-numbers',
                file: 'src/fixture-scratch.ts',
                line: 38,
                severity: 1,
                message: 'magic 16'
              }
            ]
          })
        : missingFile(path)
    );

    // when: parseAsync runs `lint baseline --baseline-file <scratch>`
    await program.parseAsync(
      ['lint', 'baseline', '--json', '--baseline-file', '.peaks/lint/scratch-baseline.json'],
      { from: 'user' }
    );

    // then: the scan subtracts the scratch tuple (nothing left to write) and
    //   the runner read the named file, not the default baseline
    expect(readWrittenBaseline().violations).toEqual([]);
    expect(
      fsMock.readFileSync.mock.calls.some((call) =>
        String(call[0]).endsWith('scratch-baseline.json')
      )
    ).toBe(true);
  });

  it('when no baseline file is named, should keep reading the default baseline', async () => {
    // given: one finding that the default baseline payload already waives, and
    //   a read of any other path failing as a missing file
    const { io } = makeIo();
    const mod = await importFresh();
    const program = new Command();
    mod.registerLintCommands(program, io);
    childMock.spawnSync.mockImplementation(
      () =>
        ({
          status: 1,
          stdout: JSON.stringify([
            {
              filePath: join(process.cwd(), 'src', 'fixture-default.ts'),
              messages: [
                {
                  ruleId: 'prefer-const',
                  severity: 1,
                  message: "prefer-const: 'x' is never reassigned",
                  line: 12,
                  column: 1
                }
              ]
            }
          ])
        }) as never
    );
    fsMock.readFileSync.mockImplementation((path: string) =>
      /[\\/]\.peaks[\\/]lint[\\/]baseline\.json$/.test(path)
        ? JSON.stringify({
            version: 1,
            violations: [
              {
                ruleId: 'prefer-const',
                file: 'src/fixture-default.ts',
                line: 12,
                severity: 1,
                message: "prefer-const: 'x' is never reassigned"
              }
            ]
          })
        : missingFile(path)
    );

    // when: parseAsync runs `lint baseline --json` with no baseline flag
    await program.parseAsync(['lint', 'baseline', '--json'], { from: 'user' });

    // then: the default baseline still governs the read side (tuple waived)
    expect(readWrittenBaseline().violations).toEqual([]);
    expect(
      fsMock.readFileSync.mock.calls.some((call) =>
        /[\\/]\.peaks[\\/]lint[\\/]baseline\.json$/.test(String(call[0]))
      )
    ).toBe(true);
  });
});
