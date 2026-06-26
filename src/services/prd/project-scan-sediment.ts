/**
 * peaks-prd project-scan sediment writer — v2.11.0 D3 (Group C, Tier 5).
 *
 * Appends new business concepts to
 * `.peaks/project-scan/business-knowledge.md`. Idempotent on the
 * `(concept, sourceRid)` tuple — re-running with the same input does not
 * duplicate. The on-disk format mirrors the bootstrap template: a YAML
 * frontmatter carrying `schemaVersion: 1` plus a markdown table in the body
 * whose rows are the BusinessConcept tuples. The table format is
 * human-readable (grep-friendly for `peaks project knowledge --filter`).
 *
 * Companion to `project-scan-reader.ts`. The reader and the writer agree
 * on the same on-disk format: the parsed `BusinessKnowledge.concepts`
 * array is the union of all rows in the markdown table.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { BusinessConcept, BusinessKnowledge } from './project-scan-types.js';
import { readBusinessKnowledge } from './project-scan-reader.js';

const BUSINESS_KNOWLEDGE_RELATIVE = join(
  '.peaks',
  'project-scan',
  'business-knowledge.md'
);

export interface SedimentAppendOptions {
  readonly projectRoot: string;
  readonly concept: BusinessConcept;
}

export interface SedimentAppendResult {
  /** `true` when the file was rewritten; `false` when the (concept, sourceRid) tuple was already present. */
  readonly written: boolean;
  /** `true` when a new file was created (vs. appended to an existing file). */
  readonly created: boolean;
  /** Total concept rows after the operation. */
  readonly totalConcepts: number;
}

/**
 * Append (or create) a business concept row in
 * `.peaks/project-scan/business-knowledge.md`.
 *
 * Idempotency contract (matches the bootstrap file's design intent):
 * - same `(concept, sourceRid)` tuple → skip (return `written: false`)
 * - same `concept`, DIFFERENT `sourceRid` → append (re-definition from a new source)
 * - new concept → append
 *
 * Throws when the existing file has malformed frontmatter or markdown
 * table (no silent corruption). Caller should fix the file before retrying.
 */
export async function appendBusinessConcept(
  opts: SedimentAppendOptions
): Promise<SedimentAppendResult> {
  const existing = await readBusinessKnowledge(opts.projectRoot);
  const absolutePath = join(opts.projectRoot, BUSINESS_KNOWLEDGE_RELATIVE);

  if (existing === null) {
    const fresh: BusinessKnowledge = {
      schemaVersion: 1,
      concepts: [opts.concept]
    };
    await writeBusinessKnowledgeFile(absolutePath, fresh);
    return { written: true, created: true, totalConcepts: 1 };
  }

  const duplicateIndex = existing.concepts.findIndex(
    (c) => c.concept === opts.concept.concept && c.sourceRid === opts.concept.sourceRid
  );
  if (duplicateIndex >= 0) {
    return {
      written: false,
      created: false,
      totalConcepts: existing.concepts.length
    };
  }

  const updated: BusinessKnowledge = {
    schemaVersion: 1,
    concepts: [...existing.concepts, opts.concept]
  };
  await writeBusinessKnowledgeFile(absolutePath, updated);
  return {
    written: true,
    created: false,
    totalConcepts: updated.concepts.length
  };
}

// ── internal helpers ─────────────────────────────────────────────────

async function writeBusinessKnowledgeFile(
  absolutePath: string,
  knowledge: BusinessKnowledge
): Promise<void> {
  await mkdir(dirname(absolutePath), { recursive: true });
  const body = renderBusinessKnowledgeBody(knowledge);
  await writeFile(absolutePath, body, 'utf8');
}

/** Serialize a `BusinessKnowledge` to the markdown-table body format.
 *  Matches the bootstrap template at `.peaks/project-scan/business-knowledge.md`. */
function renderBusinessKnowledgeBody(knowledge: BusinessKnowledge): string {
  const header = [
    '# Business Knowledge',
    '',
    '> Auto-managed by `peaks-prd` sediment step (v2.11.0 D3 / Group C Tier 5).',
    '> Schema: `BusinessKnowledge { schemaVersion: 1; concepts: BusinessConcept[] }`.',
    '> Idempotency key: `(concept, sourceRid)` — re-running with the same tuple does not duplicate.',
    '',
    '| Concept | Definition | Source | Decided | Evidence |',
    '|---|---|---|---|---|'
  ];
  const rows = knowledge.concepts.map(formatRow);
  const footer = [
    '',
    '## How to append',
    '',
    '```bash',
    '# programmatic (peaks-txt sediment step):',
    '#   appendBusinessConcept({ projectRoot, concept })',
    '#   see src/services/prd/project-scan-sediment.ts',
    '```',
    '',
    '## How to consume',
    '',
    '```bash',
    'peaks project knowledge --project <repo> --json',
    'peaks project knowledge --project <repo> --filter <concept-substr> --json',
    '```',
    ''
  ];
  return ['---\nschemaVersion: 1\n---\n', ...header, ...rows, ...footer].join('\n');
}

function formatRow(c: BusinessConcept): string {
  return `| ${escapeCell(c.concept)} | ${escapeCell(c.definition)} | ${escapeCell(c.sourceRid)} | ${escapeCell(c.decidedAt)} | ${escapeCell(c.evidence)} |`;
}

/** Escape pipe characters + newlines for safe markdown-table cells. */
function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}