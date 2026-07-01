/**
 * TDD coverage for scripts/prepublish-build.mjs (v2.14.1).
 *
 * Regression: v2.13.4 partial fix used `spawnSync(cmd, args, { shell: isWindows })`.
 * On Node 22 + Windows native this hits `spawnSync cmd.exe ENOENT` during
 * `npm publish`. v2.14.1 replaces with `execFileSync('pnpm', ['run', 'build'])`
 * (no shell) + Windows ps1-variant fallback.
 *
 * Cases covered:
 *   1. execFile happy path succeeds → exits 0
 *   2. execFile throws + Windows + ps1 exists → ps1 fallback invoked → exits 0
 *   3. execFile throws + Windows + ps1 missing → both fail → exits 1 + stderr
 *   4. execFile throws + POSIX → no fallback attempted → exits 1 + stderr
 *   5. version validation — missing/empty package.json.version → throws
 *   6. spawn error message is surfaced verbatim (regression for v2.13.4 ENOENT)
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// Mock node:child_process at the module level so the dynamic import
// below resolves with our mocked execFileSync. vi.mock is hoisted.
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    execFileSync: vi.fn(),
  };
});

const childProcess = await import('node:child_process');
const mockedExecFileSync = childProcess.execFileSync as unknown as ReturnType<typeof vi.fn>;

const SCRIPT_URL = pathToFileURL(resolve('scripts/prepublish-build.mjs')).href;
const REAL_PROJECT_ROOT = resolve('.');
const REAL_PACKAGE_JSON = resolve('package.json');

interface RunResult {
  exitCode: number | null;
  stderr: string;
  stdout: string;
  error?: Error;
}

/**
 * Run the script with controlled child_process mock. We stub process.exit
 * to throw so the top-level flow bails out deterministically (matches the
 * real Node behavior at module top-level for our linear script).
 */
async function runScript(): Promise<RunResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args: unknown[]) => stdout.push(args.map(String).join(' '));
  console.error = (...args: unknown[]) => stderr.push(args.map(String).join(' '));
  let exitCode: number | null = null;
  let error: Error | undefined;
  const origExit = process.exit;
  process.exit = ((code?: number) => {
    exitCode = typeof code === 'number' ? code : 1;
    throw new Error(`__exit__:${exitCode}`);
  }) as typeof process.exit;
  try {
    // Re-import the script each call so it re-runs its top-level flow.
    // Bypass module cache by appending a unique query string.
    const url = `${SCRIPT_URL}?run=${Math.random().toString(36).slice(2)}`;
    await import(url);
    // Script completed without calling process.exit → success.
    if (exitCode === null) exitCode = 0;
  } catch (e) {
    const msg = (e as Error).message ?? '';
    if (msg.startsWith('__exit__:')) {
      exitCode = Number(msg.slice('__exit__:'.length));
    } else {
      error = e as Error;
      exitCode = exitCode ?? 1;
    }
  } finally {
    process.exit = origExit;
    console.log = origLog;
    console.error = origErr;
  }
  return {
    exitCode,
    stdout: stdout.join('\n'),
    stderr: stderr.join('\n'),
    ...(error ? { error } : {}),
  };
}

let workDir: string;
let originalCwd: string;
let packageJsonBackup: string;
let packageJsonPath: string;

beforeEach(() => {
  originalCwd = process.cwd();
  workDir = mkdtempSync(join(tmpdir(), 'prepublish-test-'));
  process.chdir(workDir);
  packageJsonPath = join(workDir, 'package.json');
  // Snapshot the real package.json so we can restore in afterEach.
  packageJsonBackup = '';
  mockedExecFileSync.mockReset();
});

afterEach(() => {
  process.chdir(originalCwd);
  if (workDir) {
    rmSync(workDir, { recursive: true, force: true });
  }
  // Restore the real package.json if a test wrote a temp one there.
  try {
    if (packageJsonBackup) {
      writeFileSync(REAL_PACKAGE_JSON, packageJsonBackup);
    }
  } catch {
    // ignore — best-effort restore
  }
  vi.restoreAllMocks();
});

/**
 * Write a temp package.json to the REAL project root (where the script
 * resolves from). The script reads `${projectRoot}/package.json`. Backup
 * and restore in afterEach.
 */
function stageProjectPackageJson(version: string): void {
  // Lazy import: avoid loading node:fs at module top so we don't shadow the mock
  // of node:child_process. (fs isn't mocked.)
  const fsActual = require('node:fs') as typeof import('node:fs');
  packageJsonBackup = fsActual.readFileSync(REAL_PACKAGE_JSON, 'utf8');
  fsActual.writeFileSync(
    REAL_PACKAGE_JSON,
    JSON.stringify({ name: 'peaks-loop', version }, null, 2),
  );
}

describe('scripts/prepublish-build.mjs (v2.14.1)', () => {
  test('1. execFile happy path — runs `pnpm run build` and exits 0', async () => {
    stageProjectPackageJson('2.14.1');
    mockedExecFileSync.mockReturnValueOnce(Buffer.from(''));
    const result = await runScript();
    expect(mockedExecFileSync).toHaveBeenCalledTimes(1);
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      'pnpm',
      ['run', 'build'],
      expect.objectContaining({ stdio: 'inherit' }),
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('[prepublish-build] peaks-loop v2.14.1');
    expect(result.stdout).toContain('[prepublish-build] build OK');
    expect(result.stderr).toBe('');
  });

  test('2. execFile throws on Windows + ps1 fallback succeeds → exits 0', async () => {
    stageProjectPackageJson('2.14.1');
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      // Mock existsSync so ps1 is reported as present.
      const fsActual = await vi.importActual<typeof import('node:fs')>('node:fs');
      vi.doMock('node:fs', async () => {
        const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
        return {
          ...actual,
          existsSync: vi.fn(() => true),
          readFileSync: actual.readFileSync,
        };
      });
      mockedExecFileSync
        .mockImplementationOnce(() => {
          throw new Error('spawnSync C:\\Windows\\system32\\cmd.exe ENOENT');
        })
        .mockReturnValueOnce(Buffer.from(''));
      const result = await runScript();
      expect(mockedExecFileSync).toHaveBeenCalledTimes(2);
      expect(mockedExecFileSync).toHaveBeenNthCalledWith(
        1,
        'pnpm',
        ['run', 'build'],
        expect.objectContaining({ stdio: 'inherit' }),
      );
      expect(mockedExecFileSync).toHaveBeenNthCalledWith(
        2,
        'powershell',
        ['-ExecutionPolicy', 'Bypass', '-File', expect.stringContaining('prepublish-build.ps1')],
        expect.objectContaining({ stdio: 'inherit' }),
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('falling back to .ps1');
      expect(result.stdout).toContain('[prepublish-build] build OK');
    } finally {
      Object.defineProperty(process, 'platform', { value: origPlatform });
      vi.doUnmock('node:fs');
    }
  });

  test('3. execFile throws + Windows + ps1 missing → exits 1 + stderr surfaces', async () => {
    stageProjectPackageJson('2.14.1');
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      // Mock existsSync to return false → no fallback.
      vi.doMock('node:fs', async () => {
        const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
        return {
          ...actual,
          existsSync: vi.fn(() => false),
          readFileSync: actual.readFileSync,
        };
      });
      mockedExecFileSync.mockImplementation(() => {
        throw new Error('spawnSync cmd.exe ENOENT');
      });
      const result = await runScript();
      expect(mockedExecFileSync).toHaveBeenCalledTimes(1);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('ENOENT');
    } finally {
      Object.defineProperty(process, 'platform', { value: origPlatform });
      vi.doUnmock('node:fs');
    }
  });

  test('4. execFile throws + POSIX (non-Windows) → no ps1 fallback attempted → exits 1', async () => {
    stageProjectPackageJson('2.14.1');
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    try {
      mockedExecFileSync.mockImplementation(() => {
        throw new Error('spawnSync /bin/sh ENOENT');
      });
      const result = await runScript();
      // On POSIX: no fallback attempted → exactly 1 call (the failing one).
      expect(mockedExecFileSync).toHaveBeenCalledTimes(1);
      expect(mockedExecFileSync).toHaveBeenCalledWith(
        'pnpm',
        ['run', 'build'],
        expect.objectContaining({ stdio: 'inherit' }),
      );
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('spawn failed');
    } finally {
      Object.defineProperty(process, 'platform', { value: origPlatform });
    }
  });

  test('5. package.json with empty version → throws (script never invokes execFileSync)', async () => {
    stageProjectPackageJson('');
    const result = await runScript();
    expect(mockedExecFileSync).not.toHaveBeenCalled();
    // The script throws synchronously before process.exit; our harness
    // treats uncaught throws as exit 1.
    expect(result.exitCode).toBe(1);
  });

  test('6. ENOENT regression — error.message surfaced verbatim in stderr', async () => {
    stageProjectPackageJson('2.14.1');
    const enoentMessage = "spawnSync C:\\Windows\\system32\\cmd.exe ENOENT";
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    try {
      mockedExecFileSync.mockImplementation(() => {
        throw new Error(enoentMessage);
      });
      const result = await runScript();
      expect(result.stderr).toContain(enoentMessage);
      expect(result.exitCode).toBe(1);
    } finally {
      Object.defineProperty(process, 'platform', { value: origPlatform });
    }
  });
});
