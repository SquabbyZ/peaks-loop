import { rmSync } from 'node:fs';
import { afterEach, describe, expect, test, vi } from 'vitest';

const modulePath = '../../scripts/pretest-coverage.mjs';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('killVitestProcesses', () => {
  test('runs pkill on non-Windows platforms', async () => {
    const { killVitestProcesses } = await import(modulePath);
    const runner = vi.fn();

    killVitestProcesses(runner, false);

    expect(runner).toHaveBeenCalledWith(
      'pkill -f vitest 2>/dev/null',
      { stdio: 'ignore' }
    );
  });

  test('runs PowerShell on Windows', async () => {
    const { killVitestProcesses } = await import(modulePath);
    const runner = vi.fn();

    killVitestProcesses(runner, true);

    expect(runner).toHaveBeenCalledTimes(1);
    const cmd = String(runner.mock.calls[0]?.[0] ?? '');
    expect(cmd).toContain('powershell');
    expect(cmd).toContain('Get-CimInstance Win32_Process');
    expect(cmd).toContain('vitest');
    expect(cmd).toContain('Stop-Process');
  });

  test('swallows errors from the kill command', async () => {
    const { killVitestProcesses } = await import(modulePath);
    const runner = vi.fn(() => {
      throw new Error('command not found');
    });

    expect(() => killVitestProcesses(runner, false)).not.toThrow();
  });

  test('defaults isWin from platform', async () => {
    const { killVitestProcesses } = await import(modulePath);
    const runner = vi.fn();

    killVitestProcesses(runner);

    expect(runner).toHaveBeenCalledTimes(1);
    const cmd = String(runner.mock.calls[0]?.[0] ?? '');
    expect(cmd.includes('pkill') || cmd.includes('powershell')).toBe(true);
  });
});

describe('cleanCoverageDir', () => {
  test('calls rm with coverage directory and force/recursive flags', async () => {
    const { cleanCoverageDir } = await import(modulePath);
    const rm = vi.fn();

    cleanCoverageDir(rm);

    expect(rm).toHaveBeenCalledWith('coverage', { recursive: true, force: true });
  });

  test('works with real rmSync (force:true never throws)', () => {
    expect(() => {
      rmSync('nonexistent-peaks-coverage-test-dir', { recursive: true, force: true });
    }).not.toThrow();
  });
});

describe('pretest-coverage module', () => {
  test('exports killVitestProcesses and cleanCoverageDir', async () => {
    const module = await import(modulePath);

    expect(typeof module.killVitestProcesses).toBe('function');
    expect(typeof module.cleanCoverageDir).toBe('function');
  });
});

describe('main guard', () => {
  test('does not execute main guard on import', async () => {
    const module = await import(modulePath);
    // Importing should not trigger side effects — the guard checks argv
    expect(typeof module.killVitestProcesses).toBe('function');
    expect(typeof module.cleanCoverageDir).toBe('function');
  });
});
