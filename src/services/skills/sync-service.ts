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
 */
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
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

let cachedInstaller: ((opts: InstallBundledSkillsOptions) => InstallResult) | null = null;

async function loadInstaller(): Promise<(opts: InstallBundledSkillsOptions) => InstallResult> {
  if (cachedInstaller !== null) return cachedInstaller;
  const scriptPath = join(process.cwd(), 'scripts', 'install-skills.mjs');
  const mod = (await import(pathToFileURL(scriptPath).href)) as {
    installBundledSkills: (opts: InstallBundledSkillsOptions) => InstallResult;
  };
  cachedInstaller = mod.installBundledSkills;
  return cachedInstaller;
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
