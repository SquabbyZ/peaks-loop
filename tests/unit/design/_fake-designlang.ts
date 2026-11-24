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
import type {
  DesignlangCheckKind,
  DesignlangRunResult
} from '../../../src/services/design/designlang.js';
import type { EngineAvailability } from '../../../src/services/design/engine-status.js';
import type { PageProbeResult } from '../../../src/services/design/page-probe.js';
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

/** The value after `flag` in an argv vector, or undefined. */
function argAfter(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
}

/**
 * A clean stdout for one check kind. `drift` echoes the URL and tokens path it
 * was given, exactly as designlang 13.4.1 does (the spike measured it); a fake
 * that invents its own echo would defeat the provenance check under test.
 */
export function cleanStdout(kind: DesignlangCheckKind, args: readonly string[] = []): string {
  const url = args[1] ?? DEFAULT_URL;
  switch (kind) {
    case 'drift': {
      const tokensFile = argAfter(args, '--tokens') ?? join('design', 'tokens.json');
      return JSON.stringify({
        url,
        tokensFile,
        tolerance: 0,
        verdict: 'in-sync',
        driftRatio: 0,
        drifted: [],
        matched: [{ token: 'color.primary', local: '#2563eb', liveMatch: '#2563eb', distance: 0 }],
        unknown: [],
        summary: { total: 1, drifted: 0, matched: 1, unknown: 0 }
      });
    }
    case 'verify-ui':
      return JSON.stringify({
        pass: true,
        onBrand: 99,
        generic: 18,
        genericBand: 'distinct',
        tells: [],
        issues: []
      });
    case 'slop':
      return JSON.stringify({
        url,
        readAt: '2026-11-24T00:00:00.000Z',
        generic: { score: 18, band: 'distinct', flags: [] },
        unreadable: null
      });
    case 'stats':
      return JSON.stringify({ url, fontFamilyCount: 2, typeScale: 4, colors: 5 });
    case 'grade':
      return JSON.stringify({ url, generatedAt: '2026-11-24T00:00:00.000Z', overall: 'A' });
  }
}

/** A drift payload with one drifted token — the real notable-drift shape. */
export function driftedStdout(args: readonly string[]): string {
  const clean = JSON.parse(cleanStdout('drift', args)) as Record<string, unknown>;
  const matched = Array.isArray(clean.matched) ? clean.matched.slice(0, 1) : [];
  return JSON.stringify({
    ...clean,
    verdict: 'notable-drift',
    driftRatio: 0.5,
    drifted: [{ token: 'color.surface', nearestLive: '#ffffff', distance: 9 }],
    matched,
    summary: { total: 2, drifted: 1, matched: 1, unknown: 0 }
  });
}

/** A clean run result for one kind, with any stream or code overridden. */
export function runOfKind(
  kind: DesignlangCheckKind,
  args: readonly string[] = [],
  overrides: Partial<DesignlangRunResult> = {}
): DesignlangRunResult {
  return {
    exitCode: 0,
    stdout: cleanStdout(kind, args),
    stderr: '',
    timedOut: false,
    ...overrides
  };
}

/** A run result with empty stdout unless the caller supplies one. */
export function runResult(overrides: Partial<DesignlangRunResult> = {}): DesignlangRunResult {
  return { exitCode: 0, stdout: '', stderr: '', timedOut: false, ...overrides };
}

/** A usable-page observation any probe call may return. */
export function cleanProbe(url: string): PageProbeResult {
  return {
    ok: true,
    observation: {
      status: 200,
      finalUrl: url,
      textChars: 695,
      hasPasswordField: false,
      fontFamilyCount: 2,
      typeScale: 4,
      paint: { nonModalPct: 5.5, quantisedColours: 1579, luminanceStd: 20.19 },
      pageTitle: 'Ledgerly',
      pageHeadings: ['Reconciliation'],
      elapsedMs: 5_000
    }
  };
}

/** The injected engine dependencies, with every side effect replaced. */
export function fakeEngine(overrides: Partial<DesignEngineDeps> = {}): DesignEngineDeps {
  return {
    availability: AVAILABLE,
    resolveUrl: () => ({ ok: true, url: DEFAULT_URL, source: 'flag' }),
    probe: async () => true,
    probePage: async (url) => cleanProbe(url),
    run: async (kind, request) => runOfKind(kind, request.args),
    ...overrides
  };
}

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

/**
 * True when a pid still names a running process.
 *
 * POSIX `kill(pid, 0)` also succeeds for a child that exited but was not reaped
 * yet (state `Z` on Linux), so the signal probe alone calls a zombie "alive".
 * Linux therefore reads `/proc/<pid>/stat` and treats `Z` as gone; Windows and
 * macOS keep the signal-probe rule unchanged.
 */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch (error) {
    // EPERM: the pid exists but belongs to another user, so it is alive.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
  return !isZombie(pid);
}

/**
 * Linux keeps a dead-but-unwaited child in `/proc`; only its state field tells
 * the truth. `pid (comm) state ...` puts `comm` in the one parenthesis pair, so
 * the state is the first field after the LAST `)`.
 */
function isZombie(pid: number): boolean {
  if (process.platform !== 'linux') return false;
  let stat: string;
  try {
    stat = readFileSync(`/proc/${String(pid)}/stat`, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // The entry vanished between the signal probe and this read: the pid is gone.
    // Any other read failure leaves the signal probe as the only evidence.
    return code === 'ENOENT' || code === 'ENOTDIR';
  }
  const close = stat.lastIndexOf(')');
  if (close < 0) return false;
  return stat
    .slice(close + 1)
    .trim()
    .startsWith('Z');
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
