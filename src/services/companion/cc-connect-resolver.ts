/**
 * Slice 2026-06-14-cc-connect-weixin (slice 1 + 2) — cc-connect binary
 * resolver. Resolves the absolute path to the `cc-connect` binary
 * (Go; installed via the peaks-cli `cc-connect` npm dependency — its
 * `postinstall` script downloads the platform-specific Go binary —
 * or globally via `npm i -g cc-connect` / `brew install cc-connect`)
 * by checking, in order:
 *
 *   1. `<cwd>/node_modules/.bin/cc-connect` (and `.cmd` on win32) — the
 *      canonical location when peaks-cli was installed via pnpm/npm and
 *      `cc-connect` is a direct dep. This is the case we expect in 99% of
 *      peak-cli installations going forward.
 *   2. `require.resolve('cc-connect', { paths: [cwd] })` to find the
 *      installed package, then resolve to its `package.json#bin` entry
 *      (`run.js`). The `bin` is a tiny node shim that `execFileSync`'s
 *      the real Go binary in `node_modules/.../cc-connect/bin/`.
 *   3. A walk of `PATH` for the `cc-connect` binary (the legacy
 *      resolution path; preserved for users who `npm i -g cc-connect`
 *      separately or installed via `brew`).
 *
 * The resolver is intentionally pure: no fs side effects (reads only),
 * no process.env mutation. The cache layer (binary-cache.ts) is
 * responsible for persisting the resolved path to
 * `~/.peaks/companion/cc-connect-binary-path.txt`.
 *
 * The binary is then probed with `cc-connect --version` via
 * `node:child_process.spawn` (per the PRD: "use spawn for the
 * cc-connect binary, not require()"). The probe is in
 * `probeCcConnect` below.
 */
import { spawn } from 'node:child_process';
import { delimiter, dirname, join, sep } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { CompanionProbe } from './companion-types.js';
export type { CompanionProbe } from './companion-types.js';

export const CC_CONNECT_BINARY_NAME = 'cc-connect';
export const CC_CONNECT_NPM_PACKAGE = 'cc-connect';

type ResolvedSource = 'node-modules' | 'path' | null;

export interface ResolvedBinary {
  /** Absolute path to the binary. Always non-null when the object is returned. */
  binaryPath: string;
  /** Where the binary was resolved from. */
  source: Exclude<ResolvedSource, null>;
}

function nodeModulesBinCandidates(cwd: string, platform: NodeJS.Platform): string[] {
  const candidates: string[] = [];
  const extensions = platform === 'win32' ? ['', '.cmd', '.EXE', '.CMD'] : [''];
  for (const ext of extensions) {
    candidates.push(join(cwd, 'node_modules', '.bin', `${CC_CONNECT_BINARY_NAME}${ext}`));
  }
  return candidates;
}

function readPackageJsonBin(packageJsonPath: string): string | null {
  try {
    const raw = readFileSync(packageJsonPath, 'utf8');
    const parsed = JSON.parse(raw) as { bin?: unknown };
    const bin = parsed.bin;
    if (typeof bin === 'string') {
      // bin is a string: the file to execute (relative to pkg root).
      return bin;
    }
    if (bin !== null && typeof bin === 'object') {
      // bin is a map: { [name]: file }
      const map = bin as Record<string, unknown>;
      const entry = map[CC_CONNECT_BINARY_NAME] ?? map[CC_CONNECT_NPM_PACKAGE];
      if (typeof entry === 'string') return entry;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve the cc-connect package's installed location via Node's
 * module resolution algorithm. Returns the absolute path to the
 * `bin` entry (the `run.js` shim that exec's the real Go binary),
 * or null when the package is not installed relative to `cwd`.
 */
function resolveViaNodeModules(cwd: string): ResolvedBinary | null {
  // 1. Direct node_modules/.bin lookup (most common when cc-connect
  //    is a direct dep of the project that calls this resolver).
  for (const candidate of nodeModulesBinCandidates(cwd, process.platform)) {
    if (existsSync(candidate)) {
      return { binaryPath: candidate, source: 'node-modules' };
    }
  }
  // 2. require.resolve('cc-connect/package.json') — works in both ESM
  //    and CJS via createRequire, and uses the standard module
  //    resolution algorithm (walks parent node_modules up the tree).
  try {
    const require = createRequire(join(cwd, 'noop.cjs'));
    const pkgJsonPath = require.resolve(`${CC_CONNECT_NPM_PACKAGE}/package.json`, { paths: [cwd] });
    const bin = readPackageJsonBin(pkgJsonPath);
    if (bin === null) return null;
    const abs = join(dirname(pkgJsonPath), bin);
    if (existsSync(abs)) {
      return { binaryPath: abs, source: 'node-modules' };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Walk `PATH` for the first existing `cc-connect` executable. Returns
 * the absolute path or null. Preserved for users who installed
 * cc-connect globally (npm i -g, brew) and is the legacy fallback
 * used by slice 1. Kept exported so tests can drive it directly.
 */
export function resolveCcConnectBinary(
  pathEnv: string = process.env.PATH ?? '',
  platform: NodeJS.Platform = process.platform
): string | null {
  if (pathEnv.length === 0) return null;
  const extensions = platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(delimiter) : [''];
  const candidates: string[] = [];
  for (const dir of pathEnv.split(delimiter)) {
    if (dir.length === 0) continue;
    for (const ext of extensions) {
      candidates.push(`${dir}${sep}${CC_CONNECT_BINARY_NAME}${ext}`);
    }
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export interface ResolveOptions {
  /** Directory to scope node_modules lookup to. Defaults to process.cwd(). */
  cwd?: string;
  /** PATH env to walk for the legacy fallback. Defaults to process.env.PATH. */
  pathEnv?: string;
  /** Platform (test seam). Defaults to process.platform. */
  platform?: NodeJS.Platform;
}

export interface ResolvedCcConnect extends ResolvedBinary {}

/**
 * Resolve the cc-connect binary, in order:
 *   1. <cwd>/node_modules/.bin/cc-connect (and .cmd on win32)
 *   2. require.resolve('cc-connect') → package.json#bin
 *   3. PATH walk (legacy fallback)
 *
 * Returns null when no binary is found.
 */
export function resolveCcConnectAny(options: ResolveOptions = {}): ResolvedCcConnect | null {
  const cwd = options.cwd ?? process.cwd();
  const pathEnv = options.pathEnv ?? process.env.PATH ?? '';
  const platform = options.platform ?? process.platform;
  const fromNodeModules = resolveViaNodeModules(cwd);
  if (fromNodeModules !== null) return fromNodeModules;
  const fromPath = resolveCcConnectBinary(pathEnv, platform);
  if (fromPath !== null) return { binaryPath: fromPath, source: 'path' };
  return null;
}

/**
 * Parse the version out of `cc-connect --version` output. cc-connect
 * prints a single line like `cc-connect 1.3.2` (per v1.3.x npm page).
 * We tolerate leading whitespace, optional "v" prefix, and trailing
 * newline. Returns null when the line doesn't look like a version.
 */
export function parseVersionOutput(stdout: string): string | null {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return null;
  const lines = trimmed.split(/\r?\n/);
  for (const line of lines) {
    const match = /cc-connect\s+v?(\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?)/i.exec(line.trim());
    if (match && match[1]) {
      return match[1];
    }
  }
  return null;
}

/**
 * Spawn the cc-connect binary to read its version. Uses `node:child_process.spawn`
 * synchronously via stdio capture (we wait for close). We do not
 * `require('cc-connect')` — it's a Go binary with no Node API.
 *
 * Injected `spawnFn` lets tests swap in a fake. The injected version
 * receives the args and returns `{ stdout, stderr, code }` to mirror
 * the real spawn contract.
 */
export type SpawnVersionResult = { stdout: string; stderr: string; code: number };
export type SpawnVersionFn = (binaryPath: string, args: readonly string[]) => Promise<SpawnVersionResult>;

export function defaultSpawnVersion(binaryPath: string, args: readonly string[]): Promise<SpawnVersionResult> {
  return new Promise((resolve) => {
    const child = spawn(binaryPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      resolve({ stdout, stderr: `${stderr}${err.message}`, code: -1 });
    });
    child.on('close', (code) => {
      resolve({ stdout, stderr, code: code ?? -1 });
    });
  });
}

/**
 * Resolve + probe the cc-connect binary. Combines the resolver
 * (node_modules → require.resolve → PATH) and the `--version` spawn.
 * Returns a structured probe so the doctor + scan commands can render
 * useful diagnostics.
 */
export async function probeCcConnect(
  options: {
    cwd?: string;
    pathEnv?: string;
    platform?: NodeJS.Platform;
    spawnFn?: SpawnVersionFn;
    /** Skip the spawn (resolution only). Useful for `peaks scan companion-binary --dry-run`. */
    skipSpawn?: boolean;
  } = {}
): Promise<CompanionProbe> {
  const cwd = options.cwd ?? process.cwd();
  const pathEnv = options.pathEnv ?? process.env.PATH ?? '';
  const platform = options.platform ?? process.platform;
  const resolved = resolveCcConnectAny({ cwd, pathEnv, platform });
  if (resolved === null) {
    return {
      binaryPath: null,
      version: null,
      ok: false,
      error: 'cc-connect binary not found (checked node_modules/.bin, require.resolve, and PATH)',
      resolvedSource: null
    };
  }
  if (options.skipSpawn === true) {
    return { binaryPath: resolved.binaryPath, version: null, ok: true, error: null, resolvedSource: resolved.source };
  }
  const spawnFn = options.spawnFn ?? defaultSpawnVersion;
  const result = await spawnFn(resolved.binaryPath, ['--version']);
  if (result.code !== 0) {
    const reason = result.stderr.trim().length > 0 ? result.stderr.trim() : `exit code ${result.code}`;
    return { binaryPath: resolved.binaryPath, version: null, ok: false, error: reason, resolvedSource: resolved.source };
  }
  const version = parseVersionOutput(result.stdout);
  if (version === null) {
    return {
      binaryPath: resolved.binaryPath,
      version: null,
      ok: false,
      error: `could not parse --version output: ${result.stdout.slice(0, 80)}`,
      resolvedSource: resolved.source
    };
  }
  return { binaryPath: resolved.binaryPath, version, ok: true, error: null, resolvedSource: resolved.source };
}
