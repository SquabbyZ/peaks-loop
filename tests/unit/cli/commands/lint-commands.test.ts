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
 */
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>();
  return { ...actual, mkdirSync: vi.fn(), writeFileSync: vi.fn() };
});

const { spawnSync } = await import('node:child_process');
const childMock = { spawnSync } as unknown as ChildProcessMock;

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
});
