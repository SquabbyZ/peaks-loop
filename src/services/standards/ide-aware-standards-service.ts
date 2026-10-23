/**
 * IDE-aware wrapper for `peaks standards init` / `peaks standards update`.
 *
 * `--ide` USED TO BE DETECTION-ONLY: it picked the adapter, the adapter's
 * `standardsProfile` was looked up, and then every branch called the SAME
 * writer — the profile was read and never used. This module is where that
 * gap is closed: the profile's `rootFile` now decides which instruction
 * files are emitted.
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
 *   3. `null` (no IDE detected) → the default cross-tool constitution
 *
 * Fallback behavior: when the resolved IDE has no `standardsProfile`
 * declared, the wrapper writes the DEFAULT shape — the shared body plus the
 * pointer that imports it — and emits a stderr warning naming the IDE and
 * the fact that its standards profile is undeclared.
 */
import type { IdeId, IdeStandardsProfile } from '../ide/ide-types.js';
import { detectAllResourceTargets, getStandardsProfile } from '../ide/resource-profile.js';
import {
  type ProjectStandardsInitOptions,
  type ProjectStandardsInitResult,
  type ProjectStandardsUpdateResult,
  executeProjectStandardsInit,
  executeProjectStandardsUpdate
} from './project-standards-service.js';
import { DEFAULT_CONSTITUTION, type StandardsConstitution } from './standards-constitution.js';
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

/**
 * The constitution shape an IDE's standards profile implies.
 *
 * THE RULE. `IdeStandardsProfile.rootFile` names the file the IDE reads as
 * its project instructions:
 *   - `AGENTS.md` → the IDE reads the shared body directly, so NO pointer
 *     file is emitted.
 *   - `CLAUDE.md` → the IDE reads its own file, so a pointer that imports
 *     the body is emitted beside it.
 *   - `null` (or any other name) → the IDE has no equivalent of the body,
 *     so only the body is emitted.
 *
 * A profile the registry does not declare falls back to the default shape —
 * body plus pointer — because that is the shape that covers EVERY reader:
 * the body for the AGENTS-native tools, the pointer for Claude Code.
 */
export function resolveStandardsConstitution(
  profile: IdeStandardsProfile | null
): StandardsConstitution {
  if (profile === null) return DEFAULT_CONSTITUTION;
  if (profile.rootFile === 'CLAUDE.md') return DEFAULT_CONSTITUTION;
  return { bodyFile: DEFAULT_CONSTITUTION.bodyFile, pointerFile: null };
}

function warnUnregisteredIde(ideId: IdeId, projectRoot: string): void {
  process.stderr.write(
    `peaks standards: IDE '${ideId}' has no standardsProfile declared; ` +
      `writing the default cross-tool constitution (AGENTS.md + the CLAUDE.md pointer that imports it) ` +
      `for project '${projectRoot}'. ` +
      `See .peaks/memory/ide-adapter-resource-profile-framework.md.\n`
  );
}

function warnNoIdeDetected(projectRoot: string): void {
  process.stderr.write(
    `peaks standards: no IDE detected in '${projectRoot}'; ` +
      `writing the 2.0 canonical layout (AGENTS.md + the CLAUDE.md pointer that imports it + .peaks/standards/**). ` +
      `Projects with a legacy 1.x thick .claude/rules/ tree keep that layout ` +
      `(use \`peaks standards migrate --from-claude-rules\` to converge to 2.0). ` +
      `Pass --ide <id> to bypass detection.\n`
  );
}

/**
 * Resolve the active IDE id for a standards call. Order of precedence:
 *   1. explicit `options.ideId`
 *   2. `IdeRegistry.detect()` from `options.projectRoot`
 *   3. `null` (no detected IDE — caller falls back to the default shape)
 */
export function resolveStandardsIdeId(options: {
  readonly projectRoot: string;
  readonly ideId?: IdeId;
}): IdeId | null {
  if (options.ideId !== undefined) {
    return options.ideId;
  }
  return detectInstalledIde(options.projectRoot);
}

/**
 * Run `peaks standards init` with IDE-aware dispatch.
 *
 * The resolved IDE's `standardsProfile.rootFile` decides whether the writer
 * emits the pointer file beside the shared body.
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
  return executeProjectStandardsInit({
    ...options,
    constitution: resolveStandardsConstitution(profile)
  });
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
  return executeProjectStandardsUpdate({
    ...options,
    constitution: resolveStandardsConstitution(profile)
  });
}

/**
 * Test seam + integration-test helper: returns the resolved IDE id
 * for the call, plus the active standards profile and the constitution
 * shape that profile implies. Exported for callers that need to assert the
 * dispatch decision without running the full write.
 */
export function inspectStandardsDispatch(options: {
  readonly projectRoot: string;
  readonly ideId?: IdeId;
}): {
  readonly ideId: IdeId | null;
  readonly profile: ReturnType<typeof getStandardsProfile>;
  readonly constitution: StandardsConstitution;
} {
  const ideId = resolveStandardsIdeId(options);
  if (ideId === null) {
    return { ideId: null, profile: null, constitution: DEFAULT_CONSTITUTION };
  }
  const profile = getStandardsProfile(ideId);
  return { ideId, profile, constitution: resolveStandardsConstitution(profile) };
}

/**
 * Test seam: the resource-profile accessor exposes
 * `detectAllResourceTargets` for callers that need to enumerate
 * across all registered IDEs. Re-exported here for convenience.
 */
export { detectAllResourceTargets };
