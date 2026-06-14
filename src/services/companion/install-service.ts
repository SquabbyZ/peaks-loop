/**
 * Slice 2026-06-14-cc-connect-weixin (slice 2) — install service.
 *
 * cc-connect is a peaks-cli `dependencies` entry. The `pnpm install`
 * (or `npm install`) step on peaks-cli pulls cc-connect and its
 * `postinstall` script downloads the platform-specific Go binary.
 * `peaks companion install` is therefore a *verify* command, not an
 * installer:
 *
 *   1. Resolve the binary via `resolveCcConnectAny` (node_modules
 *      first, then PATH).
 *   2. Probe via `cc-connect --version`.
 *   3. Write the resolved path to
 *      `~/.peaks/companion/cc-connect-binary-path.txt` so subsequent
 *      peaks-cli invocations skip the resolution walk.
 *
 * The legacy `npm i -g cc-connect@latest` / `brew install cc-connect`
 * shells from slice 1 are gone — those are now irrelevant because
 * peaks-cli's own install pulls the binary.
 */
import { probeCcConnect, resolveCcConnectAny } from './cc-connect-resolver.js';
import { writeBinaryPathCache } from './binary-cache.js';
import { getErrorMessage } from '../../shared/result.js';
import type { CompanionProbe } from './companion-types.js';

export const CC_CONNECT_NPM_PACKAGE = 'cc-connect';

export type InstallAttempt = {
  /** A no-op marker attempt (we don't shell out anymore). */
  method: 'verify';
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
  /** Where the binary was resolved from; null when nothing was found. */
  resolvedSource: 'node-modules' | 'path' | null;
};

/**
 * The legacy "runner" signature is preserved (as a no-op type) so
 * existing call sites / tests don't break on import. The runner is
 * never invoked — the verify pass doesn't shell out.
 */
export type RunInstallCommand = (
  method: 'npm' | 'brew',
  command: string,
  args: readonly string[]
) => Promise<{ code: number; stdout: string; stderr: string; durationMs: number }>;

export type InstallOptions = {
  /** Inject a custom resolver for tests (e.g. a tmp cwd with a fake node_modules/.bin). */
  resolveBinary?: typeof resolveCcConnectAny;
  /** Inject a custom probe for tests. */
  probe?: typeof probeCcConnect;
  /** Cwd to resolve relative to (test seam). Defaults to process.cwd(). */
  cwd?: string;
  /** PATH to resolve against (test seam). Defaults to process.env.PATH. */
  pathEnv?: string;
  /** Skip the post-verify probe (path-cache write still runs if resolve succeeded). */
  skipPostProbe?: boolean;
  /** Skip the --version spawn; only use the resolver (test seam). */
  skipSpawn?: boolean;
  /** Override the home dir for the binary cache write (test seam). */
  home?: string;
};

export async function installCcConnect(options: InstallOptions = {}): Promise<InstallResult> {
  const started = Date.now();
  const resolver = options.resolveBinary ?? resolveCcConnectAny;
  const probe = options.probe ?? probeCcConnect;
  const cwd = options.cwd ?? process.cwd();
  const pathEnv = options.pathEnv;

  const resolved = resolver({ cwd, ...(pathEnv !== undefined ? { pathEnv } : {}) });
  if (resolved === null) {
    return {
      installed: false,
      binaryPath: null,
      version: null,
      attempts: [
        {
          method: 'verify',
          command: 'resolve cc-connect (node_modules, then PATH)',
          ok: false,
          exitCode: null,
          durationMs: Date.now() - started,
          error: 'cc-connect not found in node_modules/.bin, the installed package bin, or PATH'
        }
      ],
      cacheWritten: false,
      cachePath: '~/.peaks/companion/cc-connect-binary-path.txt',
      nextActions: [
        'Run `pnpm install` (or `npm install`) to pull cc-connect as a peaks-cli dependency; its `postinstall` script downloads the Go binary into node_modules/.bin/cc-connect.',
        'If you prefer a global install, run `npm i -g cc-connect@latest` (or `brew install cc-connect`) so the binary is on PATH; the resolver falls back to PATH after node_modules.'
      ],
      error: 'cc-connect binary not resolved; see nextActions',
      resolvedSource: null
    };
  }

  if (options.skipPostProbe === true) {
    return {
      installed: true,
      binaryPath: resolved.binaryPath,
      version: null,
      attempts: [
        {
          method: 'verify',
          command: 'resolve cc-connect (node_modules, then PATH)',
          ok: true,
          exitCode: null,
          durationMs: Date.now() - started,
          error: null
        }
      ],
      cacheWritten: false,
      cachePath: '~/.peaks/companion/cc-connect-binary-path.txt',
      nextActions: ['probe skipped; run `peaks companion install` again to populate the binary-path cache'],
      error: null,
      resolvedSource: resolved.source
    };
  }

  const probeResult: CompanionProbe = await probe({
    cwd,
    ...(pathEnv !== undefined ? { pathEnv } : {}),
    ...(options.skipSpawn === true ? { skipSpawn: true } : {})
  });
  if (!probeResult.ok || probeResult.binaryPath === null || probeResult.version === null) {
    return {
      installed: true,
      binaryPath: resolved.binaryPath,
      version: null,
      attempts: [
        {
          method: 'verify',
          command: 'resolve cc-connect (node_modules, then PATH)',
          ok: true,
          exitCode: null,
          durationMs: Date.now() - started,
          error: null
        }
      ],
      cacheWritten: false,
      cachePath: '~/.peaks/companion/cc-connect-binary-path.txt',
      nextActions: [
        `Binary resolved at ${resolved.binaryPath} (source=${resolved.source}) but the version probe failed: ${probeResult.error ?? 'unknown'}`,
        'Re-run `pnpm install` to re-trigger cc-connect postinstall, then re-run `peaks companion install` to re-probe.'
      ],
      error: probeResult.error ?? 'cc-connect --version probe failed',
      resolvedSource: resolved.source
    };
  }

  const cacheResult = writeBinaryPathCache(
    {
      binaryPath: probeResult.binaryPath,
      version: probeResult.version,
      resolvedAt: new Date().toISOString(),
      source: probeResult.resolvedSource === 'node-modules' ? 'NODE_MODULES' : 'PATH'
    },
    options.home
  );
  return {
    installed: true,
    binaryPath: probeResult.binaryPath,
    version: probeResult.version,
    attempts: [
      {
        method: 'verify',
        command: 'resolve + probe cc-connect',
        ok: true,
        exitCode: 0,
        durationMs: Date.now() - started,
        error: null
      }
    ],
    cacheWritten: cacheResult.ok,
    cachePath: cacheResult.path,
    nextActions: cacheResult.ok
      ? [`binary path cached; next: run \`peaks companion setup\` to render the iLink QR for WeChat pairing`]
      : [`cache write failed (${cacheResult.error}); binary is installed at ${probeResult.binaryPath}`],
    error: cacheResult.ok ? null : cacheResult.error,
    resolvedSource: probeResult.resolvedSource ?? null
  };
}

export type ProbeSummary = Pick<CompanionProbe, 'binaryPath' | 'version' | 'ok' | 'error'>;

// re-export so older import paths keep working
export { getErrorMessage };
