/**
 * Declarations extracted from `sync-service.ts` by the b1 file-size
 * campaign: the platform allowlist, the sync types, and the two small
 * pure helpers (platform validator + installer test seam). `sync-service.ts`
 * re-exports every name so importers keep the original path.
 */
import { pathToFileURL } from 'node:url';
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
  'openclaw'
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
  /** Reconcile managed Junctions that point at deleted host worktrees. */
  readonly reconcileJunctions?: boolean | undefined;
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

export interface InstallBundledSkillsOptions {
  readonly ideId: IdeId;
  readonly projectRoot: string;
  readonly dryRun?: boolean;
  readonly reconcileJunctions?: boolean;
  readonly targetRoot?: string;
}

export interface InstallResult {
  readonly installed: readonly string[];
  readonly skipped: readonly string[];
}

export type InstallerFn = (opts: InstallBundledSkillsOptions) => InstallResult;

/**
 * Test seam: attempt to import the installer at `scriptPath`.
 * Returns the `installBundledSkills` function on success, or
 * `null` when the file is missing / not importable. The
 * production code calls this through `loadInstaller`; tests
 * `vi.spyOn` it to drive the three-tier probe without touching
 * the real filesystem.
 */
export async function loadInstallerForTest(scriptPath: string): Promise<InstallerFn | null> {
  try {
    const mod = (await import(pathToFileURL(scriptPath).href)) as {
      installBundledSkills: InstallerFn;
    };
    return mod.installBundledSkills;
  } catch {
    // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }
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
