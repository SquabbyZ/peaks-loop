// tests/unit/services/lint/ocr-18-acquire.test.ts
//
// The acquisition itself: what it spawns, on which stream, under which lock,
// and what it answers when the install does not land.
//
// `spawnSync` is mocked at the module boundary — a real acquisition fetches a
// package from the npm registry and is nobody's test side effect. The shell is
// injected rather than resolved here, so these tests exercise the SPAWN and the
// LOCK, not the preference order (which `ocr-18-acquire-shell.test.ts` owns).
//
// VISIBILITY is the requirement, and it is also the observable a unit test
// CANNOT assert: no test can see whether a human watched progress. What is
// asserted instead is the mechanism that makes it visible — the installer's
// stdio is inherited, so its output lands on the caller's own stream, and
// `detached` is absent, so it is not a background install. The desktop window
// itself is out of reach from here; say that rather than pretend otherwise.
//
// Dimensions covered:
//   - behavior:    the lock protocol, and an outcome (never a throw) on every path
//   - integration: real lock files on disk, real rename/unlink, real process ids
//   - a11y:        the named failure codes and the pre-download warning a human reads
//   - render:      not applicable (the module returns a typed outcome; the verb renders it)

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';

declareDimensions('tests/unit/services/lint/ocr-18-acquire.test.ts', [
  'behavior',
  'integration',
  'a11y',
], [{ dim: 'render', reason: 'the module returns a typed outcome; the CLI verb renders it' }]);

const childMock = vi.hoisted(() => ({ spawnSync: vi.fn() }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawnSync: childMock.spawnSync };
});

import {
  ACQUIRE_NETWORK_WARNING,
  acquireCommandArgs,
  acquireCommandLine,
  acquireOcr18,
  acquireOcrLock,
  ocrAcquireLockPath,
  releaseOcrLock,
  type AcquireOutcome,
  type AcquireShell,
} from '../../../../src/services/lint/ocr-18-acquire.js';
import { OCR_18_PACKAGE } from '../../../../src/services/lint/ocr-multilang-adapter.js';

const BASH: AcquireShell = {
  kind: 'bash',
  path: 'C:\\Program Files\\Git\\bin\\bash.exe',
  note: 'bash: C:\\Program Files\\Git\\bin\\bash.exe (Git Bash located at pinned or default path)',
};

const POWERSHELL: AcquireShell = {
  kind: 'powershell',
  path: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  note: 'PowerShell: … — Git Bash is absent on this host',
};

const DIRECT: AcquireShell = {
  kind: 'direct',
  path: null,
  note: 'no shell: this host has neither Git Bash nor PowerShell, so npx is launched directly',
};

/** A pid no OS will ever hand out, so `isProcessAlive` answers false. */
const DEAD_PID = 2_147_483_646;

const ws = withTmpWorkspacePerTest('peaks-ocr18-acquire-');
const HOME_KEYS = ['HOME', 'USERPROFILE'] as const;
const savedEnv = new Map<string, string | undefined>();

/** A spawn body the module accepts as "the installer exited 0". */
const EXIT_OK = { status: 0, stdout: null, stderr: null };

/**
 * Everything either effect did, in the order it happened. One array shared by
 * the stderr spy and the spawn mock is what makes "the warning came FIRST"
 * assertable rather than merely plausible.
 */
const events: string[] = [];

function writeLock(body: unknown): void {
  const target = ocrAcquireLockPath();
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, typeof body === 'string' ? body : JSON.stringify(body));
}

beforeEach(() => {
  events.length = 0;
  childMock.spawnSync.mockReset();
  childMock.spawnSync.mockReturnValue(EXIT_OK);
  // The acquisition announces the network wait on stderr; in a test that is
  // noise, so it is captured instead of printed — and kept, because one test
  // asserts it happens at all.
  vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
    events.push(String(chunk).trim());
    return true;
  }) as typeof process.stderr.write);
  for (const key of HOME_KEYS) savedEnv.set(key, process.env[key]);
  // The lock is machine-global (`<homedir>/.peaks/ocr/install.lock`); relocating
  // the home is the only way it lands in the workspace rather than on the
  // machine really running the suite.
  for (const key of HOME_KEYS) process.env[key] = ws().path;
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of HOME_KEYS) {
    const previous = savedEnv.get(key);
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
  savedEnv.clear();
});

describe('behavior — the stdio the installer is handed', () => {
  it('should inherit the installer stdio, so npm progress lands on the caller stream', async () => {
    // when: the acquisition runs for a human caller
    const outcome = await acquireOcr18({ shell: BASH });

    // then: inherited stdio — the wait is visible, not swallowed into a pipe
    expect(outcome.ok).toBe(true);
    const options = childMock.spawnSync.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(options['stdio']).toBe('inherit');
    // then: `windowsHide` complements visibility rather than hiding it — it stops
    // Windows allocating a NEW window, which is the one the user saw pop up.
    expect(options['windowsHide']).toBe(true);
    // then: not a background install — `detached` is the thing that was rejected
    expect(options['detached']).toBeUndefined();
  });

  it('should keep stdout clean in --json mode and still inherit stderr', async () => {
    // when: the caller will print a JSON envelope onto the same stdout
    await acquireOcr18({ shell: BASH, asJson: true });

    // then: npm cannot write into the envelope, while its progress (which npm
    // puts on stderr) still reaches the terminal
    const options = childMock.spawnSync.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(options['stdio']).toEqual(['ignore', 'ignore', 'inherit']);
  });
});

describe('a11y — the network warning a human reads before the block', () => {
  it('should warn BEFORE the blocking spawn, never silently', async () => {
    // given: the order in which the two effects fire
    childMock.spawnSync.mockImplementation(() => {
      events.push('spawn');
      return EXIT_OK;
    });

    // when: the acquisition runs
    const outcome = await acquireOcr18({ shell: BASH });

    // then: the warning precedes the block — the only point at which "before"
    // still exists
    expect(events[0]).toContain(ACQUIRE_NETWORK_WARNING);
    expect(events[1]).toBe('spawn');
    expect(outcome.warnings).toEqual([ACQUIRE_NETWORK_WARNING]);
  });
});

describe('behavior — the shell the installer runs through', () => {
  it('should run through bash with -c when Git Bash was chosen', async () => {
    await acquireOcr18({ shell: BASH });

    expect(childMock.spawnSync.mock.calls[0]?.[0]).toBe(BASH.path);
    expect(childMock.spawnSync.mock.calls[0]?.[1]).toEqual(['-c', acquireCommandLine()]);
  });

  it('should run through PowerShell with a non-interactive flag when Git Bash was absent', async () => {
    await acquireOcr18({ shell: POWERSHELL });

    expect(childMock.spawnSync.mock.calls[0]?.[0]).toBe(POWERSHELL.path);
    // `-NonInteractive` is deliberate: a prompt is the hang this verb must not
    // produce, so it must fail rather than wait for an answer nobody can give.
    expect(childMock.spawnSync.mock.calls[0]?.[1]).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      acquireCommandLine(),
    ]);
  });

  it('should spawn without a shell when there is none, carrying the same argv', async () => {
    // when: the last-resort branch
    await acquireOcr18({ shell: DIRECT });

    // then: no shell flag rides along, and the acquire argv is intact at the end
    const argv = childMock.spawnSync.mock.calls[0]?.[1] as string[];
    expect(argv).not.toContain('-c');
    expect(argv).not.toContain('-Command');
    expect(argv.slice(-acquireCommandArgs().length)).toEqual([...acquireCommandArgs()]);
  });

  it('should pin the pinned package and the non-interactive --yes in the argv', () => {
    // `--yes` is what turns "Ok to proceed?" — a prompt on a fresh machine —
    // into an install that finishes on its own.
    expect(acquireCommandArgs()).toEqual(['--yes', '--package', OCR_18_PACKAGE, '--', 'ocr', 'version']);
    // Every token quoted: a bare `@alibaba-group/…` is PowerShell array syntax.
    expect(acquireCommandLine()).toBe(
      ['npx', ...acquireCommandArgs()].map((token) => `"${token}"`).join(' ')
    );
  });
});

describe('integration — the machine-global acquisition lock', () => {
  it('should refuse when another acquisition holds a live lock, and spawn nothing', async () => {
    // given: a held lock owned by this (living) process
    writeLock({ pid: process.pid, startedAt: new Date().toISOString() });

    // when: a second acquisition asks
    const outcome = await acquireOcr18({ shell: BASH });

    // then: a named refusal, and no second installer started
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('OCR18_ACQUIRE_BUSY');
    expect(childMock.spawnSync).not.toHaveBeenCalled();
  });

  it('should not run a second installer when a second acquisition starts inside the first', async () => {
    // given: the lock is held for exactly as long as the installer runs, so the
    // interleave is reproduced from inside the first call's spawn
    let nested: Promise<AcquireOutcome> | null = null;
    childMock.spawnSync.mockImplementation(() => {
      nested = acquireOcr18({ shell: BASH });
      return EXIT_OK;
    });

    // when: the first acquisition is joined by a second at that instant
    const first = await acquireOcr18({ shell: BASH });
    const second = await (nested as Promise<AcquireOutcome> | null);

    // then: exactly one install ran
    expect(first.ok).toBe(true);
    expect(second?.ok).toBe(false);
    expect(second?.code).toBe('OCR18_ACQUIRE_BUSY');
    expect(childMock.spawnSync).toHaveBeenCalledTimes(1);
  });

  it('should reclaim a lock whose owner is dead', async () => {
    // given: a lock left behind by a process that is gone
    writeLock({ pid: DEAD_PID, startedAt: new Date().toISOString() });

    // when: a new acquisition asks
    const outcome = await acquireOcr18({ shell: BASH });

    // then: it proceeds rather than waiting out a 30-minute stale window
    expect(outcome.ok).toBe(true);
    expect(childMock.spawnSync).toHaveBeenCalledTimes(1);
  });

  it('should reclaim a lock whose body cannot be read', async () => {
    // given: a half-written body — an unreadable lock proves no live owner
    writeLock('{"pid": ');

    // when: a new acquisition asks
    const outcome = await acquireOcr18({ shell: BASH });

    // then: it proceeds
    expect(outcome.ok).toBe(true);
  });

  it('should release the lock on success, on a non-zero exit, and on a thrown spawn', async () => {
    // given: the three paths a lock must survive
    const cases: ReadonlyArray<[string, () => unknown]> = [
      ['exit 0', () => EXIT_OK],
      ['exit 1', () => ({ status: 1, stdout: null, stderr: null })],
      [
        'thrown spawn',
        () => {
          throw new Error('spawn EPERM');
        },
      ],
    ];

    for (const [label, result] of cases) {
      childMock.spawnSync.mockReset();
      childMock.spawnSync.mockImplementation(result);

      // when: the acquisition runs down that path
      await acquireOcr18({ shell: BASH });

      // then: the lock is gone — a leaked lock would block the next 30 minutes
      expect(existsSync(ocrAcquireLockPath()), label).toBe(false);
    }
  });

  it('should round-trip acquireOcrLock / releaseOcrLock for a direct caller', () => {
    // when: the lock is taken and released explicitly
    expect(acquireOcrLock()).toBe(true);
    expect(acquireOcrLock()).toBe(false);
    releaseOcrLock();

    // then: the next caller finds it free again
    expect(acquireOcrLock()).toBe(true);
    releaseOcrLock();
  });
});

describe('a11y — a failed install is a named outcome, never a silent throw', () => {
  it('should name a non-zero exit rather than throwing', async () => {
    childMock.spawnSync.mockReturnValue({ status: 7, stdout: null, stderr: null });

    const outcome = await acquireOcr18({ shell: BASH });

    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('OCR18_ACQUIRE_FAILED');
    expect(outcome.message).toContain('status 7');
    expect(outcome.shell.kind).toBe('bash');
  });

  it('should give a timeout its own code, so "never hang" is checkable', async () => {
    childMock.spawnSync.mockReturnValue({
      status: null,
      error: Object.assign(new Error('spawnSync ETIMEDOUT'), { code: 'ETIMEDOUT' }),
    });

    const outcome = await acquireOcr18({ shell: BASH });

    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('OCR18_ACQUIRE_TIMEOUT');
  });

  it('should report the failure as its own outcome even when the spawn throws', async () => {
    childMock.spawnSync.mockImplementation(() => {
      throw new Error('spawn EPERM');
    });

    const outcome = await acquireOcr18({ shell: BASH });

    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('OCR18_ACQUIRE_FAILED');
    expect(outcome.message).toContain('spawn EPERM');
  });
});
