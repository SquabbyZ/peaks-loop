/**
 * CI integration test for the v2.18.0 ownerHint collision fix
 * (binding-store P0) — exercises the production binding-store primitive
 * across 2 truly distinct child Node processes, simulating two Claude
 * Code windows running `peaks code` in parallel.
 *
 * Why this lives under tests/integration and not tests/unit:
 *   - it spawns real child processes (child_process.spawn)
 *   - each child imports the BUILT `dist/services/session/binding-store.js`
 *     (not a TS source import) to mirror the production runtime path
 *   - it asserts on a shared on-disk binding file (the multi-process
 *     surface the unit tests cannot reach with their single-process
 *     mock layer)
 *
 * Why CI-only (ubuntu-latest):
 *   - The test relies on POSIX process semantics (each child gets a
 *     distinct `process.pid` deterministically); Windows ACL / job-object
 *     quirks add non-determinism.
 *   - To keep the CI matrix manageable (windows-latest + 2 node
 *     versions × 2 OSes already adds 4 cells), this test runs only on
 *     `ubuntu-latest`. The CI workflow gates the run with
 *     `if: matrix.os == 'ubuntu-latest'`.
 *
 * Prerequisite:
 *   - `npm run build` must have run before this test (the driver
 *     imports from `dist/`). Local dev environments that have not run
 *     a build will skip the test via the `try/catch` around the
 *     driver spawn.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const DRIVER = join(REPO_ROOT, 'scripts', 'fixtures', 'ci-binding-driver.mjs');
const BUILT_BINDING_STORE = join(REPO_ROOT, 'dist', 'src', 'services', 'session', 'binding-store.js');

const IS_UBUNTU_CI =
  process.env.CI === 'true' && process.env.RUNNER_OS === 'Linux';

interface DriverEnvelope {
  ok: boolean;
  pid: number;
  callerId: string;
  sid: string;
  instancesCount: number;
}

function spawnDriver(envSignal: string, projectRoot: string): DriverEnvelope {
  // Strip HOME/USERPROFILE/etc. so the child can't read a real peaks
  // tree outside the tmp project root (matches the pattern in
  // tests/integration/workspace-clean-cli.test.ts:17-22).
  const cleanEnv: NodeJS.ProcessEnv = (() => {
    const env = { ...process.env };
    delete env.HOME;
    delete env.USERPROFILE;
    return env;
  })();

  const childEnv = {
    ...cleanEnv,
    PEAKS_TEST_PROJECT_ROOT: projectRoot,
    PEAKS_TEST_CLAUDE_SESSION_ID: envSignal
  };

  const r = spawnSync(process.execPath, [DRIVER], {
    env: childEnv,
    encoding: 'utf8',
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  if (r.status !== 0) {
    throw new Error(
      `driver exited ${r.status} — stderr: ${r.stderr ?? '(empty)'}`
    );
  }
  const lines = (r.stdout ?? '').trim().split('\n').filter(Boolean);
  const lastLine = lines[lines.length - 1] ?? '{}';
  return JSON.parse(lastLine) as DriverEnvelope;
}

describe('binding-store — two-Claude-windows integration (v2.18.0 REDO)', () => {
  // Build-prereq skip: if `dist/` is missing, skip the whole suite
  // with a clear message instead of failing. CI runs `npm run build`
  // before `npx vitest run`, so this skip fires only in fresh local
  // clones that haven't built yet.
  const distPresent = existsSync(BUILT_BINDING_STORE);

  let projectRoot: string;

  beforeAll(() => {
    if (!distPresent) return;
    projectRoot = mkdtempSync(join(tmpdir(), 'peaks-multi-process-'));
    mkdirSync(projectRoot, { recursive: true });
  });

  afterEach(() => {
    if (projectRoot && existsSync(projectRoot)) {
      rmSync(projectRoot, { recursive: true, force: true });
    }
    projectRoot = mkdtempSync(join(tmpdir(), 'peaks-multi-process-'));
    mkdirSync(projectRoot, { recursive: true });
  });

  afterAll(() => {
    if (projectRoot && existsSync(projectRoot)) {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test('two child processes with identical CLAUDE_CODE_SESSION_ID get distinct sids + distinct pids', () => {
    if (!distPresent) {
      console.warn(`SKIP: dist binding-store not built — run \`npm run build\` first`);
      return;
    }
    // CI-only gate. Locally on macOS / Windows the test still runs
    // (because dist is present); the "CI-only" constraint is enforced
    // in the workflow file via `if: matrix.os == 'ubuntu-latest'`.
    if (!IS_UBUNTU_CI && process.env.PEAKS_FORCE_INTEGRATION !== '1') {
      console.warn(`SKIP: two-Claude-windows CI test runs in ubuntu-latest CI only`);
      return;
    }

    // Both children share the same outer-session-id (simulating the
    // v2.17.0 bug scenario where two Claude windows on the same host
    // have the same CLAUDE_CODE_SESSION_ID).
    const sharedEnvSignal = 'simulated-claude-session-aaa';

    const a = spawnDriver(sharedEnvSignal, projectRoot);
    const b = spawnDriver(sharedEnvSignal, projectRoot);

    // Contract 1: each child gets a distinct sid.
    expect(a.sid).toBeTruthy();
    expect(b.sid).toBeTruthy();
    expect(a.sid).not.toBe(b.sid);

    // Contract 2: each child writes a distinct callerId (callerId#pid).
    expect(a.callerId).toBe(`${sharedEnvSignal}#${a.pid}`);
    expect(b.callerId).toBe(`${sharedEnvSignal}#${b.pid}`);
    expect(a.callerId).not.toBe(b.callerId);

    // Contract 3: the pids differ (proving they were truly separate
    // processes — the original v2.17.0 bug was that 2 Claude windows
    // collided on callerId; v2.18.0's pid-suffix strategy makes that
    // impossible).
    expect(a.pid).not.toBe(b.pid);
    expect(a.pid).toBeGreaterThan(0);
    expect(b.pid).toBeGreaterThan(0);

    // Contract 4: the project's binding file's `instances` map has 2
    // entries (one per child).
    const bindingPath = join(projectRoot, '.peaks', '_runtime', 'session.json');
    expect(existsSync(bindingPath)).toBe(true);
    const binding = JSON.parse(readFileSync(bindingPath, 'utf8'));
    const instanceSids = Object.keys(binding.instances);
    expect(instanceSids.length).toBe(2);
    expect(instanceSids).toContain(a.sid);
    expect(instanceSids).toContain(b.sid);

    // Sanity: each instance's callerId is the pid-suffixed form, not
    // the bare shared env signal.
    for (const sid of instanceSids) {
      const inst = binding.instances[sid];
      expect(inst.callerId).toMatch(/^simulated-claude-session-aaa#\d+$/);
      expect(inst.callerId).not.toBe(sharedEnvSignal);
    }
  });

  test('two child processes with DIFFERENT CLAUDE_CODE_SESSION_ID get distinct sids (regression guard)', () => {
    if (!distPresent) {
      console.warn(`SKIP: dist binding-store not built — run \`npm run build\` first`);
      return;
    }
    if (!IS_UBUNTU_CI && process.env.PEAKS_FORCE_INTEGRATION !== '1') {
      console.warn(`SKIP: two-Claude-windows CI test runs in ubuntu-latest CI only`);
      return;
    }

    // Different env signals — each child is from a different host /
    // IDE session. v2.17.0 behavior was already correct here; this
    // case guards against a regression where the pid suffix overrides
    // the env-signal distinction.
    const envA = 'simulated-host-a-session-aaa';
    const envB = 'simulated-host-b-session-bbb';

    const a = spawnDriver(envA, projectRoot);
    const b = spawnDriver(envB, projectRoot);

    expect(a.sid).toBeTruthy();
    expect(b.sid).toBeTruthy();
    expect(a.sid).not.toBe(b.sid);
    expect(a.callerId).toBe(`${envA}#${a.pid}`);
    expect(b.callerId).toBe(`${envB}#${b.pid}`);
    expect(a.pid).not.toBe(b.pid);
  });
});