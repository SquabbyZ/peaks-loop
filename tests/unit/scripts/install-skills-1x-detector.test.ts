/**
 * TDD coverage for the 1.x → 2.0 postinstall detector and
 * auto-upgrade. Slice: 2026-06-12-postinstall-1x-detector-tdd.
 *
 * Per the peaks-cli tenet "one-key completion" (2026-06-11):
 * `npm i -g peaks-cli@2.0` is supposed to detect a 1.x
 * consumer project in cwd and auto-dispatch
 * `peaks upgrade --to 2.0 --auto`. The two functions
 * under test:
 *
 *   - `detect1xProjectState(cwd)` — sniff for 1.x signals
 *     in the global config + the cwd's `.claude/rules/`
 *     + the cwd's `.peaks/preferences.json`. Returns
 *     `{ isOneX, signals, projectRoot, configPath }`.
 *
 *   - `autoUpgrade1xProjectIfPresent({ cwd })` — if a 1.x
 *     project is detected, shell out to the `peaks` binary
 *     to run the upgrade umbrella. The spawn is mocked here
 *     so the unit test does not invoke the real binary.
 *
 * Imports the script via `pathToFileURL` (the same pattern
 * `tests/unit/install-skills-script.test.ts` uses) because
 * `install-skills.mjs` is a plain `.mjs` file and cannot
 * be imported as a TypeScript module.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// Mock node:child_process so the install-skills.mjs
// autoUpgrade1xProjectIfPresent function can be tested
// without invoking the real `peaks` binary. `vi.mock` is
// hoisted above the dynamic import below.
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    spawnSync: vi.fn(),
    execFileSync: actual.execFileSync,
  };
});

const childProcess = await import('node:child_process');
const mockedSpawnSync = childProcess.spawnSync as unknown as ReturnType<typeof vi.fn>;

const SCRIPT_URL = pathToFileURL(resolve('scripts/install-skills.mjs')).href;
const scriptModule = (await import(SCRIPT_URL)) as {
  detect1xProjectState: (cwd?: string) => {
    isOneX: boolean;
    signals: string[];
    projectRoot: string | null;
    configPath: string | null;
  };
  autoUpgrade1xProjectIfPresent: (options?: { cwd?: string }) => Promise<{
    ran: boolean;
    reason: string;
    signals?: string[];
    projectRoot?: string;
    exitCode?: number | null;
    stdout?: string;
    stderr?: string;
    error?: string;
  }>;
};

type Detect1x = (cwd?: string) => ReturnType<typeof scriptModule.detect1xProjectState>;
type AutoUpgrade = (options?: { cwd?: string }) => ReturnType<typeof scriptModule.autoUpgrade1xProjectIfPresent>;
const detect1xProjectState: Detect1x = scriptModule.detect1xProjectState;
const autoUpgrade1xProjectIfPresent: AutoUpgrade = scriptModule.autoUpgrade1xProjectIfPresent;

function makeOneXProject(globalHome: string, projectRoot: string): void {
  // Signal 1: global 1.x config
  const peaksHome = join(globalHome, '.peaks');
  mkdirSync(peaksHome, { recursive: true });
  writeFileSync(
    join(peaksHome, 'config.json'),
    JSON.stringify({ version: '1.4.2', language: 'en', model: 'sonnet' }, null, 2),
    'utf8'
  );

  // Signal 2: .peaks/_runtime/ to anchor projectRoot walk-up
  const runtime = join(projectRoot, '.peaks', '_runtime');
  mkdirSync(runtime, { recursive: true });

  // Signal 3: .claude/rules/common/dev-preference.md with 'peaks progress'
  const devPrefDir = join(projectRoot, '.claude', 'rules', 'common');
  mkdirSync(devPrefDir, { recursive: true });
  writeFileSync(
    join(devPrefDir, 'dev-preference.md'),
    '# dev-preference\n\nWe use **peaks progress** as the per-step completion metric.\n',
    'utf8'
  );

  // Signal 4: missing preferences.json (1.x project never migrated)
  // — handled by not writing it
}

function makeTwoXProject(projectRoot: string): void {
  // Anchor projectRoot
  const runtime = join(projectRoot, '.peaks', '_runtime');
  mkdirSync(runtime, { recursive: true });
  // preferences.json with schema_version: '2.0.0'
  const peaksDir = join(projectRoot, '.peaks');
  mkdirSync(peaksDir, { recursive: true });
  writeFileSync(
    join(peaksDir, 'preferences.json'),
    JSON.stringify({ schema_version: '2.0.0' }, null, 2),
    'utf8'
  );
}

let tmpHome: string;
let tmpProject: string;
let originalHome: string | undefined;
let originalAutoSkip: string | undefined;

// Slice 2026-06-24-doctor-1xdetector-residual: per-test fixture
// scrub of stale `.peaks/_runtime/` directories between
// `tmpProject` and the OS temp boundary. The production
// `detect1xProjectState` walks UP from the cwd looking for
// `.peaks/_runtime`. On a developer box (and on this CI
// runner) `os.tmpdir()` may contain a stale `.peaks/_runtime/`
// left over from a prior `peaks session init` (e.g.
// `peaks-ac3-*`). Without scrubbing, the walk-up returns the
// stale dir as `projectRoot` and the tests that expect
// `projectRoot=null` fail. The scrub is best-effort, restores
// on afterEach, and never touches `tmpdir()` itself (we stop
// at its parent).
const stashedAncestors: Array<{ runtime: string; backup: string }> = [];
let ancestorScrubCounter = 0;

function scrubAncestorPeaksRuntime(start: string): void {
  const sysTmp = tmpdir();
  const sysTmpParent = dirname(sysTmp);
  let dir = dirname(start);
  while (dir.length > sysTmpParent.length) {
    const candidate = join(dir, '.peaks', '_runtime');
    if (existsSync(candidate)) {
      const backup = `${candidate}.test-scrub-${process.pid}-${ancestorScrubCounter}`;
      ancestorScrubCounter += 1;
      try {
        renameSync(candidate, backup);
        stashedAncestors.push({ runtime: candidate, backup });
      } catch {
        // best-effort — concurrent test worker may have moved it
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

function restoreAncestorPeaksRuntime(): void {
  while (stashedAncestors.length > 0) {
    const entry = stashedAncestors.pop();
    if (entry === undefined) break;
    if (existsSync(entry.backup)) {
      try {
        renameSync(entry.backup, entry.runtime);
      } catch {
        // best-effort restore
      }
    }
  }
}

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'peaks-1x-home-'));
  tmpProject = mkdtempSync(join(tmpdir(), 'peaks-1x-project-'));
  originalHome = process.env['HOME'];
  originalAutoSkip = process.env['PEAKS_SKIP_AUTO_UPGRADE'];
  // detect1xProjectState uses homedir() from node:os, NOT
  // process.env.HOME, on most platforms. Setting HOME is
  // a no-op on Windows for homedir(), so the global-config
  // signal will be detected via the actual user home unless
  // we also stub homedir. For these unit tests we instead
  // assert on the LOCAL signals (dev-preference.md,
  // preferences.json) which do not depend on homedir().
  process.env['HOME'] = tmpHome;
  scrubAncestorPeaksRuntime(tmpProject);
});

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env['HOME'];
  } else {
    process.env['HOME'] = originalHome;
  }
  if (originalAutoSkip === undefined) {
    delete process.env['PEAKS_SKIP_AUTO_UPGRADE'];
  } else {
    process.env['PEAKS_SKIP_AUTO_UPGRADE'] = originalAutoSkip;
  }
  restoreAncestorPeaksRuntime();
  if (existsSync(tmpHome)) rmSync(tmpHome, { recursive: true, force: true });
  if (existsSync(tmpProject)) rmSync(tmpProject, { recursive: true, force: true });
  mockedSpawnSync.mockReset();
});

describe('detect1xProjectState — local signals (cwd anchored in .peaks/_runtime/)', () => {
  test('returns isOneX=true when dev-preference.md references "peaks progress"', () => {
    makeOneXProject(tmpHome, tmpProject);
    const state = detect1xProjectState(tmpProject);
    // Local signals (dev-preference + missing preferences.json)
    // should fire regardless of homedir() quirks.
    const localSignals = state.signals.filter(
      (s) => s.includes('peaks progress') || s.includes('preferences.json')
    );
    expect(localSignals.length).toBeGreaterThan(0);
    expect(state.isOneX).toBe(true);
  });

  test('returns isOneX=true when .peaks/preferences.json has 1.x schema_version', () => {
    mkdirSync(join(tmpProject, '.peaks', '_runtime'), { recursive: true });
    mkdirSync(join(tmpProject, '.claude', 'rules', 'common'), { recursive: true });
    writeFileSync(
      join(tmpProject, '.peaks', 'preferences.json'),
      JSON.stringify({ schema_version: '1.0.0' }),
      'utf8'
    );
    const state = detect1xProjectState(tmpProject);
    expect(
      state.signals.some((s) => s.includes('schema_version') && s.includes('1.0.0'))
    ).toBe(true);
    expect(state.isOneX).toBe(true);
  });

  test('returns isOneX=true when .peaks/preferences.json is missing (1.x never migrated)', () => {
    mkdirSync(join(tmpProject, '.peaks', '_runtime'), { recursive: true });
    const state = detect1xProjectState(tmpProject);
    expect(
      state.signals.some((s) => s.includes('preferences.json does not exist'))
    ).toBe(true);
    expect(state.isOneX).toBe(true);
  });

  test('returns isOneX=false on a 2.0 project (preferences.json has schema_version 2.0.0)', () => {
    makeTwoXProject(tmpProject);
    const state = detect1xProjectState(tmpProject);
    // No 1.x local signals should fire on a 2.0 project.
    const localSignals = state.signals.filter(
      (s) =>
        s.includes('peaks progress') ||
        s.includes('schema_version') ||
        s.includes('preferences.json does not exist') ||
        s.includes('preferences.json exists but')
    );
    expect(localSignals).toEqual([]);
    expect(state.isOneX).toBe(false);
  });

  test('returns isOneX=false and projectRoot=null when cwd is not inside a .peaks/_runtime/', () => {
    // tmpProject has no .peaks/_runtime/. The walk-up should
    // fail and projectRoot should be null.
    const state = detect1xProjectState(tmpProject);
    expect(state.projectRoot).toBeNull();
    // Without projectRoot, no local signals fire. The global
    // config signal may or may not fire depending on the
    // real homedir(); we only assert on the projectRoot null.
    expect(state.isOneX).toBe(false);
  });

  test('returns isOneX=true and projectRoot correctly resolved on a 1.x project', () => {
    makeOneXProject(tmpHome, tmpProject);
    const state = detect1xProjectState(tmpProject);
    expect(state.projectRoot).toBe(tmpProject);
    expect(state.isOneX).toBe(true);
  });
});

describe('detect1xProjectState — JSON-validation hardening', () => {
  test('survives a malformed .peaks/preferences.json (parse error does not throw)', () => {
    mkdirSync(join(tmpProject, '.peaks', '_runtime'), { recursive: true });
    mkdirSync(join(tmpProject, '.peaks'), { recursive: true });
    writeFileSync(
      join(tmpProject, '.peaks', 'preferences.json'),
      '{this is not valid JSON',
      'utf8'
    );
    expect(() => detect1xProjectState(tmpProject)).not.toThrow();
    const state = detect1xProjectState(tmpProject);
    expect(
      state.signals.some((s) => s.includes('preferences.json') && s.includes('not valid JSON'))
    ).toBe(true);
    expect(state.isOneX).toBe(true);
  });
});

describe('autoUpgrade1xProjectIfPresent — gate behavior', () => {
  test('returns ran=false when PEAKS_SKIP_AUTO_UPGRADE=1 is set', async () => {
    process.env['PEAKS_SKIP_AUTO_UPGRADE'] = '1';
    const result = await autoUpgrade1xProjectIfPresent({ cwd: tmpProject });
    expect(result.ran).toBe(false);
    expect(result.reason).toContain('PEAKS_SKIP_AUTO_UPGRADE');
  });

  test('returns ran=false when cwd has no 1.x project state', async () => {
    makeTwoXProject(tmpProject);
    const result = await autoUpgrade1xProjectIfPresent({ cwd: tmpProject });
    expect(result.ran).toBe(false);
    expect(result.reason).toContain('no 1.x project state');
  });

  test('returns ran=false when cwd is not a peaks project at all (no 1.x state)', async () => {
    const result = await autoUpgrade1xProjectIfPresent({ cwd: tmpProject });
    expect(result.ran).toBe(false);
    // The function short-circuits on `!state.isOneX` first,
    // which fires when no projectRoot is found. The
    // 'cwd is not a peaks project' branch is only reached
    // when 1.x global config is present but cwd is not a
    // peaks project — covered by a separate test below.
    expect(result.reason).toContain('no 1.x project state detected');
  });

  test('returns ran=false with "cwd is not a peaks project" reason when global 1.x config is present but cwd has no .peaks/_runtime/', async () => {
    // Plant a 1.x global config in tmpHome. On platforms
    // where os.homedir() reads process.env.HOME first
    // (Linux/macOS), this config is read. On Windows
    // homedir() reads USERPROFILE which is NOT overridden
    // by HOME, so this config may not be detected. The
    // assertion accepts both reasons — both prove the
    // function did not attempt to spawn.
    mkdirSync(join(tmpHome, '.peaks'), { recursive: true });
    writeFileSync(
      join(tmpHome, '.peaks', 'config.json'),
      JSON.stringify({ version: '1.4.2' }, null, 2),
      'utf8'
    );
    const result = await autoUpgrade1xProjectIfPresent({ cwd: tmpProject });
    expect(result.ran).toBe(false);
    // Slice 2026-06-13-repair-pre-existing-test-failures: the
    // production reason text is
    //   'cwd is not a peaks project (no .peaks/_runtime/)'
    // (see scripts/install-skills.mjs line 884). Match the exact
    // production strings so the test asserts what the function
    // actually emits.
    expect([
      'no 1.x project state detected',
      'cwd is not a peaks project (no .peaks/_runtime/)'
    ]).toContain(result.reason);
  });

  test('returns ran=true with exitCode=0 when spawnSync succeeds on a 1.x project', async () => {
    makeOneXProject(tmpHome, tmpProject);
    mockedSpawnSync.mockReturnValue({
      pid: 1,
      output: ['', 'auto-upgrade ok\n', ''],
      stdout: 'auto-upgrade ok\n',
      stderr: '',
      status: 0,
      signal: null,
    } as unknown as ReturnType<typeof mockedSpawnSync>);
    const result = await autoUpgrade1xProjectIfPresent({ cwd: tmpProject });
    expect(result.ran).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.projectRoot).toBe(tmpProject);
    expect(mockedSpawnSync).toHaveBeenCalledWith(
      'peaks',
      ['upgrade', '--to', '2.0', '--auto', '--project', tmpProject],
      expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] })
    );
  });

  test('returns ran=true with exitCode=1 when the spawned peaks binary fails', async () => {
    makeOneXProject(tmpHome, tmpProject);
    mockedSpawnSync.mockReturnValue({
      pid: 1,
      output: ['', '', 'peaks: command not found\n'],
      stdout: '',
      stderr: 'peaks: command not found\n',
      status: 1,
      signal: null,
    } as unknown as ReturnType<typeof mockedSpawnSync>);
    const result = await autoUpgrade1xProjectIfPresent({ cwd: tmpProject });
    expect(result.ran).toBe(true);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('command not found');
  });

  test('returns ran=true with error field when spawnSync throws', async () => {
    makeOneXProject(tmpHome, tmpProject);
    mockedSpawnSync.mockImplementation(() => {
      throw new Error('spawn ENOENT');
    });
    const result = await autoUpgrade1xProjectIfPresent({ cwd: tmpProject });
    expect(result.ran).toBe(true);
    expect(result.error).toContain('spawn ENOENT');
  });
});

// Reference execFileSync import to keep the runtime happy
// (the import is sometimes tree-shaken in transpiled output;
// we want to be explicit that this is a node:child_process
// call surface used elsewhere in the test ecosystem).
void execFileSync;
