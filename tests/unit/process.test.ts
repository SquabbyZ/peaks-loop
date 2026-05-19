import { beforeEach, describe, expect, test, vi } from 'vitest';

const execMock = vi.fn((command: string, options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
  callback(null, `exec:${command}`, '');
});

let execFileError: Error | null = null;

const execFileMock = vi.fn((command: string, args: string[], options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
  callback(execFileError, `execFile:${command}:${args.join('|')}`, '');
});

vi.mock('node:child_process', () => ({
  exec: execMock,
  execFile: execFileMock
}));

const { execCommand } = await import('../../src/shared/process.js');

describe('execCommand', () => {
  beforeEach(() => {
    execFileError = null;
    execMock.mockClear();
    execFileMock.mockClear();
  });

  test('executes commands without invoking a shell', async () => {
    const output = await execCommand('git', ['clone', 'https://example.com/repo.git', 'C:\\Temp\\repo with spaces']);

    expect(output).toBe('execFile:git:clone|https://example.com/repo.git|C:\\Temp\\repo with spaces');
    expect(execFileMock).toHaveBeenCalledWith(
      'git',
      ['clone', 'https://example.com/repo.git', 'C:\\Temp\\repo with spaces'],
      { cwd: undefined, env: undefined },
      expect.any(Function)
    );
    expect(execMock).not.toHaveBeenCalled();
  });

  test('passes cwd and env separately from command arguments', async () => {
    const env = { GIT_CONFIG_COUNT: '1' } as NodeJS.ProcessEnv;

    await execCommand('git', ['fetch', 'origin'], { cwd: 'C:\\Temp\\repo with spaces', env });

    expect(execFileMock).toHaveBeenCalledWith(
      'git',
      ['fetch', 'origin'],
      { cwd: 'C:\\Temp\\repo with spaces', env },
      expect.any(Function)
    );
  });

  test('rejects when execFile fails', async () => {
    execFileError = new Error('git failed');

    await expect(execCommand('git', ['status'])).rejects.toThrow('git failed');
  });
});
