// tests/unit/_setup/code-gate-shell-harness.ts
//
// The harness that runs `src/services/hooks/pre-tool-code-gate.sh`.
//
// The script is a THIN WRAPPER over the Node command: where a CLI is
// reachable it execs `peaks code-gate`, so a test that spawns it has to say
// WHICH CLI it is reachable to. Two environments are therefore needed, and
// neither of them may be the host's own `peaks`: the globally installed one
// is days old and answers differently, so a test that measured it would
// measure the wrong implementation.
//
//   - `withCliEnv()` — a PATH whose `peaks` is a shim that runs THIS
//     repository's SOURCE, so the wrapper execs the code under test.
//   - `withoutCliEnv()` — a PATH holding only the directories of the
//     coreutils the script needs, so `peaks` (and, where it is not there,
//     `node`) is not reachable at all and the script has to take its own
//     conservative path.
//
// The PATH is passed in the NATIVE spelling, because the spawn API resolves
// the program through it; the child shell converts it back to its own.

import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';

import { afterAll } from 'vitest';

/** This repository's root. */
export const REPO_ROOT = resolve(__dirname, '..', '..', '..');

/** The hook script under test. */
export const HOOK_SCRIPT = join(REPO_ROOT, 'src', 'services', 'hooks', 'pre-tool-code-gate.sh');

/** The source CLI the shim runs. */
const SOURCE_CLI = join(REPO_ROOT, 'src', 'cli', 'index.ts');

/** The TSX loader the source CLI is run through. */
const TSX_LOADER = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');

/** The coreutils the script itself calls. */
const CORE_UTILS = ['grep', 'sed', 'tr', 'cat', 'dirname', 'basename', 'awk'];

/** What one run of the script produced. */
export interface HookRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** A POSIX path in the spelling a bash process reads it in. */
function toPosix(path: string): string {
  return path.replace(/\\/g, '/');
}

/**
 * The native spelling of a path a bash process reported.
 *
 * On Windows the child shell is an MSYS build: it reports POSIX paths, and
 * the spawn API needs the native ones. `cygpath` is the translator, and it
 * only exists in that build — elsewhere the reported path IS the native one.
 */
function toNative(reportedByBash: string): string {
  if (process.platform !== 'win32') return reportedByBash;
  const translated = spawnSync('bash', ['-c', 'cygpath -w "$1"', 'bash', reportedByBash], {
    encoding: 'utf8',
    windowsHide: true
  }).stdout;
  const win = (translated ?? '').trim();
  return win === '' ? reportedByBash : win;
}

/** The bash this harness runs the script with. */
function bashPath(): string {
  const reported =
    spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8', windowsHide: true }).stdout ??
    '';
  const found = reported.trim();
  return found === '' ? 'bash' : toNative(found);
}

/** Run a snippet in bash and return what it printed. */
function bashOut(script: string, env: NodeJS.ProcessEnv): string {
  return (
    spawnSync(bashPath(), ['-c', script], { encoding: 'utf8', env, windowsHide: true }).stdout ?? ''
  );
}

/** The directory holding the `peaks` shim, created once per test file. */
let shimDir: string | null = null;

/** The directory holding the `node` shim, created once per test file. */
let nodeShimPath: string | null = null;

/** The restricted PATH, computed once per test file. */
let restrictedPathCache: string | null = null;

/**
 * The marker the `peaks` shim writes when it is the one that ran.
 *
 * It is what makes a measurement of the wrapper falsifiable: the host's own
 * `peaks` is days old and answers differently, so a test that measured it
 * would measure the wrong implementation — and would look green all the same.
 * A run that does not carry this marker did not run the source.
 */
export const SOURCE_CLI_MARKER = 'PEAKS-CODE-GATE-SOURCE-CLI';

/**
 * The shim: a `peaks` that runs THIS repository's source CLI.
 *
 * The payload arrives on the shim's stdin and is passed on untouched, which
 * is what the wrapper's contract with the command is.
 */
function peaksShimDir(): string {
  if (shimDir !== null) return shimDir;
  shimDir = writeShim('peaks', [
    `echo "${SOURCE_CLI_MARKER}" >&2`,
    `exec "${toPosix(process.execPath)}" "${toPosix(TSX_LOADER)}" "${toPosix(SOURCE_CLI)}" "$@"`
  ]);
  return shimDir;
}

/**
 * The shim: a `node` that is the real one.
 *
 * It exists so that a PATH can hold a `node` without holding a `peaks`: the
 * second lookup the wrapper does needs both, and the first one must not be
 * able to find a command.
 */
function nodeShimDir(): string {
  if (nodeShimPath !== null) return nodeShimPath;
  nodeShimPath = writeShim('node', [`exec "${toPosix(process.execPath)}" "$@"`]);
  return nodeShimPath;
}

/** Write one executable shim into a fresh directory and return that directory. */
function writeShim(name: string, lines: readonly string[]): string {
  const dir = mkdtempSync(join(tmpdir(), `peaks-code-gate-${name}-shim-`));
  const shim = join(dir, name);
  writeFileSync(shim, ['#!/usr/bin/env bash', ...lines, ''].join('\n'), 'utf8');
  chmodSync(shim, 0o755);
  return dir;
}

/**
 * A PATH holding only the directories of the coreutils the script needs.
 *
 * The directories a command is found in are dropped when they would also
 * hand the child a `peaks` (which would take the wrapper's Node path) or a
 * `node` (which the fallback does not need). A directory that holds a
 * coreutil as well is kept, because a fallback without `grep` is not a
 * fallback at all.
 */
function restrictedPath(): string {
  if (restrictedPathCache !== null) return restrictedPathCache;
  const reported = bashOut(`command -v ${CORE_UTILS.join(' ')}`, { ...process.env });
  const toolDirs = [
    ...new Set(
      reported
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')
        .map((line) => dirname(line))
    )
  ];
  const banned = new Set<string>();
  for (const name of ['peaks', 'node']) {
    const found = bashOut(`command -v ${name}`, { ...process.env, PATH: toolDirs.join(delimiter) });
    const path = found.trim();
    if (path !== '') banned.add(dirname(path));
  }
  const kept = toolDirs.filter((dir) => !banned.has(dir));
  const usable = kept.length > 0 ? kept : toolDirs;
  restrictedPathCache = usable.map(toNative).join(delimiter);
  return restrictedPathCache;
}

/** The environment in which the wrapper finds a CLI. */
export function withCliEnv(): NodeJS.ProcessEnv {
  const shim = peaksShimDir();
  return { ...process.env, PATH: `${shim}${delimiter}${process.env.PATH ?? ''}` };
}

/** The environment in which the wrapper finds NO command, but a `node`. */
export function nodeOnlyEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: `${nodeShimDir()}${delimiter}${restrictedPath()}` };
}

/** The environment in which the wrapper finds NO command at all. */
export function withoutCliEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: restrictedPath() };
}

/** Is a command reachable under this environment? */
export function commandReachable(command: string, env: NodeJS.ProcessEnv): boolean {
  return bashOut(`command -v ${command}`, env).trim() !== '';
}

/**
 * The Node command the wrapper delegates to, run from the source with the
 * same payload and the same project.
 *
 * It is the SAME implementation the wrapper execs, so a comparison between
 * the two is a comparison of the wrapper's plumbing, not of two rules.
 */
export function runCodeGate(
  root: string,
  stdin: string,
  cwd: string
): { status: number | null; stdout: string } {
  const run = spawnSync(
    process.execPath,
    [
      join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      join(REPO_ROOT, 'src', 'cli', 'index.ts'),
      'code-gate',
      '--project',
      root,
      '--dry-run',
      '--json'
    ],
    { cwd, encoding: 'utf8', windowsHide: true, input: stdin, env: { ...process.env } }
  );
  return { status: run.status, stdout: run.stdout ?? '' };
}

/**
 * Run the hook script.
 *
 * `args` is the script's own argument list (the optional project root);
 * `payload` is what arrives on stdin; `env` overrides the environment the
 * script is given, and `cli` picks the default one (`false` = no command is
 * reachable at all).
 */
export function runHook(options: {
  readonly payload: string;
  readonly cwd?: string;
  readonly args?: readonly string[];
  readonly cli?: boolean;
  readonly env?: NodeJS.ProcessEnv;
}): HookRun {
  const run = spawnSync(bashPath(), [HOOK_SCRIPT, ...(options.args ?? [])], {
    cwd: options.cwd ?? REPO_ROOT,
    encoding: 'utf8',
    windowsHide: true,
    input: options.payload,
    env: options.env ?? (options.cli === false ? withoutCliEnv() : withCliEnv())
  });
  return { status: run.status, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
}

/**
 * Run a COPY of the hook script that sits in `dir`, so a sibling file can be
 * written next to it — that is the second place the wrapper looks for the CLI.
 */
export function runHookCopy(options: {
  readonly dir: string;
  readonly payload: string;
  readonly cwd?: string;
  readonly args?: readonly string[];
  readonly env: NodeJS.ProcessEnv;
}): HookRun {
  const run = spawnSync(
    bashPath(),
    [join(options.dir, 'pre-tool-code-gate.sh'), ...(options.args ?? [])],
    {
      cwd: options.cwd ?? REPO_ROOT,
      encoding: 'utf8',
      windowsHide: true,
      input: options.payload,
      env: options.env
    }
  );
  return { status: run.status, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
}

/** The verdict a run reached. */
export function verdictOf(run: HookRun): 'deny' | 'allow' {
  return run.status === 2 ? 'deny' : 'allow';
}

afterAll(() => {
  for (const dir of [shimDir, nodeShimPath]) {
    if (dir === null) continue;
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
  shimDir = null;
  nodeShimPath = null;
});
