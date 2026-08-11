/**
 * doctor-service types and shared interfaces (slice rid-004).
 *
 * This module is the public type surface for the code-driven fixed
 * registry of doctor checks. Each check is a `DoctorCheckPlugin`
 * that receives a shared `DoctorContext` (built once at the top of
 * `runDoctor`) and returns the `DoctorCheck[]` it emits. The registry
 * in `plugin-registry.ts` lists the plugins in fixed execution order.
 *
 * The legacy `runDoctor` API is preserved end-to-end: the public
 * `DoctorCheck / DoctorReport / DoctorOptions / *Probe` types still
 * flow through the same names so the main package's `import { runDoctor }`
 * keeps working unchanged.
 */

/**
 * Severity for a single doctor check. `'error'` flips the exit code
 * (via `buildReport` and the CLI dispatcher); `'warning'` surfaces
 * the finding in the JSON envelope (`ok: false` + `severity: 'warning'`)
 * but does NOT escalate the doctor exit code to 1.
 *
 * Optional in the type for back-compat with older check plugins that
 * pre-date the severity-aware summary (slice
 * 2026-08-05-statusline-sid-only-marker-and-multi-binary-drift-guard
 * repair cycle). When omitted, the dispatcher treats the check as
 * `'error'` — i.e. `ok: false` escalates the exit code the same way
 * it did before this slice.
 */
export type DoctorCheckSeverity = 'error' | 'warning';

export type DoctorCheck = {
  id: string;
  ok: boolean;
  message: string;
  /**
   * Optional severity tag. When `'warning'`, the check still reports
   * `ok: false` (so operators see the finding in the JSON envelope)
   * but `buildReport` does NOT count it as a failure for the
   * `summary.ok` exit-code calculation. Default-omitted checks
   * behave as `'error'`.
   */
  severity?: DoctorCheckSeverity;
};

export type DoctorReport = {
  checks: DoctorCheck[];
  summary: {
    ok: boolean;
    passed: number;
    failed: number;
    /**
     * Severity-aware summary (slice
     * 2026-08-05-statusline-sid-only-marker-and-multi-binary-drift-guard
     * repair cycle): count of findings tagged
     * `severity: 'warning'`. Warnings surface in the JSON envelope
     * (`ok: false`) but do NOT flip `summary.ok` and therefore do
     * NOT flip the doctor exit code.
     */
    warnings: number;
  };
};

export type CodegraphManagedPathInfo = {
  source: 'preferred' | 'legacy' | 'fresh-preferred';
  codegraphDir: string;
  cwd: string;
};

export type CodegraphCapabilityProbe = {
  packagePath: string;
  version: string;
  binaryPath: string;
  binaryExists: boolean;
  /**
   * Slice rid-CG-003 — preferred-path resolution result. When the
   * probe can detect `.peaks/.codegraph/` or `.codegraph/` inside
   * `process.cwd()` it sets `managedPath`; otherwise null (e.g.
   * when the operator invoked `peaks doctor` outside a project).
   *
   * `source: 'preferred'`     — `.peaks/.codegraph/` exists
   * `source: 'legacy'`        — only `.codegraph/` exists
   * `source: 'fresh-preferred'` — neither exists; defaults to preferred
   */
  managedPath: CodegraphManagedPathInfo | null;
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

export type DoctorOptions = {
  schemasBaseDir?: string;
  skillsBaseDir?: string;
  codegraphProbe?: () => CodegraphCapabilityProbe;
  /**
   * Slice rid-CG-003 — optional override for the managed-codegraph
   * path detection inside the `capability:codegraph` check. When
   * omitted, the check uses the default fs helper
   * (`resolveCodegraphProjectRoot(process.cwd())`). Tests inject a
   * custom probe to drive preferred / legacy / fresh-preferred
   * outcomes without monkey-patching `process.cwd()`.
   */
  codegraphManagedPathProbe?: () => CodegraphManagedPathInfo | null;
  skillPresenceProbe?: () => DoctorSkillPresence | null;
  skillPresenceFreshnessThresholdMs?: number;
  statusLineInstalledProbe?: () => boolean;
  /** Returns true when a Peaks workspace session (.peaks/.session.json) exists. */
  workspaceInitializedProbe?: () => boolean;
  /** Platform string (defaults to process.platform); injectable for tests. */
  platform?: NodeJS.Platform;
  /** Injected for the build:dist-version-matches-source check (defaults to compareDistVersion on disk). */
  distVersionProbe?: DistVersionProbe;
  /**
   * Slice 2026-08-05-statusline-sid-only-marker-and-multi-binary-drift-guard
   * (G3/G4) — injected for the build:multi-binary-drift check (defaults
   * to inspectMultiBinaryDrift against `process.env.PATH`).
   */
  multiBinaryDriftProbe?: MultiBinaryDriftProbe;
  /** Injected for the build:workspace-layout-canonical check (defaults to inspectWorkspaceLayout on disk). */
  workspaceLayoutProbe?: WorkspaceLayoutProbe;
  /** Injected for the integration:gateguard-peaks-conflict check (defaults to defaultGateguardProbe on disk). */
  gateguardProbe?: GateguardProbe;
  /**
   * Slice 2026-06-13-repair-pre-existing-test-failures: injected
   * root for the L3:l3-memory-health check (defaults to
   * `findProjectRoot(process.cwd())`). Tests use this to point the
   * check at a temp dir without monkey-patching `findProjectRoot`.
   */
  l3ProjectRoot?: string;
  /**
   * slice-3b Option C: injected project-root resolver.
   * Replaces the legacy direct call to
   * `findProjectRoot(process.cwd())` from
   * `src/services/config/config-safety.ts`. Defaults to a noop
   * (`() => null`) so standalone tests do not depend on the main
   * package; the CLI wires `findProjectRoot(process.cwd())` at
   * call-site.
   */
  projectRootResolver?: () => string | null;
  /**
   * slice-3b Option C: injected skill loader.
   * Replaces `loadSkillRegistry` from
   * `src/services/skills/skill-registry.ts`. Defaults to a noop
   * `Promise<{ skills: [], failures: [] }>` so standalone tests do
   * not depend on the main package; the CLI wires the real loader
   * at call-site.
   */
  loadSkills?: (skillsBaseDir?: string) => Promise<DoctorSkillsResult>;
  /**
   * slice-3b Option C: injected sid validator.
   * Replaces `isValidSessionId` from
   * `src/services/workspace/sid-naming-guard.ts`. Defaults to the
   * canonical regex below (kept in sync with the main-package
   * source). The CLI may inject a different implementation but
   * should keep behaviour identical.
   */
  isValidSessionIdProbe?: (sid: string) => boolean;
};

/**
 * Shared context passed to every plugin. The context is built once at
 * the top of `runDoctor` and is read-only for the duration of check
 * execution — plugins must not mutate it.
 *
 * The set of fields is the minimum union of state that the legacy
 * monolithic `runDoctor` derived locally. Each plugin reads only what
 * it needs; nothing forces a plugin to consume every field.
 */
export type DoctorContext = {
  /** The options object passed to `runDoctor`. */
  readonly options: DoctorOptions;
  /** Loaded skill registry (skills + failures). Already populated. */
  readonly registry: DoctorSkillsResult;
  /** Skills extracted from the registry (alias for `registry.skills`). */
  readonly skills: DoctorSkillEntry[];
  /** Resolved schema root dir for the schema validity check. */
  readonly schemaRoot: string;
  /** Skill presence result (null when no probe is wired or the probe returned null). */
  readonly presence: DoctorSkillPresence | null;
  /** Workspace initialized boolean (false when probe missing or not yet initialized). */
  readonly workspaceInitialized: boolean;
  /** Statusline installed boolean (false when probe missing or not installed). */
  readonly statusLineInstalled: boolean;
  /** Resolved platform string (defaults to process.platform). */
  readonly platform: NodeJS.Platform;
  /** Resolved L3 project root (defaults to projectRootResolver() ?? process.cwd()). */
  readonly resolvedL3Root: string;
  /** Final injected project-root resolver. */
  readonly projectRootResolver: () => string | null;
  /** Final injected session-id validator. */
  readonly isValidSessionId: (sid: string) => boolean;
  /**
   * Mutable accumulator of checks emitted by prior plugins in the
   * registry. The dispatcher (index.ts) updates this BEFORE each
   * plugin runs so the `check-id-schema` self-validation sees the
   * full prior check list. Reads treat it as a snapshot.
   *
   * The field is intentionally a live mutable reference rather
   * than a per-plugin snapshot — building a snapshot for every
   * plugin would cost O(n²) on the accumulated array size and
   * add nothing the dispatcher cannot already guarantee.
   */
  readonly accumulatedChecks: readonly DoctorCheck[];
};

/**
 * Doctor check plugin contract. Each plugin receives a shared context
 * and returns the `DoctorCheck[]` it emits. Plugins may be sync or
 * async; the registry runs them in order via `await`.
 *
 * Design: the plugin is the smallest possible closure over the
 * context — it owns no mutable state, so the same plugin instance
 * can be safely reused across multiple `runDoctor()` calls. The
 * plugin name doubles as the human-readable identifier in any future
 * `--list-checks` style diagnostic.
 */
export type DoctorCheckPlugin = {
  /** Stable identifier (e.g. `skill-existence`). Used by tests and registry debugging. */
  readonly name: string;
  /** Run the check; return every check this plugin emits (typically 1+). */
  run: (context: DoctorContext) => Promise<readonly DoctorCheck[]> | readonly DoctorCheck[];
};