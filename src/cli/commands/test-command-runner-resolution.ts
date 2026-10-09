// src/cli/commands/test-command-runner-resolution.ts
//
// Where `peaks test` finds the consumer project's runner, and the argv it
// hands it. Split out of `test-commands.ts`; every probe order, preference
// rule and platform branch is unchanged.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { TestFramework } from '../../services/test-cache/test-cache-service.js';

export const FRAMEWORKS: TestFramework[] = ['jest', 'vitest', 'mocha'];

/**
 * Build the argv for the underlying test runner. This is the SINGLE
 * source of truth for "peaks test drops --no-cache from the
 * consumer's script" (G7 / NG7). `--cache` is always passed
 * unless the user explicitly opts in to `--no-cache` or `--passthrough`.
 */
export function buildRunnerArgv(
  framework: TestFramework,
  patterns: string[],
  options: { all?: boolean; changed?: boolean; cache?: boolean; passthrough?: boolean }
): string[] {
  if (options.passthrough) {
    // Caller has explicitly chosen to honor the consumer's argv;
    // we still pass the patterns so the runner filters to them.
    if (framework === 'jest') return [...patterns, '--no-cache'];
    if (framework === 'vitest') return ['run', ...patterns];
    return [...patterns];
  }
  if (framework === 'jest') {
    const argv: string[] = [...patterns];
    if (options.all) argv.push('--passWithNoTests');
    if (options.changed) argv.push('--changedSince=HEAD');
    // Commander's `.option('--no-cache')` sets `opts.cache` (BASE name) to
    // `false` when the flag is passed; `opts.cache` is `true` by default.
    // The default-mode invariant (G7/NG7) is `--cache`; the explicit
    // override is `--no-cache`. Inverted from the previous wording
    // because `options = {}` made the read side `!== true` and silently
    // flipped every default-mode jest/vitest run to `--no-cache`.
    if (options.cache === false) argv.push('--no-cache');
    else argv.push('--cache');
    return argv;
  }
  if (framework === 'vitest') {
    const argv = ['run', ...patterns];
    if (options.changed) argv.push('--changed');
    if (options.cache === false) argv.push('--no-cache');
    else argv.push('--cache');
    return argv;
  }
  // mocha — no built-in --cache flag; we just pass the patterns.
  return [...patterns];
}

/** Successful resolution — everything `spawn` needs, plus provenance. */
export type RunnerFound = {
  ok: true;
  /** Executable to spawn: node itself, a local shim, or a PATH hit. */
  command: string;
  /** argv for `command` (includes the JS entry when spawning node). */
  args: string[];
  /** How the runner was found — named in the PATH-fallback notice. */
  via: string;
  /** True only for the PATH fallback, which the caller surfaces visibly. */
  fromPath: boolean;
};

export type RunnerResolution = RunnerFound | { ok: false; searched: string[] };

/** Injection seams for tests — production passes nothing. */
export type ResolveRunnerDeps = {
  platform?: NodeJS.Platform;
  existsSync?: (path: string) => boolean;
  readFileSync?: (path: string) => string;
  env?: NodeJS.ProcessEnv;
  /** Node executable used to run the runner's JS entry. */
  nodeExecPath?: string;
};

/** `<pkg>/package.json#bin`, resolved to the absolute JS entry it points at. */
function readBinEntry(
  pkgJsonPath: string,
  name: string,
  read: (path: string) => string
): string | null {
  let pkg: { bin?: string | Record<string, string> } = {};
  try {
    pkg = JSON.parse(read(pkgJsonPath)) as typeof pkg;
  } catch {
    // Not fatal: fall through to the `.bin` shim below, and the not-found
    // error still names this package.json in `searched`.
    pkg = {};
  }
  const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[name];
  if (typeof rel !== 'string' || rel.length === 0) return null;
  return resolve(dirname(pkgJsonPath), rel);
}

/**
 * Convert a resolved executable + argv into a form `spawn` can launch with
 * `shell: false`.
 *
 * A Windows `.cmd`/`.bat` shim cannot be spawned directly (spawn → EINVAL).
 * The obvious fix, `spawn(shim, argv, { shell: true })`, re-splits argv inside
 * cmd.exe: a pattern `tests/a b/x.test.ts` arrives as THREE args (measured).
 * Invoking cmd.exe ourselves with `/d /s /c` keeps argv intact.
 */
function toSpawnable(
  exe: string,
  argv: string[],
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv
): { command: string; args: string[] } {
  if (platform === 'win32' && /\.(?:cmd|bat)$/i.test(exe)) {
    return { command: env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', exe, ...argv] };
  }
  return { command: exe, args: argv };
}

/** Spawnable PATH hits, in preference order (`where`/`which` avoided so this
 * stays in-process and testable). */
function resolveFromPath(
  name: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  exists: (path: string) => boolean
): string | null {
  const dirs = (env.PATH ?? '').split(platform === 'win32' ? ';' : ':').filter((d) => d.length > 0);
  const exts = platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, name + ext);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Step 1 of the probe: the project-local `<root>/node_modules/.bin/<runner>`
 * shim (plus `.cmd`/`.exe` on Windows). Every candidate is recorded in
 * `searched`, in probe order, so the not-found message names them all.
 */
function probeLocalShim(
  framework: TestFramework,
  where: {
    readonly projectRoot: string;
    readonly platform: NodeJS.Platform;
    readonly exists: (path: string) => boolean;
    readonly searched: string[];
  }
): string | null {
  const binDir = join(where.projectRoot, 'node_modules', '.bin');
  const exts = where.platform === 'win32' ? ['.cmd', '.exe'] : [''];
  let shim: string | null = null;
  for (const ext of exts) {
    const candidate = join(binDir, framework + ext);
    where.searched.push(candidate);
    if (shim === null && where.exists(candidate)) shim = candidate;
  }
  return shim;
}

/**
 * Resolve the consumer project's LOCAL runner, and the form of it that
 * `spawn` can actually launch on this platform.
 *
 * Probed, in order (every probe is reported when nothing is found):
 *   1. `<root>/node_modules/.bin/<runner>` (+ `.cmd`/`.exe` on Windows) —
 *      the project-local runner the command documents.
 *   2. `<root>/node_modules/<runner>/package.json` → its `bin` JS entry.
 *   3. PATH — last resort only; the caller prints a visible notice.
 *
 * Between 1 and 2 the **JS entry** wins: `spawn` runs it as
 * `node <entry> …`, which is identical on Windows and POSIX and never
 * routes argv through a shell. The `.cmd` shim is only a fallback because
 * it needs cmd.exe to launch it (see `toSpawnable`).
 */
export function resolveRunner(
  framework: TestFramework,
  argv: string[],
  projectRoot: string,
  deps: ResolveRunnerDeps = {}
): RunnerResolution {
  const platform = deps.platform ?? process.platform;
  const exists = deps.existsSync ?? existsSync;
  const read = deps.readFileSync ?? ((path: string) => readFileSync(path, 'utf8'));
  const env = deps.env ?? process.env;
  const nodeExec = deps.nodeExecPath ?? process.execPath;
  const searched: string[] = [];

  // 1. Project-local `.bin` shim.
  const shim = probeLocalShim(framework, { projectRoot, platform, exists, searched });

  // 2. Project-local package entry.
  const pkgJsonPath = join(projectRoot, 'node_modules', framework, 'package.json');
  searched.push(pkgJsonPath);
  const entry = exists(pkgJsonPath) ? readBinEntry(pkgJsonPath, framework, read) : null;

  if (entry !== null && exists(entry)) {
    return {
      ok: true,
      command: nodeExec,
      args: [entry, ...argv],
      via: `local ${entry}`,
      fromPath: false
    };
  }
  if (shim !== null) {
    return {
      ok: true,
      ...toSpawnable(shim, argv, platform, env),
      via: `local ${shim}`,
      fromPath: false
    };
  }

  // 3. PATH — last resort.
  const onPath = resolveFromPath(framework, platform, env, exists);
  searched.push(`PATH lookup for "${framework}"`);
  if (onPath !== null) {
    return {
      ok: true,
      ...toSpawnable(onPath, argv, platform, env),
      via: `PATH: ${onPath}`,
      fromPath: true
    };
  }

  return { ok: false, searched };
}

/** Actionable message for the no-runner case — never a raw ENOENT. */
export function formatRunnerNotFound(framework: TestFramework, searched: string[]): string {
  return [
    `RUNNER_NOT_FOUND: no ${framework} runner found for this project. Looked for:`,
    ...searched.map((p) => `  - ${p}`),
    `Install it (e.g. \`npm i -D ${framework}\`) or pass --framework <name>.`
  ].join('\n');
}
