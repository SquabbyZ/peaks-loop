/**
 * Where ECC's agent definitions come from: the installed `ecc-universal`
 * npm package.
 *
 * THIS REPLACED A NETWORK ACQUISITION LAYER. Until 2026-10-04 peaks-loop
 * downloaded ECC at runtime — `api.github.com/repos/affaan-m/ECC/releases/latest`
 * → `codeload` tarball → selective extract into `~/.peaks/cache/ecc-<sha>/`
 * — guarded by a tarball-safety module, a cache manifest, a sha-directory
 * cleanup sweep and a log-retention leg that swept it. Every one of those
 * existed to make up for a premise that turned out to be false: three places in
 * this repository asserted that `affaan-m/ECC` was NOT on npm
 * (`src/services/audit/static-service.ts`, `CHANGELOG.md:1630`,
 * `src/services/code-review/ecc-bridge.ts`), and `ecc-universal` IS that
 * repository — `npm view ecc-universal repository.url` answers
 * `git+https://github.com/affaan-m/ECC.git`. A dependency ships its own files,
 * so there is nothing left to fetch, verify, extract, cache or sweep.
 *
 * WHAT REMAINS AND WHY: `ecc-universal` is a normal dependency of
 * `peaks-loop-mut`, its `agents/*.md` are read here, and the plugin-free copy
 * under `~/.peaks/agents/ecc/` (see `ecc-materialize.ts`) is kept because that
 * path is what the RD fan-out and Gate B3 read, what the skill docs tell the LLM
 * to open, and it survives a peaks-loop upgrade that changes the version-pinned
 * path below.
 *
 * The resolved path is version-PINNED under pnpm
 * (`.../.pnpm/ecc-universal@2.2.3/node_modules/ecc-universal`), which is exactly
 * why it is not a stable read target for a human opening a path by hand — hence
 * materialize, and hence this module never hands out its own directory except to
 * the copy step.
 */

import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

export const ECC_PACKAGE_NAME = 'ecc-universal';
export const ECC_AGENTS_SUBDIR = 'agents';

/** Manifest shape for the plugin-free copy. */
export const ECC_MATERIALIZE_VERSION = '2';

/**
 * Why ECC cannot be read. `not-installed` means the dependency is missing from
 * the installation (a broken or partial `npm i`); `no-agents-dir` means the
 * package is there but does not ship what this layer reads. Both are stated as
 * distinct because the remedy differs: reinstall peaks-loop versus pin a
 * different ECC version.
 */
export type EccSourceFailure = 'not-installed' | 'no-agents-dir';

export class EccSourceError extends Error {
  readonly failure: EccSourceFailure;

  constructor(failure: EccSourceFailure, detail: string) {
    super(`ecc-universal: ${failure} — ${detail}`);
    this.name = 'EccSourceError';
    this.failure = failure;
  }
}

/**
 * The package root, resolved through Node's own algorithm rather than a
 * hand-built `node_modules` path.
 *
 * `require.resolve('ecc-universal/package.json')` is the join point: it honors
 * the pnpm store layout, an npm flat install, a global install of peaks-loop,
 * and a linked workspace alike. A hardcoded `../../node_modules/ecc-universal`
 * would resolve in exactly one of those and fail in the others with an error
 * that looks like "ECC is not installed".
 */
export function resolveEccPackageRoot(): string {
  let packageJson: string;
  try {
    packageJson = createRequire(import.meta.url).resolve(`${ECC_PACKAGE_NAME}/package.json`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new EccSourceError(
      'not-installed',
      `cannot resolve ${ECC_PACKAGE_NAME}/package.json from peaks-loop-mut (${message}). ` +
        'Reinstall peaks-loop; the ECC agents ship with that dependency.'
    );
  }
  return dirname(packageJson);
}

/** The `version` the package declares — the identity a materialized copy records. */
export function readEccPackageVersion(root: string = resolveEccPackageRoot()): string {
  try {
    const parsed = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      version?: unknown;
    };
    return typeof parsed.version === 'string' ? parsed.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** `<package>/agents` — the flat `*.md` definitions the LLM consumes. */
export function resolveEccAgentsDir(root: string = resolveEccPackageRoot()): string {
  const agentsDir = join(root, ECC_AGENTS_SUBDIR);
  if (!existsSync(agentsDir)) {
    throw new EccSourceError(
      'no-agents-dir',
      `${agentsDir} does not exist; this ${ECC_PACKAGE_NAME} build ships no agents/ subtree`
    );
  }
  return agentsDir;
}

/**
 * Plugin-free materialize target: `~/.peaks/agents/ecc/`.
 *
 * Deliberately NOT under `~/.claude/` — peaks-loop must never write into the
 * user's Claude Code tree (user direction 2026-09-09). The LLM reads
 * `<target>/<agent-name>.md` directly when the ECC Claude Code plugin is
 * absent, then dispatches a generic sub-agent with that body.
 */
export function resolveEccMaterializedDir(): string {
  return join(homedir(), '.peaks', 'agents', 'ecc');
}

export function resolveEccMaterializedManifestPath(dirOverride?: string): string {
  return join(dirOverride ?? resolveEccMaterializedDir(), 'ecc-agents.json');
}

/**
 * Agent names are used to build filenames, so the whitelist is the escape
 * check. Kept as a positive allowlist rather than a denylist: anything outside
 * `^[a-z][a-z0-9-]*$` never reaches a path, whatever upstream adds later.
 */
export function isSafeAgentName(name: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(name);
}

/**
 * Owner-only mode for the peaks-owned dirs this writes. `0o700` is a POSIX mode
 * literal, not a tunable: anything wider lets another local user read the agent
 * definitions the LLM is about to be handed.
 */
// eslint-disable-next-line no-magic-numbers -- POSIX mode bits are notation, not a quantity
const PEAKS_DIR_MODE = 0o700;

/**
 * Best-effort chmod 0o700 on POSIX; no-op on Windows (NTFS uses ACLs, not POSIX
 * mode bits). Errors are swallowed with WARN so a permissions failure never
 * blocks the CLI — the files are public agent definitions, not secrets.
 */
export function setPeaksDirPermissions(dir: string): void {
  if (process.platform === 'win32') return;
  try {
    chmodSync(dir, PEAKS_DIR_MODE);
  } catch {
    /* best-effort */
  }
}

export type EccMaterializeManifest = {
  version: string;
  /** The `ecc-universal` version the copy came from. This field replaced
   *  `sha`, which named a git commit no longer involved. */
  packageVersion: string;
  materializedAt: string;
  agents: string[];
};

export type EccInstallResult = {
  targetDir: string;
  packageVersion: string;
  materialized: string[];
};
