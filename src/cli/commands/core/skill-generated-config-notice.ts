// Split out of `core/skill-command.ts`:
// `--project` canonicalization plus the D1 generated-config staleness notice
// that rides the per-turn `peaks skill presence` read.
import { stableRealPath } from '../../../shared/path-utils.js';
import {
  detectStaleGeneratedArtifacts,
  type GeneratedArtifactsStaleness
} from '../../../services/workspace/generated-artifacts-stamp.js';
import type { GeneratedArtifactDrift } from '../../../services/workspace/generated-artifacts-content.js';

/**
 * Canonicalize a user-supplied `--project <path>` value.
 *
 * Git Bash on Windows hands us forward-slash paths
 * (`C:/Users/.../peaks-loop`) while `peaks workspace init` writes the
 * backslash form, and either side may carry a trailing separator or
 * differing case. Resolving to the real path here means every
 * downstream consumer (`getSessionId`, `setSessionMeta`,
 * `setSkillPresence`) sees one stable form.
 *
 * Returns the input unchanged when it cannot be resolved (path does
 * not exist yet, or is not readable) so a bad `--project` still
 * reaches the existing error handling rather than throwing here.
 */
export function canonicalizeProjectOption(project: string | undefined): string | undefined {
  if (project === undefined) return undefined;
  try {
    return stableRealPath(project);
  } catch {
    return project;
  }
}

/**
 * D1 (2026-09-15) — generated-config staleness, carried on `skill presence`.
 *
 * WHY THIS CALL. `npm i -g peaks-loop@<newer>` upgrades the CLI and leaves the
 * project's generated config exactly as the OLD release wrote it:
 * `initWorkspace` is the only writer and `ensureSession` early-returns once a
 * session is bound, so nothing re-runs the generator. `.claude/settings.local.json`
 * is drift-checked — but only on an init that never comes. The user found the
 * previous instance of this by deleting their `.claude/*.json` and restarting;
 * nothing in the product told them to.
 *
 * `peaks skill presence` is the ONE peaks call every skill makes in every turn
 * (CLAUDE.md mandates it at the start of every response), so it is the only
 * channel guaranteed to carry a drift notice to the LLM that can act on it —
 * the same reasoning as the loop-hygiene verdict attached one screen down. A
 * rule that lives only in a SKILL.md body is compacted away; a warning that
 * rides the per-turn tool output is not.
 *
 * The field is additive and present only when stale, so no existing consumer
 * of the envelope changes shape. `null` projectRoot means the caller had no
 * project to inspect — skipped, not assumed stale.
 *
 * WHAT THE WARNING SAYS. It names the FILE that no longer matches and WHAT
 * about it, because "the version numbers differ" does not tell a reader which
 * file to open. The remedy (`peaks workspace init`) is in the message: the
 * reader is an LLM that must be able to act without guessing a command.
 */
export function generatedConfigNotice(projectRoot: string | undefined): {
  field: Record<string, unknown>;
  warnings: string[];
} {
  if (projectRoot === undefined) return { field: {}, warnings: [] };
  const staleness = detectStaleGeneratedArtifacts(projectRoot);
  if (!staleness.stale) return { field: {}, warnings: [] };
  return {
    field: {
      generatedArtifacts: {
        stale: true,
        reasons: staleness.reasons,
        onDiskPackageVersion: staleness.onDisk?.packageVersion ?? null,
        installedPackageVersion: staleness.expected.packageVersion,
        drift: staleness.drift
      }
    },
    warnings: [stalenessWarning(projectRoot, staleness)]
  };
}

/**
 * The one sentence the reader gets.
 *
 * The drift detail is appended only when there IS one: a verdict driven by the
 * stamp alone (`unstamped`, `stamp-unreadable`, `template-changed`) has no
 * file to point at, and inventing one would be a claim about a file nobody
 * compared.
 *
 * The details are GROUPED per artifact, so a file that differs in two ways is
 * named once with both of its differences — a warning that repeats the same
 * path twice reads as two files.
 */
function stalenessWarning(projectRoot: string, staleness: GeneratedArtifactsStaleness): string {
  const onDiskVersion = staleness.onDisk?.packageVersion ?? '(unstamped)';
  const head =
    `Generated config at '${projectRoot}' was produced by peaks-loop ${onDiskVersion} ` +
    `but ${staleness.expected.packageVersion} is installed (${staleness.reasons.join(', ')}). ` +
    `Re-run \`peaks workspace init\` ` +
    `to regenerate .claude/settings.local.json and the offline template copy.`;
  if (staleness.drift.length === 0) return head;
  return `${head} Inconsistent: ${groupDriftDetails(staleness.drift)}.`;
}

/** The drift details, one clause per artifact. */
function groupDriftDetails(drift: ReadonlyArray<GeneratedArtifactDrift>): string {
  const grouped = new Map<string, string[]>();
  for (const entry of drift) {
    const details = grouped.get(entry.artifact) ?? [];
    details.push(entry.detail);
    grouped.set(entry.artifact, details);
  }
  return [...grouped.entries()]
    .map(([artifact, details]) => `${artifact}: ${details.join('; ')}`)
    .join(' | ');
}
