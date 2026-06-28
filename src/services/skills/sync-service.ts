/**
 * peaks skill sync — fan-out the peaks-* skill family to all 8
 * supported LLM-CLI platforms. Per spec §9 line 1105 (Slice #12
 * final piece): "peaks skills sync 8 平台分发".
 *
 * The 8 target platforms are enumerated by the `IdeId` union
 * (src/services/ide/ide-types.ts:16-24). The per-IDE install
 * profile is `IdeSkillInstall`; the actual symlink installer
 * is `scripts/install-skills.mjs::installBundledSkills` (dynamically
 * imported so this module does not require a build step).
 *
 * Slice 2.0.1-bug2-skill-sync-fallback: when peaks-cli is
 * installed from npm into a consumer project, that consumer's
 * CWD does not contain `scripts/install-skills.mjs`. The previous
 * hard-coded `join(process.cwd(), 'scripts', 'install-skills.mjs')`
 * therefore threw `ERR_MODULE_NOT_FOUND` in every consumer run.
 * The fix is a three-tier probe:
 *   1. peaks-cli's own install path (resolved from
 *      `import.meta.url` walking up to the package root, or
 *      from `process.argv[1]` for CJS-equivalent entrypoints),
 *   2. the consumer CWD (`<cwd>/scripts/install-skills.mjs`),
 *   3. graceful skip — warn once per process, return a no-op
 *      installer so the per-platform result is `ok: true` with
 *      `installed: []` and a `skipped` rationale.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { IdeId } from '../ide/ide-types.js';

/**
 * The 8 platforms per Slice #12 final piece. Slice #0.7 + Slice
 * #0.5.2 registered these in the IdeId union; this list is the
 * single source of truth for the sync fan-out.
 */
export const SYNC_PLATFORMS: readonly IdeId[] = [
  'claude-code',
  'trae',
  'codex',
  'cursor',
  'qoder',
  'tongyi-lingma',
  'hermes',
  'openclaw',
];

export interface PlatformSyncResult {
  /** The platform that was attempted. */
  readonly platform: IdeId;
  /** True if installBundledSkills returned without error. */
  readonly ok: boolean;
  /** Skills newly symlinked (idempotent re-runs return []). */
  readonly installed: readonly string[];
  /** Skills whose target was not a managed symlink (third-party owned). */
  readonly skipped: readonly string[];
  /** Error message; present when ok=false. */
  readonly error?: string;
  /** Wall-clock duration in ms. */
  readonly durationMs: number;
}

export interface SyncServiceInput {
  readonly projectRoot: string;
  /** When omitted, the service iterates all 8 platforms. */
  readonly platforms?: readonly IdeId[] | undefined;
  /** When true, the installer is invoked in dry-run mode. */
  readonly dryRun?: boolean | undefined;
}

export interface SyncServiceResult {
  readonly applied: boolean;
  readonly dryRun: boolean;
  readonly projectRoot: string;
  readonly perPlatform: readonly PlatformSyncResult[];
  readonly syncedCount: number;
  readonly failedCount: number;
  readonly totalInstalled: number;
}

interface InstallBundledSkillsOptions {
  readonly ideId: IdeId;
  readonly projectRoot: string;
  readonly dryRun?: boolean;
  readonly targetRoot?: string;
}

interface InstallResult {
  readonly installed: readonly string[];
  readonly skipped: readonly string[];
}

type InstallerFn = (opts: InstallBundledSkillsOptions) => InstallResult;

/**
 * Sentinel: the resolver ran, found no installer, and warned.
 * Memoized so subsequent `loadInstaller()` calls short-circuit
 * without re-walking the filesystem on every platform iteration.
 */
const NO_INSTALLER_SENTINEL: unique symbol = Symbol('sync-service.no-installer');

/**
 * Cache state: either an installer function, the "not found"
 * sentinel, or `null` (cache cold, first probe still pending).
 */
let cachedInstaller: InstallerFn | typeof NO_INSTALLER_SENTINEL | null = null;

/**
 * No-op installer used when neither candidate path resolves to
 * an importable `install-skills.mjs`. Reports zero installs and
 * a single skip reason so the per-platform result is `ok: true`
 * with an explainable `skipped` line.
 */
function noopInstaller(_opts: InstallBundledSkillsOptions): InstallResult {
  return {
    installed: [],
    skipped: [
      'install-skills.mjs not found in project; skill sync skipped — bundled skills are installed via peaks-cli postinstall',
    ],
  };
}

/**
 * Internal indirection table for the test seam. The production
 * `loadInstaller` reads `services.resolvePeaksCliInstallerPath()`
 * and `services.loadInstallerForTest()` at call time, so a
 * `vi.spyOn(services, 'resolvePeaksCliInstallerPath')` in tests
 * takes effect (ES module top-level `const` captures the original
 * reference and would bypass the spy).
 */
const services: {
  resolvePeaksCliInstallerPath(): string | null;
  loadInstallerForTest(scriptPath: string): Promise<InstallerFn | null>;
} = {
  resolvePeaksCliInstallerPath,
  loadInstallerForTest,
};

/**
 * Resolve the path of `install-skills.mjs` inside the peaks-cli
 * install root, walking up from `import.meta.url` until a
 * `package.json` with `"name": "peaks-cli"` is found. Returns
 * `null` when peaks-cli is not on the import path or the script
 * is absent (e.g. a partial install).
 */
export function resolvePeaksCliInstallerPath(): string | null {
  const candidates: string[] = [];

  // Tier 1a: walk up from this module's URL.
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    let cursor = here;
    for (let depth = 0; depth < 8; depth += 1) {
      const pkgJson = join(cursor, 'package.json');
      if (existsSync(pkgJson)) {
        candidates.push(join(cursor, 'scripts', 'install-skills.mjs'));
        break;
      }
      const parent = dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    // import.meta.url may be unavailable in some bundlers; fall through.
  }

  // Tier 1b: process.argv[1] (the entrypoint). Useful when this
  // module is bundled or shimmed.
  try {
    const argvEntry = process.argv[1];
    if (typeof argvEntry === 'string' && argvEntry.length > 0) {
      let cursor = resolvePath(dirname(argvEntry));
      for (let depth = 0; depth < 8; depth += 1) {
        const pkgJson = join(cursor, 'package.json');
        if (existsSync(pkgJson)) {
          candidates.push(join(cursor, 'scripts', 'install-skills.mjs'));
          break;
        }
        const parent = dirname(cursor);
        if (parent === cursor) break;
        cursor = parent;
      }
    }
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    // process.argv may be unavailable in some runtimes; fall through.
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Test seam: attempt to import the installer at `scriptPath`.
 * Returns the `installBundledSkills` function on success, or
 * `null` when the file is missing / not importable. The
 * production code calls this through `loadInstaller`; tests
 * `vi.spyOn` it to drive the three-tier probe without touching
 * the real filesystem.
 */
export async function loadInstallerForTest(
  scriptPath: string
): Promise<InstallerFn | null> {
  try {
    const mod = (await import(pathToFileURL(scriptPath).href)) as {
      installBundledSkills: InstallerFn;
    };
    return mod.installBundledSkills;
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }
}

/**
 * Resolve and load the installer, memoizing the outcome.
 * Three-tier probe (peaks-cli install path → CWD → no-op),
 * with the "not found" outcome memoized as a sentinel so the
 * warning is logged at most once per process.
 *
 * The probe delegates to the `services` indirection table so
 * tests can `vi.spyOn(services, 'resolvePeaksCliInstallerPath')`
 * and have the spied value take effect at runtime (direct
 * module-level calls would bind the original function at load
 * time and bypass the spy).
 */
async function loadInstaller(): Promise<InstallerFn> {
  if (cachedInstaller === NO_INSTALLER_SENTINEL) {
    return noopInstaller;
  }
  if (cachedInstaller !== null) {
    return cachedInstaller;
  }

  // Tier 1: peaks-cli install path.
  const peaksCliScript = services.resolvePeaksCliInstallerPath();
  if (peaksCliScript !== null) {
    const installer = await services.loadInstallerForTest(peaksCliScript);
    if (installer !== null) {
      cachedInstaller = installer;
      return installer;
    }
  }

  // Tier 2: consumer CWD.
  const cwdScript = join(process.cwd(), 'scripts', 'install-skills.mjs');
  const cwdInstaller = await services.loadInstallerForTest(cwdScript);
  if (cwdInstaller !== null) {
    cachedInstaller = cwdInstaller;
    return cwdInstaller;
  }

  // Tier 3: graceful skip. Warn once per process.
  cachedInstaller = NO_INSTALLER_SENTINEL;
  // eslint-disable-next-line no-console -- intentional user-visible signal
  console.warn(
    'peaks skill sync: install-skills.mjs not found in project; ' +
      'skipping (bundled skills come from peaks-cli postinstall).'
  );
  return noopInstaller;
}

/**
 * Validate a single platform id against the SYNC_PLATFORMS
 * allowlist. Throws on a bogus value.
 */
export function assertValidPlatform(platform: string): asserts platform is IdeId {
  if (!(SYNC_PLATFORMS as readonly string[]).includes(platform)) {
    throw new Error(
      `peaks skill sync: unknown platform "${platform}". ` +
        `Valid platforms: ${SYNC_PLATFORMS.join(', ')}`
    );
  }
}

export async function runSkillSync(input: SyncServiceInput): Promise<SyncServiceResult> {
  const platforms: readonly IdeId[] = input.platforms ?? SYNC_PLATFORMS;
  for (const p of platforms) {
    assertValidPlatform(p);
  }
  const dryRun = input.dryRun === true;
  const installer = await loadInstaller();

  const perPlatform: PlatformSyncResult[] = [];
  let syncedCount = 0;
  let failedCount = 0;
  let totalInstalled = 0;

  for (const platform of platforms) {
    const start = Date.now();
    try {
      const result = installer({
        ideId: platform,
        projectRoot: input.projectRoot,
        ...(dryRun ? { dryRun: true } : {}),
      });
      perPlatform.push({
        platform,
        ok: true,
        installed: result.installed,
        skipped: result.skipped,
        durationMs: Date.now() - start,
      });
      syncedCount += 1;
      totalInstalled += result.installed.length;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      perPlatform.push({
        platform,
        ok: false,
        installed: [],
        skipped: [],
        error: message,
        durationMs: Date.now() - start,
      });
      failedCount += 1;
    }
  }

  return {
    applied: !dryRun,
    dryRun,
    projectRoot: input.projectRoot,
    perPlatform,
    syncedCount,
    failedCount,
    totalInstalled,
  };
}

/**
 * Test-only export surface. Not part of the public API; subject
 * to breaking changes without a major version bump.
 *
 * The seam exposes the `services` indirection table (so tests
 * can `vi.spyOn` the resolver and loader) and a cache reset.
 */
export const __testing = {
  services,
  resetInstallerCache(): void {
    cachedInstaller = null;
  },
};
