/**
 * Shared fixtures for the G2 matrix tests.
 *
 * `peaks design check` never spawns the real designlang in a unit test, so every
 * side effect it owns is injected as a `DesignEngineDeps` record. This module
 * builds that record (`fakeEngine`), writes the small `.mjs` entries the
 * subprocess arms run (print, exit, sleep), and owns the temp trees the arms
 * adopt so one `disposeFixtures()` reaps everything a failing test leaked.
 *
 * The start-server fixture spawns `process.execPath` directly and reaps it with
 * `child.kill('SIGKILL')` rather than the production `taskkill` tree kill: the
 * fixture is one process with no shell parent, and `taskkill` process
 * enumeration is tens of seconds on this host (see `_setup/subprocess-timeouts`
 * for the measurement). "Reaps the child" is the property under test, not the
 * production tree-walking implementation.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { DesignEngineDeps } from '../../../src/services/design/design-check-g2.js';
import { initDesignContract } from '../../../src/services/design/design-init.js';
import type { DesignlangRunResult } from '../../../src/services/design/designlang.js';
import type { EngineAvailability } from '../../../src/services/design/engine-status.js';
import type { StartRenderServerResult } from '../../../src/services/design/render-server.js';

/** The loopback URL every fake check renders. */
export const DEFAULT_URL = 'http://127.0.0.1:4321/';

/** A resolved engine with a browser: G2 may run. */
export const AVAILABLE: EngineAvailability = {
  available: true,
  version: '13.4.1',
  entryPath: '/opt/designlang/bin/design-extract.js',
  browserReady: true,
  browserKind: 'system-chrome',
  codes: []
};

/** An engine that did not resolve: G2 must block. */
export const UNAVAILABLE: EngineAvailability = {
  available: false,
  version: null,
  entryPath: null,
  browserReady: false,
  browserKind: null,
  codes: ['DESIGN_ENGINE_UNAVAILABLE']
};

/** The non-empty JSON document a clean check prints. */
export const CLEAN_JSON = JSON.stringify({
  url: DEFAULT_URL,
  generatedAt: '2026-11-23T00:00:00Z'
});

/** How long the fixture waits for a predicate, and for a child to exit. */
const WAIT_TIMEOUT_MS = 5_000;

/** How long the fake start command stays alive before its own exit. */
const START_SLEEP_MS = 60_000;

const roots: string[] = [];
let scripts: string | null = null;
let scriptCount = 0;

function scriptsDir(): string {
  scripts ??= mkdtempSync(join(tmpdir(), 'peaks-design-fake-'));
  return scripts;
}

/** Remove every temp tree and script this module created. */
export function disposeFixtures(): void {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
  if (scripts !== null) rmSync(scripts, { recursive: true, force: true });
  scripts = null;
}

export type FakeScriptOptions = {
  /** Raw text written to stdout. */
  stdout?: string;
  /** Raw text written to stderr. */
  stderr?: string;
  /** Exit code once the script finishes (or after `sleepMs`). */
  exitCode?: number;
  /** Stay alive this long first; 0 exits at once. */
  sleepMs?: number;
};

/** Write a temp `.mjs` entry that prints, exits, or sleeps as asked. */
export function writeFakeScript(name: string, options: FakeScriptOptions = {}): string {
  scriptCount += 1;
  const path = join(scriptsDir(), `${name}-${String(scriptCount)}.mjs`);
  const code = String(options.exitCode ?? 0);
  const sleep = options.sleepMs ?? 0;
  const lastLine =
    sleep > 0
      ? `setTimeout(() => { process.exit(${code}); }, ${String(sleep)});`
      : `process.exit(${code});`;
  writeFileSync(
    path,
    [
      `process.stdout.write(${JSON.stringify(options.stdout ?? '')});`,
      `process.stderr.write(${JSON.stringify(options.stderr ?? '')});`,
      lastLine
    ].join('\n'),
    'utf8'
  );
  return path;
}

/** A `DesignlangRunResult` that exits 0 with clean JSON unless overridden. */
export function runResult(overrides: Partial<DesignlangRunResult> = {}): DesignlangRunResult {
  return { exitCode: 0, stdout: CLEAN_JSON, stderr: '', timedOut: false, ...overrides };
}

/** The injected engine dependencies, with every side effect replaced. */
export function fakeEngine(overrides: Partial<DesignEngineDeps> = {}): DesignEngineDeps {
  return {
    availability: AVAILABLE,
    resolveUrl: () => ({ ok: true, url: DEFAULT_URL, source: 'flag' }),
    probe: async () => true,
    run: async () => runResult(),
    ...overrides
  };
}

/** An adopted app whose G1 scan of one clean page passes. */
export async function createAdoptedApp(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'peaks-design-g2-'));
  roots.push(root);
  mkdirSync(join(root, 'src', 'routes'), { recursive: true });
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ dependencies: { react: '19.0.0' } }),
    'utf8'
  );
  writeFileSync(join(root, 'src', 'main.tsx'), 'export {}', 'utf8');
  writeFileSync(join(root, 'src', 'routes', 'a.tsx'), 'export const A = () => <div />;\n', 'utf8');
  await initDesignContract({ projectRoot: root });
  return root;
}

/** Set `render.startCommand` on the machine-owned engine.json, with its policy. */
export function setStartCommand(root: string, command: string | null): void {
  const path = join(root, 'design', 'engine.json');
  const engine = JSON.parse(readFileSync(path, 'utf8')) as {
    render: { startCommand: string | null; startPolicy: string };
  };
  engine.render.startCommand = command;
  engine.render.startPolicy = command === null ? 'never' : 'on-request';
  writeFileSync(path, JSON.stringify(engine), 'utf8');
}

/** Set `render.startPolicy` alone, so a legacy "never" can be pinned. */
export function setStartPolicy(root: string, policy: 'never' | 'on-request'): void {
  const path = join(root, 'design', 'engine.json');
  const engine = JSON.parse(readFileSync(path, 'utf8')) as {
    render: { startPolicy: string };
  };
  engine.render.startPolicy = policy;
  writeFileSync(path, JSON.stringify(engine), 'utf8');
}

export type FakeStartServer = {
  start: () => Promise<StartRenderServerResult>;
  /** The spawned child's pid, once `start` ran. */
  pid: () => number | null;
  /** True once the check called the handle's `stop()`. */
  stopped: () => boolean;
};

/** A start command that is a real child, so `stop()` reaping is observable. */
export function fakeStartServer(url: string): FakeStartServer {
  let child: ChildProcess | null = null;
  let stopped = false;
  return {
    start: async () => {
      const script = writeFakeScript('start-server', { sleepMs: START_SLEEP_MS });
      child = spawn(process.execPath, [script], {
        stdio: 'ignore',
        windowsHide: true
      });
      return {
        ok: true,
        server: {
          url,
          stop: async () => {
            stopped = true;
            await reap(child);
          }
        }
      };
    },
    pid: () => child?.pid ?? null,
    stopped: () => stopped
  };
}

async function reap(child: ChildProcess | null): Promise<void> {
  if (child === null) return;
  child.kill('SIGKILL');
  await waitForExit(child);
}

function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise<void>((settle) => {
    const onExit = (): void => {
      clearTimeout(timer);
      settle();
    };
    const timer = setTimeout(() => {
      child.off('exit', onExit);
      settle();
    }, WAIT_TIMEOUT_MS);
    child.once('exit', onExit);
  });
}

/** True when a pid still exists. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Poll a predicate until it holds, then resolve; reject at the deadline. */
export function waitUntil(predicate: () => boolean, timeoutMs = WAIT_TIMEOUT_MS): Promise<void> {
  return new Promise<void>((settle, fail) => {
    const deadline = Date.now() + timeoutMs;
    const tick = (): void => {
      if (predicate()) {
        settle();
        return;
      }
      if (Date.now() >= deadline) {
        fail(new Error('condition was not met before the timeout'));
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}
