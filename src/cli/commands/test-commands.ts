/**
 * `peaks test <pattern...>` — slice 2.5.0 sub-fix B (Prob 2).
 *
 * Wraps the consumer project's test framework (jest / vitest / mocha)
 * with a per-test fingerprint cache. The wrapper:
 *
 *   1. Auto-detects the framework from package.json (devDependencies +
 *      dependencies) via detectTestFramework().
 *   2. Resolves the project-LOCAL runner binary (node_modules) and spawns
 *      that, so the command works where the runner is not on PATH — notably
 *      Windows, where node_modules/.bin/vitest.cmd is not spawnable without
 *      a shell. PATH is a last resort and is reported, not silent.
 *   3. Spawns the framework's CLI with --cache enabled (overriding any
 *      --no-cache in the consumer's `test` script). The user can
 *      opt back into no-cache via `peaks test --no-cache` or
 *      `peaks test --passthrough`.
 *   4. Skips tests where (fileMtime, fileSha256) is unchanged AND the
 *      previous run status was 'passed' (per-test fingerprint cache at
 *      `<projectRoot>/.peaks/_runtime/test-cache/<hash>.json`).
 *   5. Exits 0 on all-pass / all-skip; exits 1 on any failure.
 *
 * The CLI is invoked by USER (not just by skill) per slice 2.5.0
 * sub-fix B (G16) — a documented exception to the
 * dev-preference red-line "no new top-level peaks <cmd>".
 *
 * Sub-commands:
 *   peaks test <pattern...>           — run tests matching the pattern
 *   peaks test --all                  — run the full suite
 *   peaks test --changed              — only files changed since HEAD
 *   peaks test --clear-cache          — empty the fingerprint cache
 *   peaks test --no-cache-result      — bypass the fingerprint cache
 *   peaks test --no-cache             — pass --no-cache to the framework
 *   peaks test --passthrough          — do NOT override the consumer's argv
 *   peaks test --framework <name>     — force a specific framework
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Command } from 'commander';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { getErrorMessage, type ProgramIO } from '../cli-helpers.js';
import {
  clearTestCache,
  detectTestFramework,
  type TestFramework
} from '../../services/test-cache/test-cache-service.js';

const FRAMEWORKS: TestFramework[] = ['jest', 'vitest', 'mocha'];

type TestOptions = {
  all?: boolean;
  changed?: boolean;
  clearCache?: boolean;
  noCacheResult?: boolean;
  /** Whether the test runner's --cache should be enabled. Commander maps
   * `--no-cache` to `cache = false` (BASE name); default `true`. */
  cache?: boolean;
  passthrough?: boolean;
  framework?: string;
  project?: string;
  json?: boolean;
};

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

export type RunRunnerDeps = ResolveRunnerDeps & { spawnFn?: typeof spawn };

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
  const binDir = join(projectRoot, 'node_modules', '.bin');
  const shimExts = platform === 'win32' ? ['.cmd', '.exe'] : [''];
  let shim: string | null = null;
  for (const ext of shimExts) {
    const candidate = join(binDir, framework + ext);
    searched.push(candidate);
    if (shim === null && exists(candidate)) shim = candidate;
  }

  // 2. Project-local package entry.
  const pkgJsonPath = join(projectRoot, 'node_modules', framework, 'package.json');
  searched.push(pkgJsonPath);
  const entry = exists(pkgJsonPath) ? readBinEntry(pkgJsonPath, framework, read) : null;

  if (entry !== null && exists(entry)) {
    return { ok: true, command: nodeExec, args: [entry, ...argv], via: `local ${entry}`, fromPath: false };
  }
  if (shim !== null) {
    return { ok: true, ...toSpawnable(shim, argv, platform, env), via: `local ${shim}`, fromPath: false };
  }

  // 3. PATH — last resort.
  const onPath = resolveFromPath(framework, platform, env, exists);
  searched.push(`PATH lookup for "${framework}"`);
  if (onPath !== null) {
    return { ok: true, ...toSpawnable(onPath, argv, platform, env), via: `PATH: ${onPath}`, fromPath: true };
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

export function runRunner(
  framework: TestFramework,
  argv: string[],
  projectRoot: string,
  deps: RunRunnerDeps = {}
): Promise<{ code: number; stdout: string; stderr: string; notice: string | null }> {
  const resolution = resolveRunner(framework, argv, projectRoot, deps);
  if (!resolution.ok) {
    return Promise.reject(new Error(formatRunnerNotFound(framework, resolution.searched)));
  }
  const notice = resolution.fromPath
    ? `[peaks test] no local ${framework} under ${join(projectRoot, 'node_modules')}; falling back to ${resolution.via}\n`
    : null;
  return new Promise((resolveRun, reject) => {
    const spawnFn = deps.spawnFn ?? spawn;
    const proc = spawnFn(resolution.command, resolution.args, {
      cwd: projectRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    proc.on('error', (err: Error) => reject(err));
    proc.on('close', (code) => {
      resolveRun({ code: code ?? 0, stdout, stderr, notice });
    });
  });
}

export function registerTestCommands(program: Command, _io: ProgramIO): void {
  const test = program
    .command('test')
    .description(
      'Wrap the consumer project\'s test framework (jest/vitest/mocha) ' +
      'with a per-test fingerprint cache. Default args: <pattern...> ' +
      'runs jest|vitest|mocha <pattern> --cache. Exit 0 on all-pass / ' +
      'all-skip, exit 1 on any failure. (slice 2.5.0 sub-fix B)'
    )
    .argument('[patterns...]', 'test file pattern(s) to run (passed to the framework verbatim)')
    .option('--all', 'run the full suite (skip the pattern filter)')
    .option('--changed', 'only run tests in files changed since HEAD')
    .option('--clear-cache', 'empty the fingerprint cache at .peaks/_runtime/test-cache/ and exit 0')
    .option('--no-cache-result', 'bypass the per-test fingerprint cache (always re-run)')
    .option('--no-cache', 'pass --no-cache to the underlying framework (overrides peaks default)')
    .option('--passthrough', 'do NOT override the consumer\'s argv; pass patterns through verbatim')
    .option('--framework <name>', `force a specific framework: ${FRAMEWORKS.join(', ')}`)
    .option('--project <path>', 'project root (defaults to current directory)', process.cwd())
    .option('--json', 'emit a JSON envelope { ok, data } to stdout')
    .action(async (patterns: string[], opts: TestOptions) => {
      try {
        const projectRoot = resolveCanonicalProjectRoot(opts.project ?? process.cwd());

        // --clear-cache short-circuit
        if (opts.clearCache === true) {
          const result = clearTestCache(projectRoot);
          if (opts.json === true) {
            process.stdout.write(JSON.stringify({
              ok: true,
              data: { cleared: true, removed: result.removed, dir: '.peaks/_runtime/test-cache/' }
            }) + '\n');
          } else {
            process.stdout.write(`cleared ${result.removed} cache file(s) from .peaks/_runtime/test-cache/\n`);
          }
          return;
        }

        // Framework detection
        let framework: TestFramework | null = null;
        if (opts.framework) {
          if (!FRAMEWORKS.includes(opts.framework as TestFramework)) {
            const msg = `INVALID_FRAMEWORK: --framework must be one of ${FRAMEWORKS.join(', ')} (got "${opts.framework}")`;
            if (opts.json === true) {
              process.stdout.write(JSON.stringify({ ok: false, error: msg }) + '\n');
            } else {
              process.stderr.write(msg + '\n');
            }
            process.exitCode = 1;
            return;
          }
          framework = opts.framework as TestFramework;
        } else {
          framework = detectTestFramework(projectRoot);
        }

        if (!framework) {
          const msg = 'NO_TEST_FRAMEWORK: no supported test framework found in package.json (jest, vitest, or mocha). Install one and re-run, or pass --framework <name>.';
          if (opts.json === true) {
            process.stdout.write(JSON.stringify({ ok: false, error: msg }) + '\n');
          } else {
            process.stderr.write(msg + '\n');
          }
          process.exitCode = 1;
          return;
        }

        // Pattern argument: --all clears the list, --changed adds --changedSince
        const effectivePatterns: string[] = opts.all ? [] : patterns;

        const argv = buildRunnerArgv(framework, effectivePatterns, {
          all: opts.all === true,
          changed: opts.changed === true,
          cache: opts.cache === true,
          passthrough: opts.passthrough === true
        });

        // Stream the runner's output to the user.
        const result = await runRunner(framework, argv, projectRoot);
        if (result.notice !== null) process.stderr.write(result.notice);
        process.stdout.write(result.stdout);
        process.stderr.write(result.stderr);

        if (result.code !== 0) {
          process.exitCode = 1;
        }

        if (opts.json === true) {
          process.stdout.write(JSON.stringify({
            ok: result.code === 0,
            data: {
              framework,
              argv,
              exitCode: result.code,
              fingerprintCache: opts.noCacheResult ? 'bypassed' : 'enabled',
              cacheDir: '.peaks/_runtime/test-cache/'
            }
          }) + '\n');
        }
      } catch (error) {
        if (opts.json === true) {
          process.stdout.write(JSON.stringify({ ok: false, error: getErrorMessage(error) }) + '\n');
        } else {
          process.stderr.write(getErrorMessage(error) + '\n');
        }
        process.exitCode = 1;
      }
    });
}
