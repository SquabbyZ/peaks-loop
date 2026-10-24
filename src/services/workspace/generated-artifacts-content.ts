/**
 * Content comparison for the artifacts `peaks workspace init` generates into a
 * consumer project.
 *
 * WHY A SEPARATE MODULE. `generated-artifacts-stamp.ts` owns the stamp and the
 * staleness verdict; this module owns ONE question — "do the bytes on disk still
 * match what the current release renders?" — plus the per-artifact detail that
 * answers it. Splitting them keeps both files inside the 300-line size cap.
 *
 * WHAT IS COMPARED. The rendered template (`buildClaudeSettingsLocalJson()`)
 * against the content of each generated artifact. The predicate is
 * `templateContentMatches` — the one the materializer uses to decide
 * `already-current` — so the detector and the writer cannot disagree.
 *
 * WHY CONTAINMENT AND NOT BYTE EQUALITY. `templateContentMatches` asks whether
 * every entry the template declares is PRESENT and ignores extra on-disk
 * entries. `.claude/settings.local.json` has a second writer (the auto-compact
 * installer appends a `Bash|Task` entry) and carries the user's own keys; a
 * byte-equality rule would call every such project stale on every turn.
 *
 * A MISSING ARTIFACT IS NOT DRIFT. There is nothing on disk to compare, and the
 * generator recreates it on the next init; the stamp's reason codes cover the
 * "never initialized" and "not readable" cases.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { normalizePath } from '../../shared/path-utils.js';
import { EXTERNAL_GATE_EXEMPT_ENV } from '../skills/hooks-codegate-superpowers.js';

import {
  buildClaudeSettingsLocalJson,
  templateContentMatches
} from './claude-settings-template.js';
import {
  isPreToolUseEntry,
  isRetiredTemplateEntry,
  type TemplatePreToolUseEntry
} from './claude-settings-retirements.js';

/** The rendered template's own shape, as this module consumes it. */
type TemplateShape = ReturnType<typeof buildClaudeSettingsLocalJson>;

/** One generated artifact that no longer matches the rendered template. */
export type GeneratedArtifactDrift = {
  /**
   * Project-root-relative path of the artifact, POSIX-separated so the warning
   * names the same file on every platform.
   */
  readonly artifact: string;
  /** What differs, in one clause a reader can act on. */
  readonly detail: string;
};

/** The verdict, plus the detail behind it. */
export type GeneratedArtifactContentStatus = {
  readonly drifted: boolean;
  readonly drifts: ReadonlyArray<GeneratedArtifactDrift>;
};

/**
 * Compare every generated artifact on disk against the current template.
 *
 * The verdict is `templateContentMatches` — the writer's own predicate — and
 * the per-artifact detail is a best-effort localisation of WHAT differs.
 */
export function compareGeneratedArtifactContent(
  projectRoot: string,
  artifactPaths: ReadonlyArray<string>
): GeneratedArtifactContentStatus {
  const template = buildClaudeSettingsLocalJson();
  const rendered = JSON.stringify(template);
  const drifts: GeneratedArtifactDrift[] = [];
  for (const artifact of artifactPaths) {
    for (const detail of artifactDriftDetails(projectRoot, artifact, template, rendered)) {
      drifts.push({ artifact: normalizePath(artifact), detail });
    }
  }
  return { drifted: drifts.length > 0, drifts };
}

/** The details for ONE artifact. Empty when it matches or is absent. */
function artifactDriftDetails(
  projectRoot: string,
  artifact: string,
  template: TemplateShape,
  rendered: string
): string[] {
  const path = join(projectRoot, artifact);
  if (!existsSync(path)) return [];
  let content: string;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    return ['the file could not be read'];
  }
  if (templateContentMatches(rendered, content)) return [];
  return contentDiffDetails(template, content);
}

/** Name what differs between the rendered template and the on-disk content. */
function contentDiffDetails(template: TemplateShape, content: string): string[] {
  const parsed = parseJsonObject(content);
  if (!parsed.ok) return [parsed.reason];
  const details = [
    ...missingEntryDetails(template.hooks.PreToolUse, parsed.value.hooks),
    ...retiredEntryDetails(parsed.value.hooks),
    ...missingExemptionDetails(parsed.value.env)
  ];
  return details.length > 0 ? details : ['the content differs from the current template'];
}

/**
 * The parsed top-level object of a settings file, or the reason there is none —
 * DISCRIMINATED: "not JSON" and "JSON but not an object" are different facts.
 */
function parseJsonObject(content: string): ParsedSettings {
  try {
    const parsed: unknown = JSON.parse(content);
    if (!isPlainRecord(parsed)) return { ok: false, reason: 'the file is not a JSON object' };
    return { ok: true, value: parsed };
  } catch {
    return { ok: false, reason: 'the file is not valid JSON' };
  }
}

/** The two outcomes of the parse: the settings object, or the reason there is none. */
type ParsedSettings = { ok: true; value: Record<string, unknown> } | { ok: false; reason: string };

/**
 * The template entries the on-disk file does not carry. Matching is
 * multiset-aware: the template declares TWO `Bash` entries and each needs its
 * own counterpart, so a file holding one copy is still drift.
 */
function missingEntryDetails(
  templateEntries: ReadonlyArray<TemplatePreToolUseEntry>,
  onDiskHooks: unknown
): string[] {
  const onDiskEntries = preToolUseEntries(onDiskHooks);
  if (onDiskEntries === undefined) {
    return [
      `hooks.PreToolUse is missing (the template declares ${templateEntries.length} entries)`
    ];
  }
  const unmatched = [...onDiskEntries];
  const details: string[] = [];
  templateEntries.forEach((required, index) => {
    const at = unmatched.findIndex((candidate) => sameEntry(required, candidate));
    if (at === -1) {
      details.push(
        `hooks.PreToolUse entry #${index + 1} (matcher "${required.matcher}") is missing or differs`
      );
      return;
    }
    unmatched.splice(at, 1);
  });
  return details;
}

/** The on-disk `hooks.PreToolUse` entries, or `undefined` when there are none. */
function preToolUseEntries(hooks: unknown): ReadonlyArray<TemplatePreToolUseEntry> | undefined {
  if (typeof hooks !== 'object' || hooks === null || Array.isArray(hooks)) return undefined;
  const entries = (hooks as { PreToolUse?: unknown }).PreToolUse;
  if (!Array.isArray(entries)) return undefined;
  return entries.filter(isPreToolUseEntry);
}

/** Structural equality of two `PreToolUse` entries. */
function sameEntry(required: TemplatePreToolUseEntry, candidate: TemplatePreToolUseEntry): boolean {
  if (required.matcher !== candidate.matcher) return false;
  if (required.hooks.length !== candidate.hooks.length) return false;
  return required.hooks.every((handler, index) => {
    const other = candidate.hooks[index];
    if (other === undefined) return false;
    return (
      handler.type === other.type &&
      handler.command === other.command &&
      handler.shell === other.shell
    );
  });
}

/** The retired entries the on-disk file still carries, if any. */
function retiredEntryDetails(onDiskHooks: unknown): string[] {
  const entries = preToolUseEntries(onDiskHooks);
  if (entries === undefined) return [];
  const retired = entries.filter((entry) => isRetiredTemplateEntry(entry));
  return retired.length === 0 ? [] : ['hooks.PreToolUse carries an entry this release retired'];
}

/** The gate exemptions the on-disk file does not declare. */
function missingExemptionDetails(onDiskEnv: unknown): string[] {
  const env = isPlainRecord(onDiskEnv) ? onDiskEnv : {};
  const details: string[] = [];
  for (const [key, glob] of Object.entries(EXTERNAL_GATE_EXEMPT_ENV)) {
    const current = env[key];
    const declared =
      typeof current === 'string' &&
      current
        .split(',')
        .map((part) => part.trim())
        .includes(glob);
    if (!declared) {
      details.push(`env.${key} does not declare "${glob}"`);
    }
  }
  return details;
}

/** A JSON object, as opposed to a null / array / primitive. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
