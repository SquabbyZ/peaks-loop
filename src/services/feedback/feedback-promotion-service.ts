/**
 * v2.15.0 slice 002 — AC-3: feedback-promotion service.
 *
 * `.peaks/memory/<name>.md` memories with `metadata.type === 'feedback'`
 * are user-given rules. They are advisory (LLM-readable) until promoted
 * to at least one enforcement layer (peaks-sop gate / peaks-hooks
 * PreToolUse / mode-gate hardFloorCategory). This service is the
 * primitive behind the `peaks feedback promote` and
 * `peaks feedback check-unpromoted` CLI commands.
 *
 * Promotion tracking convention — two parts, and BOTH are required:
 *
 *   (a) A MARKER, either an HTML comment near the top of the body
 *       (`<!-- peaks-feedback-promoted: layer=<A|B|C> -->`) or a sibling
 *       `.peaks/memory/<name>.promotion.json` sidecar with
 *       `{ layer: "A" | "B" | "C", ... }`. Written by `peaks feedback
 *       promote` so a single read of the memory file is enough to see the
 *       claimed layer.
 *
 *   (b) The ARTIFACT that layer implies — see `promotionArtifactChecks`.
 *       rid 2026-09-14-gate-h-promotion: the marker alone used to count,
 *       which made the gate self-certifying, because the only thing a marker
 *       proves is that `peaks feedback promote` ran. Every layer-A marker in
 *       this repo pointed at `sops/<name>.md`, a file that did not exist and
 *       that no engine reads.
 *
 * The comment marker is the SOURCE OF TRUTH for human review; the sidecar is
 * the source of truth for the scanner. Neither is evidence on its own.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { registerSop } from '../sop/sop-registry-service.js';
import { projectRegistryPath, projectSopManifestPath } from '../sop/sop-paths.js';
import type { SopManifest } from '../sop/sop-types.js';
import { artifactEvidenceFailure, type PromotionArtifactCheck, type PromotionEvidence } from './promotion-artifact-evidence.js';

// Re-exported so callers keep importing the check shape from the service that
// builds the table, even though the readers live in their own module.
export type { PromotionArtifactCheck, PromotionEvidence };

/**
 * PRD-002b slice 2 — extract magic numbers used by the promotion
 * helper. `slice(0, 5)` was used as a heuristic on the user's body
 * to keep the rule stub short; `slice(0, 2000)` caps error-mirror
 * stderr payload size to avoid unbounded log growth.
 */
const RULE_BODY_PREVIEW_LINES = 5;
const STDERR_TRUNCATE_BYTES = 2000;

export type PromotionLayer = 'A' | 'B' | 'C';

export const PROMOTION_LAYERS: readonly PromotionLayer[] = ['A', 'B', 'C'] as const;

export type PromotionLayerDetail = {
  layer: PromotionLayer;
  label: string;
  /** One-line description of what kind of rule belongs on this layer. */
  description: string;
};

export const PROMOTION_LAYER_DETAILS: readonly PromotionLayerDetail[] = [
  { layer: 'A', label: 'peaks-sop gate', description: 'Append to sops/*.md and reference from a peaks-sop check. Procedural rules.' },
  { layer: 'B', label: 'peaks-hooks PreToolUse', description: 'Append a matcher to .peaks/.claude-settings-template.json. Tool-call interception.' },
  { layer: 'C', label: 'mode-gate hardFloorCategory', description: 'Extend HardFloorCategory + shouldPauseAtGate. Always pauses regardless of mode.' }
] as const;

/**
 * rid 2026-09-14-gate-h-promotion — what actually backs a promotion.
 *
 * Before this, a promotion was honored on the marker alone (HTML comment or
 * sidecar). Both are written by `peaks feedback promote` and neither proves
 * that anything was enforced: every layer-A promotion in this repo pointed at
 * `sops/<name>.md`, a file that did not exist and that no engine reads. The
 * gate was therefore self-certifying — it read only what the command it tells
 * you to run had written.
 *
 * A promotion is now honored only when its layer's enforcement surface carries
 * the artifact. The three layers keep artifacts in three different shapes, so
 * the check is a small table rather than one rule:
 *
 *   - A (peaks-sop gate): a SOP manifest at `.peaks/sops/<id>/sop.json` AND an
 *     entry for `<id>` in `.peaks/sops/registry.json`. The registry half is not
 *     decoration: `gate-enforce-service.enforceBashCommand` enumerates SOPs via
 *     `readRegistry()`, so an unregistered manifest is off the enforcement path
 *     no matter how valid it is.
 *   - B (peaks-hooks PreToolUse): `.peaks/.claude-settings-template.json` must
 *     register the rule inside its `hooks` block. The file always exists, so
 *     existence proves nothing — the evidence is the registration inside it.
 *   - C (mode-gate hardFloorCategory): `src/services/code/mode-gate.ts` must
 *     register the rule in the hard-floor vocabulary, for the same reason. This
 *     is the repo's existing convention: the one real layer-C promotion cites
 *     its memory by path, from the category's doc block.
 *
 * R2 (2026-09-14-gate-h-promotion): each of those is now a PARSE plus a shape
 * assertion, in `promotion-artifact-evidence.ts`. Every check used to be a
 * `text.includes(<rule>)` over the whole file, which certified a tree that was
 * a refusal — an invalid-JSON registry, a template saying "do NOT add a
 * matcher", a mode-gate line saying the rule is deliberately not a category —
 * because in each case the rule's name was still in the file's bytes. A name in
 * a file is not a registration, and a file that cannot be parsed is a finding,
 * not a permit.
 */
/**
 * SOP id used for a feedback memory's layer-A artifact.
 *
 * Prefixed because `peaks-*` SOP ids are reserved for the built-in namespace
 * (`reservedIdReason` in sop-service.ts) and several feedback memories start
 * with `peaks-`, which would make them unregistrable under their own name.
 */
export function sopIdForFeedback(memoryName: string): string {
  return `feedback-${memoryName}`;
}

/** The artifact(s) and the structural evidence each must carry for `layer` to mean anything. */
export function promotionArtifactChecks(memoryName: string, layer: PromotionLayer): PromotionArtifactCheck[] {
  if (layer === 'A') {
    const id = sopIdForFeedback(memoryName);
    return [
      { path: `.peaks/sops/${id}/sop.json`, evidence: 'sop-manifest', id },
      { path: '.peaks/sops/registry.json', evidence: 'sop-registry-entry', id }
    ];
  }
  if (layer === 'B') {
    return [{ path: '.peaks/.claude-settings-template.json', evidence: 'hook-registration', id: memoryName }];
  }
  return [{ path: 'src/services/code/mode-gate.ts', evidence: 'hard-floor-category', id: memoryName }];
}

/**
 * Which of `checks` are not satisfied under `projectRoot`. Empty means the
 * promotion is backed by its artifact. Never throws, and never permits: a file
 * that is absent, unreadable, or unparseable is a finding, not a warning —
 * "cannot read the evidence" must not read as "the evidence is good".
 */
export function missingArtifacts(checks: readonly PromotionArtifactCheck[], projectRoot: string): string[] {
  const missing: string[] = [];
  for (const check of checks) {
    const absolute = resolve(projectRoot, check.path);
    if (!existsSync(absolute)) {
      missing.push(`${check.path} (absent)`);
      continue;
    }
    let text: string;
    try {
      text = readFileSync(absolute, 'utf8');
    } catch {
      missing.push(`${check.path} (unreadable)`);
      continue;
    }
    const failure = artifactEvidenceFailure(check, text);
    if (failure !== null) {
      missing.push(`${check.path} (${failure})`);
    }
  }
  return missing;
}

export type FeedbackMemory = {
  /** File basename (without `.md`). */
  name: string;
  /** Absolute path to the .md file. */
  path: string;
  /** Parsed frontmatter. */
  frontmatter: {
    name?: string;
    description?: string;
    kind?: string;
  };
  /** Body text (after the closing `---`). */
  body: string;
  /** Parsed promotion marker (from comment OR sidecar). null when unpromoted. */
  promotion: { layer: PromotionLayer; source: 'comment' | 'sidecar'; detail: string } | null;
};

export type UnpromotedFeedbackEntry = {
  name: string;
  path: string;
  reason: string;
};

const COMMENT_MARKER_RE = /<!--\s*peaks-feedback-promoted:\s*layer=([ABC])\s*-->/;

/**
 * rid 2026-09-14-gate-h-promotion (classify slice) — the "not to be promoted"
 * declaration.
 *
 * The gate used to know only `has artifact` / `has no artifact`, so a memory that
 * prescribes no action could never pass: promoting it registers a SOP whose only
 * gate is "the source file still exists", which asserts nothing about behaviour.
 * That is a permanent false positive — the old vacuity defect facing the other way.
 *
 * The declaration closes it, but it must not become a way to silence the gate.
 * It differs from the refused grandfather channel (`promotedAt` older than this
 * rule) in that a grandfather exemption is a property of a memory's AGE: every
 * legacy memory has it, it says nothing about content, and nobody has to assert
 * or defend it. This is a bounded claim about the memory's CONTENT:
 *
 *   1. The code is drawn from a closed vocabulary — free text cannot be used.
 *   2. Each code binds to a predicate over the memory's own frontmatter, which
 *      the gate recomputes. The declaration may only RESTATE what the memory
 *      already says; it cannot introduce a new fact.
 *   3. A reason string is required (the `closedAt` escape hatch beside it has none).
 *   4. Coexisting with a promotion marker is a contradiction and fails, so the
 *      channel cannot be used to bury a promotion whose artifact is missing.
 *   5. Exempted memories stay REPORTED via `listPromotionExempt`, so the
 *      unpromoted count never drops silently.
 */
export const NOT_TO_PROMOTE_CODES = ['non-actionable', 'closed-slice-note'] as const;

export type NotToPromoteCode = (typeof NOT_TO_PROMOTE_CODES)[number];

/**
 * What each code's predicate requires the memory to already say. The gate does not
 * and cannot verify that "prescribes no action" is TRUE; it verifies that the
 * declaration agrees with a claim the memory makes on its own.
 */
const NOT_TO_PROMOTE_CORROBORATION: Record<NotToPromoteCode, string> = {
  'non-actionable': 'frontmatter `scope:` containing `non-actionable`, or `nonActionable: true`',
  'closed-slice-note': 'frontmatter `sourceArtifact:` or `source:` naming the slice it was derived from'
};

export type NotToPromoteRead =
  | { kind: 'none' }
  | { kind: 'valid'; code: NotToPromoteCode; reason: string }
  | { kind: 'invalid'; reason: string };

/**
 * Parse a single `.peaks/memory/<file>.md` into a FeedbackMemory, or
 * `null` when the file is missing / unreadable / not a feedback memory.
 *
 * The "is this a feedback memory?" check is intentionally narrow: only
 * frontmatter with `metadata.type === 'feedback'` OR top-level
 * `type: feedback` qualifies. Other memory kinds (project / rule /
 * decision / reference / convention / module / lesson) are skipped.
 */
export function parseFeedbackMemory(filePath: string): FeedbackMemory | null {
  if (!existsSync(filePath)) return null;
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(`failed to read feedback memory at ${filePath}: ${(err as Error).message}`, { cause: err });
  }
  const normalized = raw.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return null;
  const endIndex = normalized.indexOf('\n---\n', 4);
  if (endIndex < 0) return null;

  const frontmatterRaw = normalized.slice(4, endIndex);
  const body = normalized.slice(endIndex + '\n---\n'.length).trim();

  let name: string | undefined;
  let description: string | undefined;
  let kind: string | undefined;

  for (const rawLine of frontmatterRaw.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('name:')) name = line.slice('name:'.length).trim();
    else if (line.startsWith('description:')) description = line.slice('description:'.length).trim();
    else if (line.startsWith('type:')) kind = line.slice('type:'.length).trim();
    else if (line.startsWith('  type:')) kind = line.slice('  type:'.length).trim();
  }

  if (kind !== 'feedback') return null;

  // Comment marker (preferred — embedded in the file itself).
  let promotion: FeedbackMemory['promotion'] = null;
  const commentMatch = COMMENT_MARKER_RE.exec(body);
  if (commentMatch) {
    const layer = commentMatch[1] as PromotionLayer;
    const detail = PROMOTION_LAYER_DETAILS.find((l) => l.layer === layer);
    promotion = {
      layer,
      source: 'comment',
      detail: detail?.label ?? layer
    };
  } else {
    // Sidecar fallback: `<basename>.promotion.json`.
    const sidecarPath = filePath.replace(/\.md$/, '.promotion.json');
    if (existsSync(sidecarPath)) {
      try {
        const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8')) as { layer?: string };
        if (sidecar.layer === 'A' || sidecar.layer === 'B' || sidecar.layer === 'C') {
          const detail = PROMOTION_LAYER_DETAILS.find((l) => l.layer === sidecar.layer);
          promotion = {
            layer: sidecar.layer,
            source: 'sidecar',
            detail: detail?.label ?? sidecar.layer
          };
        }
      } catch (err) {
        // malformed sidecar — warn but do not fail the whole parse
        console.warn(`parseFeedbackMemory: malformed sidecar at ${sidecarPath}: ${(err as Error).message}`);
      }
    }
  }

  return {
    name: name ?? basename(filePath),
    path: filePath,
    frontmatter: {
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(kind !== undefined ? { kind } : {})
    },
    body,
    promotion
  };
}

function basename(p: string): string {
  const lastSlash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  const base = lastSlash >= 0 ? p.slice(lastSlash + 1) : p;
  return base.endsWith('.md') ? base.slice(0, -3) : base;
}

/**
 * Scan `.peaks/memory/*.md` for feedback memories and return those
 * that are NOT promoted to any enforcement layer. Pure read; the
 * CLI command emits the warning list + (with `--strict`) a non-zero
 * exit code.
 */
export function listUnpromotedFeedback(opts: { projectRoot: string }): UnpromotedFeedbackEntry[] {
  const memoryDir = resolve(opts.projectRoot, '.peaks', 'memory');
  if (!existsSync(memoryDir)) return [];
  const out: UnpromotedFeedbackEntry[] = [];
  for (const entry of readdirSync(memoryDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    if (entry.name.startsWith('.')) continue; // skip dotfiles (e.g. .index.json)
    const parsed = parseFeedbackMemory(join(memoryDir, entry.name));
    if (parsed === null) continue;
    // v2.18.4 fix: skip closed feedback memories (frontmatter `closedAt: <iso>`).
    // Closed memories declare their own "Do not re-introduce this memory as a
    // live blocker" in the body; counting them as unpromoted would (a) force
    // operators to promote or delete a deliberately archived record and (b)
    // contradict the memory's own lifecycle. Verify-pipeline Gate H now
    // honours the closed state and reports `0 unpromoted` for closed records.
    if (isClosedMemory(join(memoryDir, entry.name))) continue;
    // rid 2026-09-14-gate-h-promotion (classify slice): a memory may declare
    // itself out of the gate. A malformed declaration is a FAILURE, not a skip —
    // otherwise "make the fields unusable" would be the quietest way through.
    const declaration = readNotToPromote(join(memoryDir, entry.name));
    if (declaration.kind === 'invalid') {
      out.push({
        name: parsed.name,
        path: parsed.path,
        reason: `not-to-promote declaration rejected: ${declaration.reason}`
      });
      continue;
    }
    if (declaration.kind === 'valid') {
      if (parsed.promotion !== null) {
        out.push({
          name: parsed.name,
          path: parsed.path,
          reason: `carries both a layer ${parsed.promotion.layer} promotion marker and a notToPromote: ${declaration.code} declaration — one of the two claims is false; remove one`
        });
        continue;
      }
      // Deliberately exempt; `listPromotionExempt` reports it so the count is visible.
      continue;
    }
    if (parsed.promotion === null) {
      out.push({
        name: parsed.name,
        path: parsed.path,
        reason: 'no promotion marker (comment or sidecar) found — see `peaks feedback promote`'
      });
      continue;
    }
    // rid 2026-09-14-gate-h-promotion: a marker is a claim, not evidence. It
    // counts only when the layer's enforcement surface actually carries the
    // artifact. Before this, the marker alone was accepted, so the gate
    // certified whatever the promote command had written and nothing else.
    const missing = missingArtifacts(
      promotionArtifactChecks(parsed.name, parsed.promotion.layer),
      opts.projectRoot
    );
    if (missing.length > 0) {
      out.push({
        name: parsed.name,
        path: parsed.path,
        reason: `marker claims layer ${parsed.promotion.layer} but the artifact is missing: ${missing.join('; ')}`
      });
    }
  }
  return out;
}

/**
 * v2.18.4 helper: detect a closed feedback memory by reading the raw
 * frontmatter and checking for a non-empty `closedAt:` field. The check
 * is intentionally narrow (top-level `closedAt:` only, not `metadata.closedAt`)
 * because that is the documented convention — memories archived in the
 * `[[review-memories-extract-and-memory-index]]` family all use top-level.
 *
 * Returns `true` when the file is unreadable or has no frontmatter (the
 * conservative answer; such files fall through to the normal unpromoted scan).
 */
function isClosedMemory(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    return false;
  }
  const normalized = raw.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return false;
  const endIndex = normalized.indexOf('\n---\n', 4);
  if (endIndex < 0) return false;
  const frontmatter = normalized.slice(4, endIndex);
  for (const rawLine of frontmatter.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('closedAt:')) {
      const value = line.slice('closedAt:'.length).trim();
      if (value.length > 0 && value !== '""' && value !== "''") return true;
    }
  }
  return false;
}

/** Raw frontmatter text of a memory, or `null` when absent/unreadable. */
function readFrontmatter(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  const normalized = raw.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return null;
  const endIndex = normalized.indexOf('\n---\n', 4);
  if (endIndex < 0) return null;
  return normalized.slice(4, endIndex);
}

/** Flat `key: value` lookup over frontmatter text; `null` when unset or empty. */
function frontmatterValue(frontmatter: string, key: string): string | null {
  for (const rawLine of frontmatter.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith(`${key}:`)) continue;
    const value = line.slice(key.length + 1).trim();
    if (value.length === 0 || value === '""' || value === "''") return null;
    return value;
  }
  return null;
}

/** Does the memory's own frontmatter already say what `code` claims? */
function corroborates(code: NotToPromoteCode, frontmatter: string): boolean {
  if (code === 'non-actionable') {
    const scope = frontmatterValue(frontmatter, 'scope');
    if (scope !== null && scope.includes('non-actionable')) return true;
    return frontmatterValue(frontmatter, 'nonActionable') === 'true';
  }
  return frontmatterValue(frontmatter, 'sourceArtifact') !== null
    || frontmatterValue(frontmatter, 'source') !== null;
}

/**
 * Read the memory's not-to-promote declaration. `invalid` is returned rather than
 * `none` when the fields are present but unusable, so the gate fails with a reason
 * instead of quietly treating a malformed declaration as "no declaration".
 */
export function readNotToPromote(filePath: string): NotToPromoteRead {
  const frontmatter = readFrontmatter(filePath);
  if (frontmatter === null) return { kind: 'none' };
  const code = frontmatterValue(frontmatter, 'notToPromote');
  const reason = frontmatterValue(frontmatter, 'notToPromoteReason');
  if (code === null && reason === null) return { kind: 'none' };
  if (code === null) {
    return { kind: 'invalid', reason: '`notToPromoteReason` is set but the `notToPromote` code is missing' };
  }
  if (!(NOT_TO_PROMOTE_CODES as readonly string[]).includes(code)) {
    return {
      kind: 'invalid',
      reason: `\`notToPromote: ${code}\` is not a recognised code (expected ${NOT_TO_PROMOTE_CODES.join(' | ')})`
    };
  }
  if (reason === null) {
    return { kind: 'invalid', reason: `\`notToPromote: ${code}\` has no \`notToPromoteReason\` — an exemption must state its own reason` };
  }
  const typedCode = code as NotToPromoteCode;
  if (!corroborates(typedCode, frontmatter)) {
    return {
      kind: 'invalid',
      reason: `\`notToPromote: ${typedCode}\` is not corroborated by the memory's own frontmatter (needs ${NOT_TO_PROMOTE_CORROBORATION[typedCode]})`
    };
  }
  return { kind: 'valid', code: typedCode, reason };
}

export type PromotionExemptEntry = {
  name: string;
  path: string;
  code: NotToPromoteCode;
  reason: string;
};

/**
 * The feedback memories that declare themselves out of the gate. Exposed so the
 * gate can REPORT them: an exemption nobody can see is the vacuity this whole
 * channel is required to avoid. Never throws.
 */
export function listPromotionExempt(opts: { projectRoot: string }): PromotionExemptEntry[] {
  const memoryDir = resolve(opts.projectRoot, '.peaks', 'memory');
  if (!existsSync(memoryDir)) return [];
  const out: PromotionExemptEntry[] = [];
  for (const entry of readdirSync(memoryDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name.startsWith('.')) continue;
    const filePath = join(memoryDir, entry.name);
    const parsed = parseFeedbackMemory(filePath);
    if (parsed === null) continue;
    const declaration = readNotToPromote(filePath);
    if (declaration.kind !== 'valid') continue;
    if (parsed.promotion !== null) continue; // contradiction — reported as a violation instead
    out.push({ name: parsed.name, path: parsed.path, code: declaration.code, reason: declaration.reason });
  }
  return out;
}

/**
 * Generate the code stub for a given layer. Returns a Markdown
 * snippet the LLM / human can paste into the appropriate file. Pure
 * function — does NOT touch disk. The CLI command wraps this with
 * the disk write / envelope emission.
 */
export function generatePromotionStub(opts: {
  layer: PromotionLayer;
  feedbackName: string;
  feedbackBody: string;
}): { snippet: string; targetFiles: string[] } {
  const { layer, feedbackName } = opts;
  if (layer === 'A') {
    return {
      snippet: `# SOP entry for feedback "${feedbackName}"\n\n<!-- Append the rule + acceptance criteria below. Reference from a new peaks-sop gate. -->\n\n## Rule\n\n${opts.feedbackBody.split('\n').slice(0, RULE_BODY_PREVIEW_LINES).join('\n')}\n\n## Enforcement\n\nAuthor the rule's gates in the generated manifest and reference it from .claude/rules/.`,
      targetFiles: [`.peaks/sops/${sopIdForFeedback(feedbackName)}/sop.json`]
    };
  }
  if (layer === 'B') {
    return {
      snippet: `{\n  "matcher": "Bash",\n  "hooks": [\n    {\n      "type": "command",\n      "command": "node -e \\"process.exit(0)\\""\n    }\n  ]\n}\n<!-- Append the rule-specific matcher to .peaks/.claude-settings-template.json -->`,
      targetFiles: ['.peaks/.claude-settings-template.json']
    };
  }
  // layer === 'C'
  return {
    snippet: `// src/services/code/mode-gate.ts\n// 1. Add to HardFloorCategory union: '${feedbackName}-rule'\n// 2. Add to HARD_FLOOR_CATEGORIES\n// 3. Wire shouldPauseAtGate to recognise the new category\n// Tests: tests/unit/services/code/<name>-hard-floor.test.ts (≥6 cases per AC-4)`,
    targetFiles: ['src/services/code/mode-gate.ts', `tests/unit/services/code/${feedbackName}-hard-floor.test.ts`]
  };
}

export type FeedbackPromoteEnvelope = {
  name: string;
  feedbackPath: string;
  layer: PromotionLayer;
  layerDetail: string;
  /**
   * Files this call actually wrote. rid 2026-09-14-gate-h-promotion: this used
   * to be the stub's *targets* — paths the command never wrote yet printed as
   * `Generated files:` — which is the defect the Gate H rework exists to remove.
   */
  generatedFiles: string[];
  /** The artifact(s) `layer` requires before the promotion means anything. */
  requiredArtifacts: string[];
  /** `false` when `requiredArtifacts` are not all present — the marker is then a claim without evidence. */
  effective: boolean;
  snippet: string;
  promotedAt: string;
  promotedBy: string;
};

/**
 * Materialize the layer-A artifact: the SOP manifest the engine reads, plus its
 * registry entry. Registration is not optional — `gate-enforce-service` walks
 * `readRegistry()`, so an unregistered manifest enforces nothing.
 *
 * Returns the paths written. `registerSop` lints the manifest first, so a
 * malformed generation throws here rather than leaving a promotion that only
 * looks real.
 */
async function generateLayerAArtifact(parsed: FeedbackMemory, projectRoot: string): Promise<string[]> {
  const id = sopIdForFeedback(parsed.name);
  const manifestPath = projectSopManifestPath(projectRoot, id);
  const description = parsed.frontmatter.description ?? '';
  const manifest: SopManifest = {
    id,
    name: parsed.name,
    description: `Promoted from feedback memory .peaks/memory/${parsed.name}.md${description.length > 0 ? `: ${description}` : ''}`,
    phases: ['apply'],
    gates: [
      {
        id: 'rule-source-present',
        phase: 'apply',
        check: { type: 'file-exists', path: `.peaks/memory/${parsed.name}.md` }
      }
    ]
  };
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  await registerSop({ id, projectRoot });
  return [manifestPath, projectRegistryPath(projectRoot)];
}

/**
 * Write the promotion marker + sidecar. Also writes the envelope to
 * `.peaks/_runtime/<sid>/rd/feedback-promote-<name>.json` for QA
 * auditing. Returns the envelope so the CLI can emit it.
 *
 * The promotion marker is embedded in the memory file (so it
 * travels with the file across git history); the sidecar is a
 * machine-readable mirror. Both are written; either alone is
 * enough for the scanner.
 */
export async function promoteFeedback(opts: {
  feedbackPath: string;
  layer: PromotionLayer;
  promotedBy: string;
  sessionId: string;
  projectRoot: string;
  dryRun?: boolean;
}): Promise<FeedbackPromoteEnvelope> {
  const parsed = parseFeedbackMemory(opts.feedbackPath);
  if (parsed === null) {
    throw new Error(`Not a feedback memory: ${opts.feedbackPath}`);
  }
  // rid 2026-09-14-gate-h-promotion (classify slice): the tool must not create the
  // contradiction the gate rejects — promoting a memory that declares itself out of
  // the gate would print `effective: true` while Gate H reports a contradiction.
  const declaration = readNotToPromote(opts.feedbackPath);
  if (declaration.kind === 'valid') {
    throw new Error(
      `${opts.feedbackPath} declares \`notToPromote: ${declaration.code}\` — promoting it would contradict that declaration. Remove the declaration first if the memory is a rule after all.`
    );
  }
  const stub = generatePromotionStub({
    layer: opts.layer,
    feedbackName: parsed.name,
    feedbackBody: parsed.body
  });
  const now = new Date().toISOString();
  const required = promotionArtifactChecks(parsed.name, opts.layer);
  const envelope: FeedbackPromoteEnvelope = {
    name: parsed.name,
    feedbackPath: parsed.path,
    layer: opts.layer,
    layerDetail: PROMOTION_LAYER_DETAILS.find((l) => l.layer === opts.layer)?.label ?? opts.layer,
    generatedFiles: [],
    requiredArtifacts: required.map((check) => check.path),
    effective: false,
    snippet: stub.snippet,
    promotedAt: now,
    promotedBy: opts.promotedBy
  };
  if (opts.dryRun === true) {
    envelope.effective = missingArtifacts(required, opts.projectRoot).length === 0;
    return envelope;
  }
  // 1. Embed comment marker in the memory file.
  const raw = readFileSync(opts.feedbackPath, 'utf8');
  const normalized = raw.replace(/\r\n/g, '\n');
  const endIndex = normalized.indexOf('\n---\n', 4);
  if (endIndex >= 0) {
    const body = normalized.slice(endIndex + '\n---\n'.length);
    // If a marker already exists, replace it. Otherwise insert one
    // at the top of the body.
    const marker = `<!-- peaks-feedback-promoted: layer=${opts.layer} -->`;
    const newBody = COMMENT_MARKER_RE.test(body)
      ? body.replace(COMMENT_MARKER_RE, marker)
      : `${marker}\n${body}`;
    const newContent = normalized.slice(0, endIndex + '\n---\n'.length) + newBody;
    writeFileSync(opts.feedbackPath, newContent, 'utf8');
    envelope.generatedFiles.push(opts.feedbackPath);
  }
  // 2. Layer A: the promotion only means something once the SOP engine can see
  // it. Generated before the sidecar so the sidecar records the full list.
  if (opts.layer === 'A') {
    envelope.generatedFiles.push(...(await generateLayerAArtifact(parsed, opts.projectRoot)));
  }
  // 3. Sidecar (machine-readable mirror).
  const sidecarPath = opts.feedbackPath.replace(/\.md$/, '.promotion.json');
  writeFileSync(
    sidecarPath,
    JSON.stringify({
      name: parsed.name,
      layer: opts.layer,
      layerDetail: envelope.layerDetail,
      generatedFiles: envelope.generatedFiles,
      requiredArtifacts: envelope.requiredArtifacts,
      promotedAt: now,
      promotedBy: opts.promotedBy
    }, null, 2),
    'utf8'
  );
  envelope.generatedFiles.push(sidecarPath);
  // 4. Envelope to `.peaks/_runtime/<sid>/rd/`.
  const envelopePath = join(
    opts.projectRoot,
    '.peaks',
    '_runtime',
    opts.sessionId,
    'rd',
    `feedback-promote-${parsed.name}.json`
  );
  const envelopeDir = dirname(envelopePath);
  if (!existsSync(envelopeDir)) {
    mkdirSync(envelopeDir, { recursive: true });
  }
  envelope.generatedFiles.push(envelopePath);
  envelope.effective = missingArtifacts(required, opts.projectRoot).length === 0;
  writeFileSync(envelopePath, JSON.stringify(envelope, null, 2), 'utf8');
  return envelope;
}

export function isPromotionLayer(value: string): value is PromotionLayer {
  return value === 'A' || value === 'B' || value === 'C';
}
