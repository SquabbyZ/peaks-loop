/**
 * IDE-aware wrapper for `peaks standards init` / `peaks standards update`.
 *
 * Slice #011-2026-06-07-ide-adapter-resource-profile: the original
 * `executeProjectStandardsInit` / `executeProjectStandardsUpdate` always
 * wrote to `CLAUDE.md` + `.claude/rules/**` regardless of which IDE
 * the user was running. This wrapper dispatches on the IDE detected
 * (or explicitly requested via `--ide`) and falls back to the legacy
 * Claude Code path with a stderr warning when the detected IDE has
 * no `standardsProfile` declared (Trae in slice 1.3.2).
 *
 * Two entry points:
 *
 *   - `executeProjectStandardsInitIdeAware` — same signature as the
 *     underlying `executeProjectStandardsInit`, plus an optional
 *     `ideId` override that bypasses detection.
 *   - `executeProjectStandardsUpdateIdeAware` — same shape, for the
 *     `update` flow.
 *
 * Detection precedence:
 *   1. Explicit `options.ideId` (CLI `--ide` flag)
 *   2. `IdeRegistry.detect()` from cwd (or the `projectRoot` if given)
 *   3. `null` (no IDE detected) → fall back to the legacy Claude Code path
 *
 * Fallback behavior: when the resolved IDE has no `standardsProfile`
 * declared, the wrapper STILL calls the legacy Claude Code writer
 * (so the user gets the files they would have gotten before slice #011)
 * and emits a stderr warning with the IDE id and the fact that the
 * adapter is UNVERIFIED for the standards profile. This keeps the
 * "Trae is UNVERIFIED, ship a working file tree, surface the gap"
 * contract intact.
 */
import type { IdeId } from '../ide/ide-types.js';
import {
  detectAllResourceTargets,
  getStandardsProfile,
} from '../ide/resource-profile.js';
import {
  type ProjectStandardsInitOptions,
  type ProjectStandardsInitResult,
  type ProjectStandardsUpdateResult,
  executeProjectStandardsInit,
  executeProjectStandardsUpdate,
} from './project-standards-service.js';
import { detectInstalledIde } from '../ide/ide-detector.js';

export type { ProjectStandardsInitResult, ProjectStandardsUpdateResult };

export type ProjectStandardsIdeAwareOptions = ProjectStandardsInitOptions & {
  /**
   * Explicit IDE override. When set, bypasses `IdeRegistry.detect()`
   * (cwd + env heuristics) and uses the provided IDE id directly.
   * Mirrors the `peaks hooks install --ide <id>` pattern.
   */
  readonly ideId?: IdeId;
};

export type ProjectStandardsUpdateIdeAwareOptions = ProjectStandardsInitOptions & {
  /** Explicit IDE override. See {@link ProjectStandardsIdeAwareOptions}. */
  readonly ideId?: IdeId;
};

function warnUnregisteredIde(ideId: IdeId, projectRoot: string): void {
  process.stderr.write(
    `peaks standards: IDE '${ideId}' has no standardsProfile declared; ` +
      `falling back to the legacy Claude Code path (CLAUDE.md + .claude/rules/**) ` +
      `for project '${projectRoot}'. This is a slice #011 follow-up gap; ` +
      `see .peaks/memory/ide-adapter-resource-profile-framework.md.\n`
  );
}

function warnNoIdeDetected(projectRoot: string): void {
  process.stderr.write(
    `peaks standards: no IDE detected in '${projectRoot}'; ` +
      `writing to the 2.0 canonical path (CLAUDE.md + .peaks/standards/**). ` +
      `Projects with a legacy 1.x thick .claude/rules/ tree keep that layout ` +
      `(use \`peaks standards migrate --from-claude-rules\` to converge to 2.0). ` +
      `Pass --ide <id> to bypass detection.\n`
  );
}

/**
 * Resolve the active IDE id for a standards call. Order of precedence:
 *   1. explicit `options.ideId`
 *   2. `IdeRegistry.detect()` from `options.projectRoot`
 *   3. `null` (no detected IDE — caller falls back to legacy)
 */
export function resolveStandardsIdeId(options: { readonly projectRoot: string; readonly ideId?: IdeId }): IdeId | null {
  if (options.ideId !== undefined) {
    return options.ideId;
  }
  return detectInstalledIde(options.projectRoot);
}

/**
 * Run `peaks standards init` with IDE-aware dispatch.
 *
 * When the resolved IDE has a `standardsProfile`, the call still
 * delegates to the existing `executeProjectStandardsInit` (the
 * profile maps to the Claude Code path; future per-IDE writers
 * plug in here). When the IDE is unregistered for the standards
 * profile, the call delegates to the legacy path + emits a stderr
 * warning.
 */
export function executeProjectStandardsInitIdeAware(
  options: ProjectStandardsIdeAwareOptions
): ProjectStandardsInitResult {
  const ideId = resolveStandardsIdeId(options);
  if (ideId === null) {
    warnNoIdeDetected(options.projectRoot);
    return executeProjectStandardsInit(options);
  }
  const profile = getStandardsProfile(ideId);
  if (profile === null) {
    warnUnregisteredIde(ideId, options.projectRoot);
    return executeProjectStandardsInit(options);
  }
  // Claude Code path: profile matches the legacy writer. Future per-IDE
  // writers (markdown+frontmatter, multiple rule roots, etc.) plug in
  // here by branching on `profile.format` / `profile.rulesDir`.
  return executeProjectStandardsInit(options);
}

/**
 * Run `peaks standards update` with IDE-aware dispatch.
 *
 * Same dispatch rules as `executeProjectStandardsInitIdeAware`.
 */
export function executeProjectStandardsUpdateIdeAware(
  options: ProjectStandardsUpdateIdeAwareOptions
): ProjectStandardsUpdateResult {
  const ideId = resolveStandardsIdeId(options);
  if (ideId === null) {
    warnNoIdeDetected(options.projectRoot);
    return executeProjectStandardsUpdate(options);
  }
  const profile = getStandardsProfile(ideId);
  if (profile === null) {
    warnUnregisteredIde(ideId, options.projectRoot);
    return executeProjectStandardsUpdate(options);
  }
  return executeProjectStandardsUpdate(options);
}

/**
 * Test seam + integration-test helper: returns the resolved IDE id
 * for the call, plus the active standards profile. Exported for
 * the integration test in `tests/unit/standards/ide-aware-standards-service.test.ts`
 * to assert the dispatch decision without running the full write.
 */
export function inspectStandardsDispatch(options: { readonly projectRoot: string; readonly ideId?: IdeId }): {
  readonly ideId: IdeId | null;
  readonly profile: ReturnType<typeof getStandardsProfile>;
} {
  const ideId = resolveStandardsIdeId(options);
  if (ideId === null) {
    return { ideId: null, profile: null };
  }
  return { ideId, profile: getStandardsProfile(ideId) };
}

/**
 * Test seam: the resource-profile accessor exposes
 * `detectAllResourceTargets` for callers that need to enumerate
 * across all registered IDEs. Re-exported here for convenience.
 */
export { detectAllResourceTargets };
