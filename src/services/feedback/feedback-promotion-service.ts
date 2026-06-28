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
 * Promotion tracking convention: a feedback memory is considered
 * "promoted" when one of the following is true:
 *
 *   (a) The memory file contains an HTML comment near the top of the
 *       body: `<!-- peaks-feedback-promoted: layer=<A|B|C> -->`.
 *       Written by `peaks feedback promote` so a single read of the
 *       memory file is enough to determine promotion state.
 *
 *   (b) A sibling `.peaks/memory/<name>.promotion.json` exists with
 *       `{ layer: "A" | "B" | "C", ... }`. Written as a sidecar for
 *       tooling that prefers machine-readable state over embedded
 *       comments (e.g. `verify-pipeline` Gate H).
 *
 * The comment marker is the SOURCE OF TRUTH for human review; the
 * sidecar is the source of truth for the scanner. Either is enough
 * to mark a feedback memory as promoted.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

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
    if (parsed.promotion === null) {
      out.push({
        name: parsed.name,
        path: parsed.path,
        reason: 'no promotion marker (comment or sidecar) found — see `peaks feedback promote`'
      });
    }
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
      snippet: `# SOP entry for feedback "${feedbackName}"\n\n<!-- Append the rule + acceptance criteria below. Reference from a new peaks-sop gate. -->\n\n## Rule\n\n${opts.feedbackBody.split('\n').slice(0, 5).join('\n')}\n\n## Enforcement\n\nAdd a check to sops/<name>.md and reference from .claude/rules/.`,
      targetFiles: [`sops/${feedbackName}.md`]
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
    snippet: `// src/services/solo/mode-gate.ts\n// 1. Add to HardFloorCategory union: '${feedbackName}-rule'\n// 2. Add to HARD_FLOOR_CATEGORIES\n// 3. Wire shouldPauseAtGate to recognise the new category\n// Tests: tests/unit/services/solo/<name>-hard-floor.test.ts (≥6 cases per AC-4)`,
    targetFiles: ['src/services/solo/mode-gate.ts', `tests/unit/services/solo/${feedbackName}-hard-floor.test.ts`]
  };
}

export type FeedbackPromoteEnvelope = {
  name: string;
  feedbackPath: string;
  layer: PromotionLayer;
  layerDetail: string;
  generatedFiles: string[];
  snippet: string;
  promotedAt: string;
  promotedBy: string;
};

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
export function promoteFeedback(opts: {
  feedbackPath: string;
  layer: PromotionLayer;
  promotedBy: string;
  sessionId: string;
  projectRoot: string;
  dryRun?: boolean;
}): FeedbackPromoteEnvelope {
  const parsed = parseFeedbackMemory(opts.feedbackPath);
  if (parsed === null) {
    throw new Error(`Not a feedback memory: ${opts.feedbackPath}`);
  }
  const stub = generatePromotionStub({
    layer: opts.layer,
    feedbackName: parsed.name,
    feedbackBody: parsed.body
  });
  const now = new Date().toISOString();
  const envelope: FeedbackPromoteEnvelope = {
    name: parsed.name,
    feedbackPath: parsed.path,
    layer: opts.layer,
    layerDetail: PROMOTION_LAYER_DETAILS.find((l) => l.layer === opts.layer)?.label ?? opts.layer,
    generatedFiles: stub.targetFiles,
    snippet: stub.snippet,
    promotedAt: now,
    promotedBy: opts.promotedBy
  };
  if (opts.dryRun === true) {
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
  }
  // 2. Sidecar (machine-readable mirror).
  const sidecarPath = opts.feedbackPath.replace(/\.md$/, '.promotion.json');
  writeFileSync(
    sidecarPath,
    JSON.stringify({
      name: parsed.name,
      layer: opts.layer,
      layerDetail: envelope.layerDetail,
      generatedFiles: stub.targetFiles,
      promotedAt: now,
      promotedBy: opts.promotedBy
    }, null, 2),
    'utf8'
  );
  // 3. Envelope to `.peaks/_runtime/<sid>/rd/`.
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
  writeFileSync(envelopePath, JSON.stringify(envelope, null, 2), 'utf8');
  return envelope;
}

export function isPromotionLayer(value: string): value is PromotionLayer {
  return value === 'A' || value === 'B' || value === 'C';
}
