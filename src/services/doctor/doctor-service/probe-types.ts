/**
 * Injected-probe payload types for the doctor registry, hoisted verbatim out
 * of `types.ts` by the b1 file-size campaign: the codegraph capability /
 * exclude-integrity / index-integrity shapes, the dist-version, multi-binary
 * drift, workspace-layout and gateguard / ECC-hooks probe results, the
 * skill-presence / skill-registry subsets, and the function aliases
 * `DoctorOptions` takes for each. Every name is re-exported from `types.ts`,
 * so the check plugins reading `import type { … } from '../types.js'` and the
 * tests importing `doctor-service/types` keep resolving through the original
 * path; the `DoctorCheck` / `DoctorReport` / `DoctorOptions` /
 * `DoctorContext` / `DoctorCheckPlugin` contract surface stays where it was.
 * No field, doc comment or union member was edited.
 */

export type CodegraphManagedPathInfo = {
  source: 'root';
  codegraphDir: string;
  cwd: string;
};

export type CodegraphCapabilityProbe = {
  packagePath: string;
  version: string;
  binaryPath: string;
  binaryExists: boolean;
  /**
   * Root-only managed-path resolution result. The check resolves the
   * single codegraph data directory, `<cwd>/.codegraph/`, relative to
   * the cwd the doctor was invoked from; null only when resolution is
   * unavailable (e.g. the operator invoked `peaks doctor` outside a
   * resolvable directory).
   */
  managedPath: CodegraphManagedPathInfo | null;
};

/**
 * Structural shape of the codegraph exclude-integrity report the
 * `capability:codegraph-exclude-integrity` check gates on. Declared
 * structurally (rather than imported from the codegraph service) to
 * keep this type module dependency-free — the default probe returns a
 * `CodegraphExcludeIntegrityReport`, which is assignable here.
 */
export type CodegraphExcludeIntegrityProbe = {
  readonly configPath: string;
  readonly gap: boolean;
  readonly trackedSourceCount: number;
  readonly excludedTrackedCount: number;
  readonly rulesToRemove: readonly string[];
  /** One entry per (file, rule) pair. */
  readonly violations: readonly { readonly path: string; readonly matchedRule: string }[];
};

/**
 * Structural shape of the codegraph index-integrity report the
 * `capability:codegraph-index-integrity` check gates on. Declared
 * structurally (rather than imported from the codegraph service) to
 * keep this type module dependency-free — the default probe returns a
 * `CodegraphIndexIntegrityReport`, which is assignable here.
 */
export type CodegraphIndexIntegrityProbe = {
  readonly gap: boolean;
  readonly trackedSourceCount: number;
  readonly admittedTrackedCount: number;
  /** Class ① — extractor-supported tracked files `include` does not admit. */
  readonly includeGap: readonly string[];
  readonly indexedFileCount: number;
  /** Class ② — index rows whose path is gone from disk. */
  readonly deadRows: readonly string[];
};

export type DistVersionComparison = {
  dist: string | null;
  source: string;
  match: boolean;
  distReadable: boolean;
};

export type DistVersionProbe = () => DistVersionComparison;

/**
 * Slice 2026-08-05-statusline-sid-only-marker-and-multi-binary-drift-guard
 * (G3/G4) — probe for the multi-binary drift check. The probe returns
 * the discovered peaks-loop binaries on PATH (with their resolved
 * version + install date) and a `driftDetected` flag. Injected so tests
 * can drive the filesystem walk without monkey-patching
 * `process.env.PATH` or `realpathSync`.
 */
export type MultiBinaryDriftInspection = {
  readonly binaries: ReadonlyArray<{
    readonly path: string;
    readonly version: string | null;
    readonly installDate: string | null;
  }>;
  readonly driftDetected: boolean;
  readonly uniqueVersions: ReadonlyArray<string>;
};

export type MultiBinaryDriftProbe = () => MultiBinaryDriftInspection;

export type WorkspaceLayoutInspection = {
  topLevelSessionDirs: string[];
  legacyDotfiles: string[];
  /**
   * Slice 007 — per-change-id top-level dirs (e.g. `.peaks/001-2026-06-06-.../`).
   * The pre-F3 canonical layout put reviewable artifacts under a
   * per-change-id top-level dir; the post-F3 canonical layout
   * consolidates them under `.peaks/_runtime/<sid>/<role>/`. Any
   * leftover per-change-id top-level dir is a regression to flag.
   * Slice 008's migration will consolidate these; until then, the
   * check reports them as `ok: false`.
   *
   * Optional in the type for back-compat with test probes that
   * pre-date the slice 007 broadening; the check itself falls back
   * to an empty array when the field is missing.
   */
  perChangeIdDirs?: string[];
  /**
   * Slice 4.0.11 statusline-sid-scoped-lease C — single-slot
   * presence files that are stale after the sid-scoped lease
   * projection shipped in 4.0.8. Reported separately from
   * `legacyDotfiles` so the doctor message names the specific
   * "stale single-slot presence" condition. Optional for back-compat
   * with probes injected by older tests.
   */
  staleSingleSlotFiles?: string[];
};

export type WorkspaceLayoutProbe = () => WorkspaceLayoutInspection;

/**
 * 2026-06-10 — `gateguard-fact-force` (a third-party PreToolUse hook,
 * NOT peaks-loop) fires on Edit / Write and demands a 4-fact questionnaire
 * before allowing the edit. When the LLM is in a peaks-qa flow and tries
 * to update `.peaks/_runtime/<sid>/qa/requests/*.md` via the Edit/Write
 * tool, the hook demands facts that are inapplicable to QA envelope
 * templates (no importers, no public API, no data files, user
 * instruction already in the conversation context). The check detects
 * this hook in the user's global and project `.claude/settings.json` and
 * warns when no `.peaks/**` skip is configured. The probe is injected so
 * tests do not depend on the real `~/.claude/settings.json` state.
 */
export type GateguardHookLocation = {
  /** Source file the hook was discovered in (`global` or `project .claude/settings.json`). */
  source: 'global' | 'project';
  /** Resolved absolute path to the source file (for the message). */
  sourcePath: string;
  /** The PreToolUse entry that contains a gateguard hook command. */
  entry: {
    matcher?: string;
    hooks: ReadonlyArray<{ type?: string; command?: string }>;
  };
};

export type GateguardProbeResult = {
  /** Absolute path to `~/.claude/settings.json` (or null when the probe could not resolve it). */
  globalSettingsPath: string | null;
  /** Parsed global settings payload (or null when missing / unreadable / malformed). */
  globalSettings: unknown;
  /** Absolute path to the project `.claude/settings.json` (or null when the project root is not in a peaks project). */
  projectSettingsPath: string | null;
  /** Parsed project settings payload (or null when missing / unreadable / malformed). */
  projectSettings: unknown;
};

export type GateguardProbe = () => GateguardProbeResult;

/**
 * 2026-09-12 — the third-party ECC plugin (github.com/affaan-m/ECC)
 * ships `$schema` at the root of its `hooks/hooks.json` plus
 * `description` + `id` on every matcher group. Claude Code's plugin
 * hook schema accepts only `{ matcher, hooks }` per matcher group, and
 * at the root `hooks` plus an OPTIONAL top-level `description`, so it
 * prints an `unknown keys ... ignored`
 * line at startup for the 47 extra keys (cosmetic — the hooks still
 * load). The probe is injected so tests never read the real
 * `~/.claude/plugins/` tree.
 */
export type EccHooksDriftProbeResult = {
  /** Absolute path to the ECC plugin's `hooks/hooks.json` (null when the plugin is not installed). */
  hooksPath: string | null;
  /** Parsed `hooks/hooks.json` payload (null when missing / unreadable). */
  hooks: unknown;
};

export type EccHooksDriftProbe = () => EccHooksDriftProbeResult;

/**
 * Subset of SkillPresence consumed by the doctor (slice-3b: the full
 * `SkillPresence` type lives in `src/services/skills/skill-presence-service.ts`;
 * the doctor only needs `skill / mode / gate / setAt` for the freshness /
 * workspace / statusline checks). The probe-returned object must satisfy
 * this structural shape; the main package reuses the upstream
 * `SkillPresence` directly so callers do not need to remap.
 */
export type DoctorSkillPresence = {
  skill: string;
  mode?: string;
  gate?: string;
  setAt: string;
};

/**
 * Subset of SkillMetadata consumed by the doctor (slice-3b: the full
 * type lives in `src/services/skills/skill-registry.ts`; the doctor only
 * needs `name / directory / skillPath` for the runbook / name-match /
 * schema checks). Failures from upstream have `directory + message`.
 */
export type DoctorSkillEntry = {
  name: string;
  directory: string;
  skillPath: string;
};

export type DoctorSkillLoadFailure = {
  directory: string;
  skillPath: string;
  message: string;
};

export type DoctorSkillsResult = {
  skills: DoctorSkillEntry[];
  failures: DoctorSkillLoadFailure[];
};
