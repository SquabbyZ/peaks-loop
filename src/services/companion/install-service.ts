/**
 * Slice 2026-06-14-cc-connect-weixin (slice 2) — install service.
 * Wraps `npm i -g cc-connect@latest` with a `brew install
 * cc-connect` fallback on macOS / Linux brew. On success,
 * probes the binary via `probeCcConnect` and writes the
 * `~/.peaks/companion/cc-connect-binary-path.txt` cache (AC1).
 *
 * No background / opt-out: this is the explicit `peaks companion
 * install` entry point. The peaks-cli `postinstall` script does
 * NOT invoke this (preserved-behavior clause in the PRD).
 */
import { spawn } from 'node:child_process';
import { probeCcConnect } from './cc-connect-resolver.js';
import { writeBinaryPathCache } from './binary-cache.js';
import { getErrorMessage } from '../../shared/result.js';
import type { CompanionProbe } from './companion-types.js';

export const CC_CONNECT_NPM_PACKAGE = 'cc-connect';
export const INSTALL_TIMEOUT_MS = 300_000;

export type InstallAttempt = {
  method: 'npm' | 'brew';
  command: string;
  ok: boolean;
  exitCode: number | null;
  durationMs: number;
  error: string | null;
};

export type InstallResult = {
  installed: boolean;
  binaryPath: string | null;
  version: string | null;
  attempts: InstallAttempt[];
  cacheWritten: boolean;
  cachePath: string;
  nextActions: string[];
  error: string | null;
};

export type RunInstallCommand = (
  method: 'npm' | 'brew',
  command: string,
  args: readonly string[]
) => Promise<{ code: number; stdout: string; stderr: string; durationMs: number }>;

export function defaultRunInstallCommand(
  method: 'npm' | 'brew',
  command: string,
  args: readonly string[]
): Promise<{ code: number; stdout: string; stderr: string; durationMs: number }> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      resolve({ code: -1, stdout, stderr: `${stderr}${err.message}`, durationMs: Date.now() - started });
    });
    child.on('close', (code) => {
      resolve({ code: code ?? -1, stdout, stderr, durationMs: Date.now() - started });
    });
  });
}

export type InstallOptions = {
  /** Skip npm and try brew first. Defaults to npm-then-brew. */
  preferBrew?: boolean;
  /** Inject a runner for tests. */
  runCommand?: RunInstallCommand;
  /** Force a specific version. */
  version?: string;
  /** Path env to probe with after install. */
  pathEnv?: string;
  /** Skip the post-install probe+cache write. */
  skipPostProbe?: boolean;
  /** Override the home dir for the binary cache write (test seam). */
  home?: string;
};

function buildAttempts(opts: { preferBrew: boolean; version?: string }): { method: 'npm' | 'brew'; command: string; args: string[] }[] {
  const attempts: { method: 'npm' | 'brew'; command: string; args: string[] }[] = [];
  const pkgSpec = opts.version ? `${CC_CONNECT_NPM_PACKAGE}@${opts.version}` : `${CC_CONNECT_NPM_PACKAGE}@latest`;
  if (opts.preferBrew) {
    attempts.push({ method: 'brew', command: 'brew', args: ['install', CC_CONNECT_NPM_PACKAGE] });
    attempts.push({ method: 'npm', command: 'npm', args: ['install', '-g', pkgSpec] });
  } else {
    attempts.push({ method: 'npm', command: 'npm', args: ['install', '-g', pkgSpec] });
    attempts.push({ method: 'brew', command: 'brew', args: ['install', CC_CONNECT_NPM_PACKAGE] });
  }
  return attempts;
}

export async function installCcConnect(options: InstallOptions = {}): Promise<InstallResult> {
  const attempts: InstallAttempt[] = [];
  const runner = options.runCommand ?? defaultRunInstallCommand;
  const plan = buildAttempts({ preferBrew: options.preferBrew === true, ...(options.version !== undefined ? { version: options.version } : {}) });
  for (const step of plan) {
    const result = await runner(step.method, step.command, step.args);
    attempts.push({
      method: step.method,
      command: `${step.command} ${step.args.join(' ')}`,
      ok: result.code === 0,
      exitCode: result.code,
      durationMs: result.durationMs,
      error: result.code === 0 ? null : getErrorMessage(new Error(result.stderr.trim() || `exit ${result.code}`))
    });
    if (result.code === 0) break;
  }
  const anyOk = attempts.some((a) => a.ok);
  if (!anyOk) {
    return {
      installed: false,
      binaryPath: null,
      version: null,
      attempts,
      cacheWritten: false,
      cachePath: '~/.peaks/companion/cc-connect-binary-path.txt',
      nextActions: [
        'Verify npm has global write permission (try `npm config get prefix` then `ls` it).',
        'On macOS, verify Homebrew is installed (`brew --version`).',
        'On Linux, see https://github.com/chenhg5/cc-connect for manual install instructions.'
      ],
      error: 'all install attempts failed; see attempts[] for details'
    };
  }
  if (options.skipPostProbe === true) {
    return {
      installed: true,
      binaryPath: null,
      version: null,
      attempts,
      cacheWritten: false,
      cachePath: '~/.peaks/companion/cc-connect-binary-path.txt',
      nextActions: ['probe skipped; run `peaks companion status` to refresh the cache'],
      error: null
    };
  }
  const probe = await probeCcConnect(options.pathEnv !== undefined ? { pathEnv: options.pathEnv } : {});
  if (!probe.ok || probe.binaryPath === null || probe.version === null) {
    return {
      installed: true,
      binaryPath: null,
      version: null,
      attempts,
      cacheWritten: false,
      cachePath: '~/.peaks/companion/cc-connect-binary-path.txt',
      nextActions: [
        'install reported success but the binary is not on PATH; check the install output',
        'verify the install completed; run `peaks companion status` after a shell reload'
      ],
      error: probe.error ?? 'cc-connect not on PATH after install'
    };
  }
  const cacheResult = writeBinaryPathCache({
    binaryPath: probe.binaryPath,
    version: probe.version,
    resolvedAt: new Date().toISOString(),
    source: 'INSTALL'
  }, options.home);
  return {
    installed: true,
    binaryPath: probe.binaryPath,
    version: probe.version,
    attempts,
    cacheWritten: cacheResult.ok,
    cachePath: cacheResult.path,
    nextActions: cacheResult.ok
      ? [`next: run \`peaks companion setup\` to render the iLink QR for WeChat pairing`]
      : [`cache write failed (${cacheResult.error}); binary is installed at ${probe.binaryPath}`],
    error: cacheResult.ok ? null : cacheResult.error
  };
}

export type ProbeSummary = Pick<CompanionProbe, 'binaryPath' | 'version' | 'ok' | 'error'>;
