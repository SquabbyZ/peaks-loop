/**
 * peaks-prd project-scan reader — v2.11.0 (D3 in
 * `v2-11-rm-rd-techdoc-immutable-handoff`).
 *
 * Reads the git-tracked project-level artifacts at
 * `.peaks/project-scan/{project-scan.md, business-knowledge.md}`.
 *
 * Both readers swallow `ENOENT` (return `null`) — peaks-prd's gate
 * uses the `null` return to decide whether to bootstrap. Other IO
 * errors propagate (no silent failures).
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

import type {
  BusinessConcept,
  BusinessKnowledge,
  ProjectScan,
} from './project-scan-types.js';

const PROJECT_SCAN_RELATIVE = join('.peaks', 'project-scan', 'project-scan.md');
const BUSINESS_KNOWLEDGE_RELATIVE = join(
  '.peaks',
  'project-scan',
  'business-knowledge.md'
);

/** Read `.peaks/project-scan/project-scan.md`. Returns `null` when the
 *  file or its parent dir is absent (fresh project). Throws on other
 *  IO failures or malformed YAML. */
export async function readProjectScan(
  projectRoot: string
): Promise<ProjectScan | null> {
  const content = await readOptionalFile(projectRoot, PROJECT_SCAN_RELATIVE);
  if (content === null) return null;
  return parseProjectScanContent(content);
}

/** Read `.peaks/project-scan/business-knowledge.md`. Returns `null`
 *  when absent. Throws on other IO failures or malformed YAML. */
export async function readBusinessKnowledge(
  projectRoot: string
): Promise<BusinessKnowledge | null> {
  const content = await readOptionalFile(projectRoot, BUSINESS_KNOWLEDGE_RELATIVE);
  if (content === null) return null;
  return parseBusinessKnowledgeContent(content);
}

/** Read the raw markdown content of a project-scan file. Returns
 *  `null` when absent. Used by bootstrap flows (peaks-prd Step 0.8
 *  first-run templates). */
export async function readProjectScanRaw(
  projectRoot: string
): Promise<string | null> {
  return readOptionalFile(projectRoot, PROJECT_SCAN_RELATIVE);
}

export async function readBusinessKnowledgeRaw(
  projectRoot: string
): Promise<string | null> {
  return readOptionalFile(projectRoot, BUSINESS_KNOWLEDGE_RELATIVE);
}

// ── internal helpers ─────────────────────────────────────────────────

async function readOptionalFile(
  projectRoot: string,
  relativePath: string
): Promise<string | null> {
  const absolutePath = join(projectRoot, relativePath);
  try {
    return await readFile(absolutePath, 'utf8');
  } catch (error: unknown) {
    if (isEnoent(error)) return null;
    throw error;
  }
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'ENOENT'
  );
}

function parseProjectScanContent(content: string): ProjectScan {
  const { frontmatter } = splitFrontmatter(content);
  let parsed: unknown;
  try {
    parsed = parseYaml(frontmatter);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`project-scan: frontmatter YAML parse failed: ${message}`);
  }
  if (!isProjectScan(parsed)) {
    throw new Error('project-scan: frontmatter shape validation failed');
  }
  return parsed;
}

function parseBusinessKnowledgeContent(content: string): BusinessKnowledge {
  const { frontmatter, body } = splitFrontmatter(content);
  let parsed: unknown;
  try {
    parsed = parseYaml(frontmatter);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `business-knowledge: frontmatter YAML parse failed: ${message}`
    );
  }
  if (!isBusinessKnowledgeFrontmatter(parsed)) {
    throw new Error('business-knowledge: frontmatter shape validation failed');
  }
  // Concepts live in the markdown TABLE in the body (not in the frontmatter
  // YAML). The bootstrap template writes the table for human readability; the
  // sediment step (Group C, Tier 5) appends new rows to the same table.
  const concepts = parseConceptsFromMarkdownTable(body);
  return { schemaVersion: 1, concepts };
}

/** Parse the markdown table rows under `# Business Knowledge` (or any H1).
 *  Each row MUST have 5 cells: Concept | Definition | Source | Decided | Evidence.
 *  Throws on rows that don't match the shape (we never silently drop a row). */
function parseConceptsFromMarkdownTable(body: string): readonly BusinessConcept[] {
  const lines = body.split(/\r?\n/);
  const tableLines = lines.filter((line) => /^\s*\|/.test(line));
  if (tableLines.length < 2) {
    // No table at all (fresh file). Return empty; sediment writer will append.
    return [];
  }
  // First row = header, second row = separator (---|---|---). Skip both.
  const dataRows = tableLines.slice(2);
  const concepts: BusinessConcept[] = [];
  for (const row of dataRows) {
    const cells = row
      .split('|')
      .map((cell) => cell.trim())
      .filter((cell, idx, arr) => !(idx === 0 && cell === '') && !(idx === arr.length - 1 && cell === ''));
    if (cells.length < 5) continue;
    const [concept, definition, sourceRid, decidedAt, evidence] = cells;
    if (!concept || !definition || !sourceRid || !decidedAt || !evidence) continue;
    concepts.push({ concept, definition, sourceRid, decidedAt, evidence });
  }
  return concepts;
}

function splitFrontmatter(content: string): { frontmatter: string; body: string } {
  const match = /^---\n([\s\S]*?)\n---(?:\n([\s\S]*))?$/.exec(content);
  if (!match) {
    throw new Error('frontmatter block missing or malformed');
  }
  return { frontmatter: match[1] ?? '', body: match[2] ?? '' };
}

function isProjectScan(value: unknown): value is ProjectScan {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    v.schemaVersion === 1 &&
    typeof v.capturedAt === 'string' &&
    !!v.techStack &&
    typeof v.techStack === 'object' &&
    !!v.libraryVersions &&
    typeof v.libraryVersions === 'object' &&
    typeof v.architecture === 'string' &&
    !!v.karpathySelfCheck &&
    typeof v.karpathySelfCheck === 'object'
  );
}

function isBusinessKnowledgeFrontmatter(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  // Frontmatter only carries `schemaVersion: 1`; concepts live in the
  // markdown table in the body (see parseConceptsFromMarkdownTable).
  return v.schemaVersion === 1;
}