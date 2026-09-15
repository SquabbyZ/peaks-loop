// Type declarations for install-skills.mjs.
// Manually-maintained companion file; keep in sync with the .mjs.
//
// WHY THIS EXISTS (S6, 2026-09-15). Without it, every typed import of the
// postinstall script fails with TS7016 ("implicitly has an 'any' type") under
// `tsc -p tsconfig.json`, which is the config `slice-check-service` measures
// against a fixed pre-existing baseline. Two test files import this module —
// `tests/integration/ide/install-skills-dispatch.test.ts` (pre-existing, one
// of the baseline's errors) and
// `tests/unit/ide/install-skills-postinstall-convergence.test.ts` (S6) — so
// leaving it undeclared meant every new test of the postinstall moved a
// baseline that exists precisely so tests can be added without moving it.
//
// Companion `.d.mts` files are this repo's existing convention for the plain
// `.mjs` build scripts under `scripts/` (see `_release-shared.d.mts`).

export interface IdeDetectionEntry {
  id: string;
  dir: string;
}

export interface IdeSkillInstallProfile {
  skillsDir: string;
  outputStylesDir: string;
  agentsDir?: string;
  envVar: string;
  outputStylesEnvVar: string;
  agentsEnvVar?: string;
  /**
   * Installed for even when nothing detects the tool and its home directory
   * does not exist. Set on `claude-code` only (primary runtime + legacy
   * default). Deliberately a DATA field rather than an identity branch in the
   * consumer — see `isPlatformPresent`.
   */
  alwaysPresent?: boolean;
}

export const IDE_DETECTION_DIRS: ReadonlyArray<IdeDetectionEntry>;
export const IDE_SKILL_INSTALL_PROFILES: Readonly<Record<string, IdeSkillInstallProfile>>;

export interface InstallResult {
  installed: string[];
  skipped: string[];
}

export interface PerPlatformInstallResult extends InstallResult {
  ideId: string;
  /** `skillsDir` (skills fan-out) or `agentsDir` (agents fan-out). */
  skillsDir?: string;
  agentsDir?: string;
  error?: string;
}

export interface ConfigResult {
  created: boolean;
  updated: boolean;
  skipped: boolean;
}

export interface ScriptOptions {
  packageRoot?: string;
  projectRoot?: string;
  targetRoot?: string;
  ideId?: string;
  userRoot?: string;
  settingsFile?: string;
  cwd?: string;
  reconcileJunctions?: boolean;
}

export function installUserConfig(options?: ScriptOptions): ConfigResult;
export function installBundledSkills(options?: ScriptOptions): InstallResult;
export function installBundledSkillsForAllPlatforms(options?: ScriptOptions): PerPlatformInstallResult[];
export function installBundledOutputStyles(options?: ScriptOptions): InstallResult;
export function installBundledAgents(options?: ScriptOptions): InstallResult;
export function installBundledAgentsForAllPlatforms(options?: ScriptOptions): PerPlatformInstallResult[];

/**
 * Present only when the write succeeded; on the soft-fail paths the script
 * returns a subset carrying `skipped: true` and a `reason`.
 */
export function installBundledOutputStyleDefault(options?: ScriptOptions): {
  skipped?: boolean;
  installed?: boolean;
  created?: boolean;
  updated?: boolean;
  reason?: string;
  settingsPath?: string;
  outputStyle?: string;
  error?: string;
};

export function detect1xProjectState(cwd?: string): {
  isOneX: boolean;
  signals: string[];
  projectRoot: string | null;
  configPath: string | null;
};

export function autoUpgrade1xProjectIfPresent(options?: ScriptOptions): Promise<{
  ran: boolean;
  reason: string;
  signals?: string[];
  projectRoot?: string;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  error?: string;
}>;
