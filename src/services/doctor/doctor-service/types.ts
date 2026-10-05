/**
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

import type {
  CodegraphManagedPathInfo,
  CodegraphCapabilityProbe,
  CodegraphExcludeIntegrityProbe,
  CodegraphIndexIntegrityProbe,
  DistVersionProbe,
  MultiBinaryDriftProbe,
  WorkspaceLayoutProbe,
  GateguardProbe,
  EccHooksDriftProbe,
  DoctorSkillPresence,
  DoctorSkillEntry,
  DoctorSkillsResult
} from './probe-types.js';

/**
 * Re-exported so `import type { … } from './types.js'` still sees the whole
 * probe surface after the b1 file-size split. The names are declared once,
 * in `./probe-types.js`.
 */
export type {
  CodegraphManagedPathInfo,
  CodegraphCapabilityProbe,
  CodegraphExcludeIntegrityProbe,
  CodegraphIndexIntegrityProbe,
  DistVersionComparison,
  DistVersionProbe,
  MultiBinaryDriftInspection,
  MultiBinaryDriftProbe,
  WorkspaceLayoutInspection,
  WorkspaceLayoutProbe,
  GateguardHookLocation,
  GateguardProbeResult,
  GateguardProbe,
  EccHooksDriftProbeResult,
  EccHooksDriftProbe,
  DoctorSkillPresence,
  DoctorSkillEntry,
  DoctorSkillLoadFailure,
  DoctorSkillsResult
} from './probe-types.js';

/**
 * Severity for a single doctor check. `'error'` flips the exit code
 * (via `buildReport` and the CLI dispatcher); `'warning'` surfaces
 * the finding in the JSON envelope (`ok: false` + `severity: 'warning'`)
 * but does NOT escalate the doctor exit code to 1.
 *
 * Optional in the type for back-compat with older check plugins that
 * pre-date the severity-aware summary (slice
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
     * repair cycle): count of findings tagged
     * `severity: 'warning'`. Warnings surface in the JSON envelope
     * (`ok: false`) but do NOT flip `summary.ok` and therefore do
     * NOT flip the doctor exit code.
     */
    warnings: number;
  };
};

export type DoctorOptions = {
  schemasBaseDir?: string;
  skillsBaseDir?: string;
  codegraphProbe?: () => CodegraphCapabilityProbe;
  /**
   * Optional override for the managed-codegraph path detection inside
   * the `capability:codegraph` check. When omitted, the check uses
   * the default resolver (`resolveCodegraphProjectRoot(process.cwd())`).
   * Tests inject a custom probe without monkey-patching
   * `process.cwd()`.
   */
  codegraphManagedPathProbe?: () => CodegraphManagedPathInfo | null;
  /**
   * Optional override for the `capability:codegraph-exclude-integrity`
   * check. Returns the integrity report, or `null` when codegraph is
   * not initialized in the inspected root (nothing to reconcile). When
   * omitted, the check inspects `process.cwd()`. Throwing is allowed
   * and reported as a non-blocking warning.
   */
  codegraphIntegrityProbe?: () => CodegraphExcludeIntegrityProbe | null;
  /**
   * Optional override for the `capability:codegraph-index-integrity`
   * check. Returns the report, or `null` when codegraph is not
   * initialized in the inspected root (no index to inspect). When
   * omitted, the check inspects `process.cwd()`. Throwing is allowed
   * and reported as a non-blocking warning.
   */
  codegraphIndexIntegrityProbe?: () => CodegraphIndexIntegrityProbe | null;
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
   * (G3/G4) — injected for the build:multi-binary-drift check (defaults
   * to inspectMultiBinaryDrift against `process.env.PATH`).
   */
  multiBinaryDriftProbe?: MultiBinaryDriftProbe;
  /** Injected for the build:workspace-layout-canonical check (defaults to inspectWorkspaceLayout on disk). */
  workspaceLayoutProbe?: WorkspaceLayoutProbe;
  /** Injected for the integration:gateguard-peaks-conflict check (defaults to defaultGateguardProbe on disk). */
  gateguardProbe?: GateguardProbe;
  /** Injected for the integration:ecc-hooks-schema-drift check (defaults to defaultEccHooksDriftProbe on disk). */
  eccHooksDriftProbe?: EccHooksDriftProbe;
  /**
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
