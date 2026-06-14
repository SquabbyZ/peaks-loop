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
import { writeBinaryPathCache, binaryPathCacheFile } from './binary-cache.js';
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

/**
 * BUG FIX (2026-06-14 dogfood): shared verify primitive used by both
 * `installCcConnect` (mutating: writes the binary-path cache) and
 * `scanCcConnect` (non-mutating: dry-run only). Pulled out of
 * `installCcConnect` so the dry-run scan command can call the same
 * resolver + probe without inheriting the cache-write side effect.
 */
export type VerifyOptions = {
  resolveBinary?: typeof resolveCcConnectAny;
  probe?: typeof probeCcConnect;
  cwd?: string;
  pathEnv?: string;
  skipSpawn?: boolean;
};

export type VerifyResult = {
  ok: boolean;
  binaryPath: string | null;
  version: string | null;
  resolvedSource: 'node-modules' | 'path' | null;
  error: string | null;
};

export async function verifyCcConnectBinary(options: VerifyOptions = {}): Promise<VerifyResult> {
  const resolver = options.resolveBinary ?? resolveCcConnectAny;
  const probe = options.probe ?? probeCcConnect;
  const cwd = options.cwd ?? process.cwd();
  const pathEnv = options.pathEnv;

  const resolved = resolver({ cwd, ...(pathEnv !== undefined ? { pathEnv } : {}) });
  if (resolved === null) {
    return {
      ok: false,
      binaryPath: null,
      version: null,
      resolvedSource: null,
      error: 'cc-connect binary not resolved (checked node_modules/.bin, require.resolve, and PATH)'
    };
  }
  if (options.skipSpawn === true) {
    return {
      ok: true,
      binaryPath: resolved.binaryPath,
      version: null,
      resolvedSource: resolved.source,
      error: null
    };
  }
  const probeResult: CompanionProbe = await probe({
    cwd,
    ...(pathEnv !== undefined ? { pathEnv } : {})
  });
  return {
    ok: probeResult.ok,
    binaryPath: probeResult.binaryPath,
    version: probeResult.version,
    resolvedSource: probeResult.resolvedSource ?? null,
    error: probeResult.ok ? null : (probeResult.error ?? 'cc-connect --version probe failed')
  };
}

export async function installCcConnect(options: InstallOptions = {}): Promise<InstallResult> {
  const started = Date.now();
  const verify = await verifyCcConnectBinary({
    ...(options.resolveBinary !== undefined ? { resolveBinary: options.resolveBinary } : {}),
    ...(options.probe !== undefined ? { probe: options.probe } : {}),
    cwd: options.cwd ?? process.cwd(),
    ...(options.pathEnv !== undefined ? { pathEnv: options.pathEnv } : {}),
    // `skipPostProbe` implies "resolve only, don't spawn --version" — same
    // effect as `skipSpawn`. The legacy test relied on this contract.
    skipSpawn: options.skipSpawn === true || options.skipPostProbe === true
  });
  const cachePath = binaryPathCacheFile(options.home);

  if (!verify.ok || verify.binaryPath === null) {
    if (verify.binaryPath === null) {
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
            error: verify.error ?? 'cc-connect not found in node_modules/.bin, the installed package bin, or PATH'
          }
        ],
        cacheWritten: false,
        cachePath,
        nextActions: [
          'Run `pnpm install` (or `npm install`) to pull cc-connect as a peaks-cli dependency; its `postinstall` script downloads the Go binary into node_modules/.bin/cc-connect.',
          'If you prefer a global install, run `npm i -g cc-connect@latest` (or `brew install cc-connect`) so the binary is on PATH; the resolver falls back to PATH after node_modules.'
        ],
        error: verify.error ?? 'cc-connect binary not resolved; see nextActions',
        resolvedSource: null
      };
    }
    // Resolver succeeded, probe failed.
    if (options.skipPostProbe === true) {
      return {
        installed: true,
        binaryPath: verify.binaryPath,
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
        cachePath,
        nextActions: ['probe skipped; run `peaks companion install` again to populate the binary-path cache'],
        error: null,
        resolvedSource: verify.resolvedSource
      };
    }
    return {
      installed: true,
      binaryPath: verify.binaryPath,
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
      cachePath,
      nextActions: [
        `Binary resolved at ${verify.binaryPath} (source=${verify.resolvedSource}) but the version probe failed: ${verify.error ?? 'unknown'}`,
        'Re-run `pnpm install` to re-trigger cc-connect postinstall, then re-run `peaks companion install` to re-probe.'
      ],
      error: verify.error ?? 'cc-connect --version probe failed',
      resolvedSource: verify.resolvedSource
    };
  }

  const probeBinary = verify.binaryPath;
  const probeVersion = verify.version;

  if (options.skipPostProbe === true) {
    return {
      installed: true,
      binaryPath: probeBinary,
      version: null,
      attempts: [
        {
          method: 'verify',
          command: 'resolve cc-connect (node_modules, then PATH)',
          ok: true,
          exitCode: 0,
          durationMs: Date.now() - started,
          error: null
        }
      ],
      cacheWritten: false,
      cachePath,
      nextActions: ['probe skipped; run `peaks companion install` again to populate the binary-path cache'],
      error: null,
      resolvedSource: verify.resolvedSource
    };
  }

  if (probeVersion === null) {
    return {
      installed: true,
      binaryPath: probeBinary,
      version: null,
      attempts: [
        {
          method: 'verify',
          command: 'resolve cc-connect (node_modules, then PATH)',
          ok: true,
          exitCode: 0,
          durationMs: Date.now() - started,
          error: null
        }
      ],
      cacheWritten: false,
      cachePath,
      nextActions: [`Binary resolved at ${probeBinary} but version probe returned no version; rerun without --skip-probe to retry`],
      error: null,
      resolvedSource: verify.resolvedSource
    };
  }

  const cacheResult = writeBinaryPathCache(
    {
      binaryPath: probeBinary,
      version: probeVersion,
      resolvedAt: new Date().toISOString(),
      source: verify.resolvedSource === 'node-modules' ? 'NODE_MODULES' : 'PATH'
    },
    options.home
  );
  return {
    installed: true,
    binaryPath: probeBinary,
    version: probeVersion,
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
      : [`cache write failed (${cacheResult.error}); binary is installed at ${probeBinary}`],
    error: cacheResult.ok ? null : cacheResult.error,
    resolvedSource: verify.resolvedSource
  };
}

export type ProbeSummary = Pick<CompanionProbe, 'binaryPath' | 'version' | 'ok' | 'error'>;

/**
 * BUG FIX (2026-06-14 dogfood): dry-run binary probe. Re-uses
 * `verifyCcConnectBinary` and explicitly does NOT write the
 * binary-path cache. Drives `peaks companion scan`.
 *
 * The result is rendered as-is by the CLI — no cache side effect.
 */
export type ScanOptions = VerifyOptions & {
  /** Override the home dir used for the cache-path lookup (test seam). */
  home?: string;
};

export type ScanResult = {
  ok: boolean;
  binaryPath: string | null;
  version: string | null;
  resolvedSource: 'node-modules' | 'path' | null;
  cachePath: string;
  cacheWritten: boolean;
  error: string | null;
  nextActions: string[];
};

export async function scanCcConnect(options: ScanOptions = {}): Promise<ScanResult> {
  const { home, ...verifyOpts } = options;
  const verify = await verifyCcConnectBinary(verifyOpts);
  const cachePath = binaryPathCacheFile(home);
  const nextActions: string[] = [];
  if (verify.ok) {
    nextActions.push(
      `next: run \`peaks companion install\` to write the binary-path cache, or \`peaks companion setup\` to render the iLink QR`
    );
  } else {
    nextActions.push(
      'run `pnpm install` (or `npm install`) to pull cc-connect as a peaks-cli dependency; its `postinstall` script downloads the Go binary into node_modules/.bin/cc-connect.',
      'If you prefer a global install, run `npm i -g cc-connect@latest` (or `brew install cc-connect`) so the binary is on PATH; the resolver falls back to PATH after node_modules.'
    );
  }
  return {
    ok: verify.ok,
    binaryPath: verify.binaryPath,
    version: verify.version,
    resolvedSource: verify.resolvedSource,
    cachePath,
    cacheWritten: false,
    error: verify.ok ? null : verify.error,
    nextActions
  };
}

// re-export so older import paths keep working
export { getErrorMessage };
