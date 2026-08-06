import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

interface ChildProcessMock {
  spawnSync: ReturnType<typeof vi.fn>;
}

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn()
}));

const { spawnSync } = await import('node:child_process');
const childMock = { spawnSync } as unknown as ChildProcessMock;

type Capture = {
  stdout: string;
  stderr: string;
  exitCode: number | undefined;
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
      get stdout() { return stdout.join(''); },
      get stderr() { return stderr.join(''); },
      get exitCode() { return process.exitCode; }
    }
  };
}

async function importFresh(): Promise<typeof import('../../../../src/cli/commands/lint-commands.js')> {
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

  it('when invoked with no subcommand, should run the default detect-eslint envelope', async () => {
    // given: a fresh program and a callable io
    const { io, capture } = makeIo();
    const mod = await importFresh();
    const program = new Command();
    mod.registerLintCommands(program, io);
    childMock.spawnSync.mockImplementation(() => ({ status: 0, stdout: '10.8.0\n' } as never));

    // when: the default subcommand runs
    await program.parseAsync(['lint'], { from: 'user' });

    // then: the io receives the detect envelope payload (pinned versions surfaced)
    expect(capture.stdout).toMatch(/"pinnedVersions"/);
    expect(capture.stdout).toMatch(/"state": "ready"/);
  });

  it('when --json is supplied, should print a JSON envelope with state field', async () => {
    // given: a fresh program and a JSON-flagged call
    const { io, capture } = makeIo();
    const mod = await importFresh();
    const program = new Command();
    mod.registerLintCommands(program, io);
    childMock.spawnSync.mockImplementation(() => ({ status: 0, stdout: '10.8.0\n' } as never));

    // when: parseAsync runs the default subcommand with --json
    await program.parseAsync(['lint', '--json'], { from: 'user' });

    // then: stdout must contain parseable JSON
    const out = capture.stdout.trim();
    expect(() => JSON.parse(out)).not.toThrow();
    const parsed = JSON.parse(out) as { data?: { state?: string } };
    expect(parsed.data).toBeDefined();
  });
});
