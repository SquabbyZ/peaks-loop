/**
 * The four context layers the `peaks context layer` verb can fetch.
 *
 *   - L0: full read (every SKILL.md in full)
 *   - L1: summary (one paragraph per skill + the skill list)
 *   - L2: index (just names + paths)
 *   - L3: fuzzy search by query (delegates to peaks memory search)
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { searchMemory } from '../../services/memory/memory-search-service.js';
import { getErrorMessage } from '../cli-helpers.js';

export type ContextLayer = 'L0' | 'L1' | 'L2' | 'L3';

const SKILLS_DIR = 'skills';

/** Fallback preview length for a skill whose body has no blank-line paragraph break. */
const L1_PREVIEW_CHARS = 400;

/** How much of an L3 hit's description is echoed into the search listing. */
const L3_DESCRIPTION_CHARS = 120;

export interface LayerPayload {
  readonly layer: ContextLayer;
  readonly description: string;
  readonly files: readonly { path: string; bytes: number }[];
  readonly content: string;
  readonly byteSize: number;
  readonly warnings: readonly string[];
}

function readSkillsDir(projectRoot: string): readonly string[] {
  const skillsRoot = join(projectRoot, SKILLS_DIR);
  if (!existsSync(skillsRoot)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const skillMd = join(skillsRoot, entry.name, 'SKILL.md');
    if (existsSync(skillMd)) {
      out.push(`skills/${entry.name}/SKILL.md`);
    }
  }
  return out;
}

function readSkillFile(projectRoot: string, relPath: string): string {
  const abs = join(projectRoot, relPath);
  try {
    return readFileSync(abs, 'utf-8');
  } catch {
    return '';
  }
}

/** Concatenate every SKILL.md in full. */
async function fetchL0(projectRoot: string): Promise<LayerPayload> {
  const files = readSkillsDir(projectRoot);
  const warnings: string[] = [];
  let content = '';
  let byteSize = 0;
  const sizes: { path: string; bytes: number }[] = [];
  for (const rel of files) {
    const body = readSkillFile(projectRoot, rel);
    if (body.length === 0) {
      warnings.push(`failed to read ${rel}`);
      continue;
    }
    content += `## ${rel}\n\n${body}\n\n`;
    sizes.push({ path: rel, bytes: body.length });
    byteSize += body.length;
  }
  return {
    layer: 'L0',
    description: 'full read: every SKILL.md concatenated',
    files: sizes,
    content,
    byteSize,
    warnings
  };
}

/** One paragraph (or a bounded preview) per skill. */
async function fetchL1(projectRoot: string): Promise<LayerPayload> {
  const files = readSkillsDir(projectRoot);
  const warnings: string[] = [];
  let content = '';
  let byteSize = 0;
  const sizes: { path: string; bytes: number }[] = [];
  for (const rel of files) {
    const body = readSkillFile(projectRoot, rel);
    if (body.length === 0) {
      warnings.push(`failed to read ${rel}`);
      continue;
    }
    const firstPara = body.split(/\r?\n\r?\n/, 2)[0] ?? body.slice(0, L1_PREVIEW_CHARS);
    content += `## ${rel}\n\n${firstPara}\n\n`;
    sizes.push({ path: rel, bytes: firstPara.length });
    byteSize += firstPara.length;
  }
  return {
    layer: 'L1',
    description: 'summary: first paragraph per skill',
    files: sizes,
    content,
    byteSize,
    warnings
  };
}

/** Names and paths only, no bodies. */
async function fetchL2(projectRoot: string): Promise<LayerPayload> {
  const files = readSkillsDir(projectRoot);
  const content = files.map((f) => `- ${f}`).join('\n') + '\n';
  const byteSize = content.length;
  return {
    layer: 'L2',
    description: 'index: skill paths only (no body)',
    files: files.map((f) => ({ path: f, bytes: 0 })),
    content,
    byteSize,
    warnings: []
  };
}

/** Top 10 memory-search hits for `query`; a failure rides `warnings`. */
async function fetchL3(projectRoot: string, query: string): Promise<LayerPayload> {
  const warnings: string[] = [];
  if (query.trim().length === 0) {
    warnings.push('empty query; L3 requires a --query string for fuzzy search');
    return {
      layer: 'L3',
      description: 'fuzzy search (empty query)',
      files: [],
      content: '',
      byteSize: 0,
      warnings
    };
  }
  try {
    const hits = searchMemory({ projectRoot, query, limit: 10 });
    const lines: string[] = [];
    for (const hit of hits) {
      lines.push(
        `- [${hit.score.toFixed(2)}] ${hit.sourcePath}: ${hit.description.slice(0, L3_DESCRIPTION_CHARS)}`
      );
    }
    const content = lines.join('\n') + '\n';
    return {
      layer: 'L3',
      description: 'fuzzy search: top 10 hits from memory index',
      files: hits.map((h) => ({ path: h.sourcePath, bytes: h.description.length })),
      content,
      byteSize: content.length,
      warnings
    };
  } catch (error) {
    return {
      layer: 'L3',
      description: 'fuzzy search (failed)',
      files: [],
      content: '',
      byteSize: 0,
      warnings: [`L3 search failed: ${getErrorMessage(error)}`]
    };
  }
}

/** Dispatch one layer by its validated `L0|L1|L2|L3` id. */
export async function fetchContextLayer(
  level: ContextLayer,
  projectRoot: string,
  query: string
): Promise<LayerPayload> {
  if (level === 'L0') return fetchL0(projectRoot);
  if (level === 'L1') return fetchL1(projectRoot);
  if (level === 'L2') return fetchL2(projectRoot);
  return fetchL3(projectRoot, query);
}

export function isContextLayer(value: string): value is ContextLayer {
  return value === 'L0' || value === 'L1' || value === 'L2' || value === 'L3';
}
