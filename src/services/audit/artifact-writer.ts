/**
 * Audit artifact writer — Slice 2026-06-26-audit-artifact-writer-generalization.
 *
 * Generalizes the original `decision-writer.ts` (which only knew how to
 * persist a `RedLineAudit` snapshot) into a polymorphic writer that
 * handles the 4 artifact types produced during a peaks-cli audit:
 *
 *   1. **decision**      — `RedLineAudit` snapshot             → audit-decisions/<slug>.md
 *   2. **prompt**        — methodology input (LLM-facing text) → audit-prompts/<slug>.md
 *   3. **machine-output** — JSON audit result                  → audit-<date>-<slug>.md (envelope)
 *   4. **narrative**     — free-form prose report              → <slug>.md (top level)
 *
 * Each writer enforces canonical frontmatter (`name` / `description` /
 * `metadata.type` ∈ ProjectMemoryKind / `metadata.artifactType`) so the
 * `.peaks/memory/` shape stays compliant with `memory-shape-guard.test.ts`.
 *
 * Back-compat: `writeAuditDecision` in `decision-writer.ts` re-exports
 * `writeDecision` so existing callers of `peaks audit static --record`
 * keep working unchanged.
 *
 * Design notes (Karpathy #1 Think Before Coding):
 *
 *   - **Why 4 writers instead of 1 polymorphic writer?** Each artifact
 *     type has a distinct subdir + envelope semantics. A single writer
 *     with a kind-flag would need conditional logic on every field. Four
 *     named writers are 4 × ~30 lines each vs. 1 × ~150 line monolith
 *     with nested if-trees. The cost of polymorphism here is lower
 *     clarity; the cost of 4 small writers is one extra import line at
 *     the call site.
 *
 *   - **Why a strict frontmatter contract on every writer?** The memory
 *     parser (`parseStoredMemoryFile` in `project-memory-service.ts`)
 *     silently ignores unknown frontmatter keys. Adding `metadata.artifactType`
 *     is therefore safe — it's additive, never breaks existing readers.
 *     But adding it consistently across all 4 writers means new files
 *     can be queried by artifactType in future tooling.
 *
 *   - **Why JSON envelope for machine-output?** Raw `.json` files at the
 *     top of `.peaks/memory/` are forbidden by the memory-shape guard.
 *     Wrapping JSON in a `.md` envelope (fenced ```json block) keeps
 *     the original bytes byte-for-byte intact while restoring compliance.
 *     The envelope also adds a human-readable H1 + summary table.
 *
 *   - **Out of scope:** index.json generation, warm-layer extraction, hot
 *     layer routing — the existing memory service handles those. We only
 *     write files; the service indexes them on next read.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RedLineAudit } from './types.js';
import { readMemoryIndex } from '../memory/project-memory-service.js';
import { renderDecisionMarkdown } from './decision-writer.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ArtifactKind = 'decision' | 'prompt' | 'machine-output' | 'narrative';

export type ArtifactType =
  | 'decision'
  | 'prompt'
  | 'machine-output'
  | 'narrative';

export interface ArtifactWriterOptions {
  readonly projectRoot: string;
  /** ISO date (YYYY-MM-DD). Defaults to today (UTC). */
  readonly date?: string;
  /** Optional request id, used to disambiguate multiple artifacts on the same day. */
  readonly rid?: string;
  /** Override the auto-derived slug. Must be filename-safe (caller's responsibility). */
  readonly slugOverride?: string;
  /** Skip writing the file — used by tests + --dry-run. */
  readonly dryRun?: boolean;
}

export interface ArtifactWriteRecord {
  readonly kind: ArtifactKind;
  readonly slug: string;
  readonly title: string;
  readonly date: string;
  readonly filePath: string;
  readonly memoryDir: string;
  readonly indexPath: string;
  readonly indexSynced: boolean;
}

interface FrontmatterExtras {
  readonly sourceArtifact: string;
  readonly createdAt: string;
  readonly artifactType: ArtifactType;
  readonly extra?: Record<string, string | number>;
}

// ---------------------------------------------------------------------------
// Private helpers (shared across the 4 writers)
// ---------------------------------------------------------------------------

function defaultDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function sanitizeDate(date: string | undefined): string {
  if (date === undefined) return defaultDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid date "${date}": must be YYYY-MM-DD format`);
  }
  return date;
}

/** Strip everything outside `[A-Za-z0-9-]` and cap length so the slug
 *  stays filename-safe regardless of the user's `--rid` input. */
function sanitizeRid(rid: string | undefined): string {
  if (!rid) return '';
  const cleaned = rid.replace(/[^A-Za-z0-9-]/g, '');
  return cleaned.length > 0 ? cleaned.slice(0, 64) : '';
}

function buildSlug(prefix: string, date: string, rid: string | undefined, override?: string): string {
  if (override) return override;
  const safe = sanitizeRid(rid);
  return safe ? `${prefix}-${date}-${safe}` : `${prefix}-${date}`;
}

function buildFrontmatter(args: {
  name: string;
  description: string;
  kind: string;
  extras: FrontmatterExtras;
}): string {
  const lines = ['---', `name: ${args.name}`, `description: ${args.description}`, 'metadata:'];
  lines.push(`  type: ${args.kind}`);
  lines.push(`  artifactType: ${args.extras.artifactType}`);
  lines.push(`  sourceArtifact: ${args.extras.sourceArtifact}`);
  lines.push(`  createdAt: ${args.extras.createdAt}`);
  if (args.extras.extra) {
    for (const [key, value] of Object.entries(args.extras.extra)) {
      lines.push(`  ${key}: ${value}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

function readInputContent(input: string | { path: string }): string {
  if (typeof input === 'string') return input;
  return readFileSync(input.path, 'utf8');
}

// ---------------------------------------------------------------------------
// Subdir routing (single source of truth for "where does each kind go?")
// ---------------------------------------------------------------------------

const KIND_TO_SUBDIR: Readonly<Record<ArtifactKind, string | null>> = {
  decision: 'audit-decisions',
  prompt: 'audit-prompts',
  'machine-output': null, // top-level (no subdir)
  narrative: null, // top-level (no subdir)
};

const KIND_TO_SLUG_PREFIX: Readonly<Record<ArtifactKind, string>> = {
  decision: 'audit-decision',
  prompt: 'audit-prompt',
  'machine-output': 'audit-output',
  narrative: 'audit-narrative',
};

function resolvePath(args: {
  projectRoot: string;
  kind: ArtifactKind;
  slug: string;
  date: string;
}): { memoryDir: string; filePath: string } {
  const memoryDir = join(args.projectRoot, '.peaks', 'memory');
  const subdir = KIND_TO_SUBDIR[args.kind];
  const targetDir = subdir === null ? memoryDir : join(memoryDir, subdir);
  return {
    memoryDir,
    filePath: join(targetDir, `${args.slug}.md`),
  };
}

// ---------------------------------------------------------------------------
// Writer 1: decision (back-compat with original decision-writer)
// ---------------------------------------------------------------------------

export function writeDecision(
  audit: RedLineAudit,
  options: ArtifactWriterOptions,
): ArtifactWriteRecord {
  const date = sanitizeDate(options.date);
  const slug = buildSlug(KIND_TO_SLUG_PREFIX.decision, date, options.rid, options.slugOverride);
  const { memoryDir, filePath } = resolvePath({
    projectRoot: options.projectRoot,
    kind: 'decision',
    slug,
    date,
  });
  const description = `Audit Decision ${date}${options.rid ? ` (${options.rid})` : ''}`;
  const renderOpts = options.rid ? { date, rid: options.rid } : { date };
  const markdown = renderDecisionMarkdown(audit, renderOpts);

  if (!options.dryRun) {
    mkdirSync(join(options.projectRoot, '.peaks', 'memory', KIND_TO_SUBDIR.decision ?? ''), {
      recursive: true,
    });
    writeFileSync(filePath, markdown, { mode: 0o644 });
  }

  const index = readMemoryIndex(options.projectRoot);
  const indexPath = join(memoryDir, 'index.json');

  return {
    kind: 'decision',
    slug,
    title: `Audit Decision ${date}${options.rid ? ` (${options.rid})` : ''}`,
    date,
    filePath,
    memoryDir,
    indexPath,
    indexSynced: index !== null,
  };
}

// ---------------------------------------------------------------------------
// Writer 2: prompt (methodology, audit-prompts/<slug>.md)
// ---------------------------------------------------------------------------

export interface PromptInput {
  readonly name: string;
  readonly description: string;
  readonly body: string;
}

export function writePrompt(input: PromptInput, options: ArtifactWriterOptions): ArtifactWriteRecord {
  const date = sanitizeDate(options.date);
  const slug = buildSlug(KIND_TO_SLUG_PREFIX.prompt, date, options.rid, options.slugOverride);
  const { memoryDir, filePath } = resolvePath({
    projectRoot: options.projectRoot,
    kind: 'prompt',
    slug,
    date,
  });

  const frontmatter = buildFrontmatter({
    name: slug,
    description: input.description,
    kind: 'reference',
    extras: {
      sourceArtifact: 'peaks audit artifact write --kind prompt',
      createdAt: date,
      artifactType: 'prompt',
    },
  });
  const markdown = `${frontmatter}\n\n# ${input.name}\n\n${input.body}\n`;

  if (!options.dryRun) {
    mkdirSync(join(options.projectRoot, '.peaks', 'memory', KIND_TO_SUBDIR.prompt ?? ''), {
      recursive: true,
    });
    writeFileSync(filePath, markdown, { mode: 0o644 });
  }

  const index = readMemoryIndex(options.projectRoot);
  const indexPath = join(memoryDir, 'index.json');
  return {
    kind: 'prompt',
    slug,
    title: input.name,
    date,
    filePath,
    memoryDir,
    indexPath,
    indexSynced: index !== null,
  };
}

// ---------------------------------------------------------------------------
// Writer 3: machine-output (JSON → .md envelope)
// ---------------------------------------------------------------------------

export interface MachineOutputInput {
  readonly name: string;
  readonly description: string;
  /** JSON string OR { path } to a JSON file on disk. */
  readonly json: string | { path: string };
}

export function writeMachineOutput(
  input: MachineOutputInput,
  options: ArtifactWriterOptions,
): ArtifactWriteRecord {
  const date = sanitizeDate(options.date);
  const slug = buildSlug(
    KIND_TO_SLUG_PREFIX['machine-output'],
    date,
    options.rid,
    options.slugOverride,
  );
  const { memoryDir, filePath } = resolvePath({
    projectRoot: options.projectRoot,
    kind: 'machine-output',
    slug,
    date,
  });

  const rawJson = readInputContent(input.json);
  // Validate that it's at least JSON-parseable; if not, fail loud.
  try {
    JSON.parse(rawJson);
  } catch (err) {
    throw new Error(
      `writeMachineOutput: input.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const frontmatter = buildFrontmatter({
    name: slug,
    description: input.description,
    kind: 'project',
    extras: {
      sourceArtifact: 'peaks audit artifact write --kind machine-output',
      createdAt: date,
      artifactType: 'machine-output',
    },
  });
  const title = input.name;
  const summaryTable = [
    '| Field | Value |',
    '| --- | --- |',
    `| Artifact kind | machine-output |`,
    `| JSON bytes | ${rawJson.length} |`,
    `| Captured at | ${date} |`,
  ].join('\n');
  const body = [
    `# ${title}`,
    '',
    input.description,
    '',
    '## Summary',
    '',
    summaryTable,
    '',
    '## Raw JSON',
    '',
    '```json',
    rawJson,
    '```',
    '',
  ].join('\n');
  const markdown = `${frontmatter}\n\n${body}`;

  if (!options.dryRun) {
    // machine-output goes to top-level (no subdir)
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(filePath, markdown, { mode: 0o644 });
  }

  const index = readMemoryIndex(options.projectRoot);
  const indexPath = join(memoryDir, 'index.json');
  return {
    kind: 'machine-output',
    slug,
    title,
    date,
    filePath,
    memoryDir,
    indexPath,
    indexSynced: index !== null,
  };
}

// ---------------------------------------------------------------------------
// Writer 4: narrative (free-form prose, top-level)
// ---------------------------------------------------------------------------

export interface NarrativeInput {
  readonly name: string;
  readonly description: string;
  readonly body: string;
}

export function writeNarrative(
  input: NarrativeInput,
  options: ArtifactWriterOptions,
): ArtifactWriteRecord {
  const date = sanitizeDate(options.date);
  const slug = buildSlug(KIND_TO_SLUG_PREFIX.narrative, date, options.rid, options.slugOverride);
  const { memoryDir, filePath } = resolvePath({
    projectRoot: options.projectRoot,
    kind: 'narrative',
    slug,
    date,
  });

  const frontmatter = buildFrontmatter({
    name: slug,
    description: input.description,
    kind: 'project',
    extras: {
      sourceArtifact: 'peaks audit artifact write --kind narrative',
      createdAt: date,
      artifactType: 'narrative',
    },
  });
  const markdown = `${frontmatter}\n\n# ${input.name}\n\n${input.body}\n`;

  if (!options.dryRun) {
    // narrative goes to top-level (no subdir)
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(filePath, markdown, { mode: 0o644 });
  }

  const index = readMemoryIndex(options.projectRoot);
  const indexPath = join(memoryDir, 'index.json');
  return {
    kind: 'narrative',
    slug,
    title: input.name,
    date,
    filePath,
    memoryDir,
    indexPath,
    indexSynced: index !== null,
  };
}
