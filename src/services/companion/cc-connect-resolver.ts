/**
 * Slice 2026-06-14-cc-connect-weixin (slice 1) — cc-connect binary
 * resolver. Resolves the absolute path to the `cc-connect` binary
 * (Go; installed via `npm i -g cc-connect` or `brew install
 * cc-connect`) by walking `PATH`. The binary is then probed with
 * `cc-connect --version` via `node:child_process.spawn` (per the
 * PRD: "use spawn for the cc-connect binary, not require()").
 *
 * The resolver is intentionally pure: no fs side effects, no
 * process.env mutation. The cache layer (binary-cache.ts) is
 * responsible for persisting the resolved path to
 * `~/.peaks/companion/cc-connect-binary-path.txt`.
 */
import { spawn } from 'node:child_process';
import { delimiter, sep } from 'node:path';
import { existsSync } from 'node:fs';
import type { CompanionProbe } from './companion-types.js';
export type { CompanionProbe } from './companion-types.js';

export const CC_CONNECT_BINARY_NAME = 'cc-connect';

/** Returns the path of the first cc-connect binary found on PATH, or null. */
export function resolveCcConnectBinary(pathEnv: string = process.env.PATH ?? '', platform: NodeJS.Platform = process.platform): string | null {
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
 * Resolve + probe the cc-connect binary. Combines the PATH walk
 * and the `--version` spawn. Returns a structured probe so the
 * doctor + scan commands can render useful diagnostics.
 */
export async function probeCcConnect(
  options: {
    pathEnv?: string;
    platform?: NodeJS.Platform;
    spawnFn?: SpawnVersionFn;
    /** Skip the spawn (PATH-only resolution). Useful for `peaks scan companion-binary --dry-run`. */
    skipSpawn?: boolean;
  } = {}
): Promise<CompanionProbe> {
  const pathEnv = options.pathEnv ?? process.env.PATH ?? '';
  const platform = options.platform ?? process.platform;
  const binaryPath = resolveCcConnectBinary(pathEnv, platform);
  if (binaryPath === null) {
    return { binaryPath: null, version: null, ok: false, error: 'cc-connect binary not found on PATH' };
  }
  if (options.skipSpawn === true) {
    return { binaryPath, version: null, ok: true, error: null };
  }
  const spawnFn = options.spawnFn ?? defaultSpawnVersion;
  const result = await spawnFn(binaryPath, ['--version']);
  if (result.code !== 0) {
    const reason = result.stderr.trim().length > 0 ? result.stderr.trim() : `exit code ${result.code}`;
    return { binaryPath, version: null, ok: false, error: reason };
  }
  const version = parseVersionOutput(result.stdout);
  if (version === null) {
    return { binaryPath, version: null, ok: false, error: `could not parse --version output: ${result.stdout.slice(0, 80)}` };
  }
  return { binaryPath, version, ok: true, error: null };
}
