/**
 * Tests for the best-effort close helper used by `peaks progress close`
 * and the watch-side auto-exit. The helper is best-effort by design: it
 * must NEVER throw, and it must treat "ran but found nothing" as a silent
 * miss rather than a warning.
 *
 * The bug this file exists to prevent: macOS pkill exits 1 (no match) but
 * writes nothing to stderr. execFile's `error.message` is then
 * "Command failed: pkill -f ..." — and the original regex-only filter
 * (`/no.*process/i`) never matches, so a clean "no process to kill"
 * outcome was reported as a warning. The fix is to also accept numeric
 * exit codes for the silent-miss path.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// Mock child_process.execFile BEFORE importing the module under test.
const execFileMock = vi.fn();
vi.mock('node:child_process', () => ({
  execFile: (..._args: unknown[]) => execFileMock(..._args)
}));

import { killSpawnedTerminal } from '../../src/cli/commands/progress-close-kill.js';
import type { ProgressSpawnRecord } from '../../src/services/progress/progress-service.js';

const BASE_RECORD: ProgressSpawnRecord = {
  version: 1,
  sessionId: '2026-06-03-session-test',
  pid: 99999,
  platform: 'darwin',
  command: 'osascript',
  args: ['-e', 'tell application "Terminal" to do script "..."'],
  spawnedAt: '2026-06-03T08:55:00.000Z',
  windowTitle: 'peaks-cli: sub-agent progress — rid-test (rd)'
};

const PROJECT_ROOT = '/private/var/folders/test/peaks-close-kill';

beforeEach(() => {
  execFileMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('killSpawnedTerminal — macOS pkill exit-code semantics', () => {
  test('pkill exit 1 (no processes matched) is a silent miss, not a warning', async () => {
    // pkill on macOS exits 1 with empty stderr when no process
    // matches the pattern. That is the "watch already closed itself"
    // outcome and must NOT surface as a warning.
    execFileMock.mockImplementation((_cmd: string, _args: readonly string[], cb: (err: Error | null) => void) => {
      const err = new Error('Command failed: pkill -f progress watch.*--project /tmp/x') as Error & {
        code?: number | string;
        stderr?: string;
      };
      err.code = 1;
      err.stderr = '';
      cb(err);
    });

    const result = await killSpawnedTerminal(BASE_RECORD, PROJECT_ROOT, 'darwin');

    expect(result.warnings).toEqual([]);
    // The osascript branch is a separate try/catch (not via
    // trySignal), and is mocked here to exit 1 — we treat that
    // as silent too. So no signals are reported in this scenario.
    expect(result.signals).toEqual([]);
  });

  test('pkill exit 1 AND osascript exit 1 produce zero warnings (full clean close)', async () => {
    // Simulates: the watch process is already gone (pkill miss)
    // and the Terminal.app window is already gone (osascript
    // miss). Both are silent.
    execFileMock.mockImplementation((cmd: string, _args: readonly string[], cb: (err: Error | null) => void) => {
      const err = new Error(`Command failed: ${cmd}`) as Error & {
        code?: number | string;
        stderr?: string;
      };
      err.code = 1;
      err.stderr = '';
      cb(err);
    });

    const result = await killSpawnedTerminal(BASE_RECORD, PROJECT_ROOT, 'darwin');
    expect(result.warnings).toEqual([]);
    expect(result.signals).toEqual([]);
  });

  test('pkill exit 0 + osascript exit 0 reports both signals with zero warnings', async () => {
    execFileMock.mockImplementation((_cmd: string, _args: readonly string[], cb: (err: Error | null) => void) => {
      cb(null);
    });

    const result = await killSpawnedTerminal(BASE_RECORD, PROJECT_ROOT, 'darwin');
    expect(result.warnings).toEqual([]);
    expect(result.signals).toContain('pkill-watch');
    expect(result.signals).toContain('osascript-close-window');
  });

  test('pkill exit 2 (syntax error) IS reported as a warning', async () => {
    execFileMock.mockImplementation((cmd: string, _args: readonly string[], cb: (err: Error | null) => void) => {
      const err = new Error(`Command failed: ${cmd} -f ...`) as Error & {
        code?: number | string;
        stderr?: string;
      };
      err.code = 2;
      err.stderr = 'invalid pattern';
      cb(err);
    });

    const result = await killSpawnedTerminal(BASE_RECORD, PROJECT_ROOT, 'darwin');
    // pkill exit 2 = syntax error, real warning. osascript is
    // also called and mocked to exit 1 (silent). So the only
    // warning should be the pkill one.
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/^pkill:/);
  });
});

describe('killSpawnedTerminal — Linux wmctrl exit-code semantics', () => {
  test('wmctrl missing (exit 127) is a silent miss', async () => {
    execFileMock.mockImplementation((cmd: string, _args: readonly string[], cb: (err: Error | null) => void) => {
      if (cmd === 'pkill') {
        // pkill exit 0 = matched a real watch process
        cb(null);
        return;
      }
      // wmctrl: exit 127 = command not found
      const err = new Error('Command failed: wmctrl -c peaks-cli-progress') as Error & {
        code?: number | string;
        stderr?: string;
      };
      err.code = 127;
      err.stderr = 'wmctrl: command not found\n';
      cb(err);
    });

    const result = await killSpawnedTerminal(BASE_RECORD, PROJECT_ROOT, 'linux');
    expect(result.warnings).toEqual([]);
    expect(result.signals).toContain('pkill-watch');
    expect(result.signals).not.toContain('wmctrl-close-class');
  });

  test('wmctrl exit 0 reports wmctrl-close-class signal', async () => {
    execFileMock.mockImplementation((_cmd: string, _args: readonly string[], cb: (err: Error | null) => void) => {
      cb(null);
    });
    const result = await killSpawnedTerminal(BASE_RECORD, PROJECT_ROOT, 'linux');
    expect(result.signals).toEqual(['pkill-watch', 'wmctrl-close-class']);
    expect(result.warnings).toEqual([]);
  });
});

describe('killSpawnedTerminal — Windows taskkill exit-code semantics', () => {
  test('taskkill exit 1 (no tasks matched) is a silent miss', async () => {
    execFileMock.mockImplementation((_cmd: string, _args: readonly string[], cb: (err: Error | null) => void) => {
      const err = new Error('Command failed: taskkill ...') as Error & {
        code?: number | string;
        stderr?: string;
      };
      err.code = 1;
      err.stderr = 'INFO: No tasks are running which match the specified criteria.\n';
      cb(err);
    });
    const result = await killSpawnedTerminal(BASE_RECORD, PROJECT_ROOT, 'win32');
    expect(result.warnings).toEqual([]);
    expect(result.signals).toEqual([]);
  });
});

describe('killSpawnedTerminal — unsupported platform', () => {
  test('reports the platform as a warning and returns no signals', async () => {
    const result = await killSpawnedTerminal(BASE_RECORD, PROJECT_ROOT, 'aix' as NodeJS.Platform);
    expect(result.signals).toEqual([]);
    expect(result.warnings).toEqual(['unsupported platform: aix']);
    expect(execFileMock).not.toHaveBeenCalled();
  });
});
