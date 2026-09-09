// ---------------------------------------------------------------------------
// Frontmatter parser + renderer for project memory files.
//
// Two surface shapes live here:
//
//   1. `parseBlock` / `renderMemoryFile` — extract-path side. We get raw
//      markdown body content delimited by `<!-- peaks-memory:start -->` /
//      `<!-- peaks-memory:end -->` markers with a YAML-ish header at the top
//      (title, kind) and a `---` separator before the body.
//
//   2. `parseStoredMemoryFile` — read-path side. Files in `.peaks/memory/`
//      are stored as standard YAML frontmatter (name / description /
//      metadata.type / metadata.sourceArtifact) followed by the body.
//
// Both parsers share the 8-kind `VALID_MEMORY_KINDS` allow-list and the
// `slugify` helper used to derive filenames from titles.
// ---------------------------------------------------------------------------

import type { ExtractedProjectMemory, ProjectMemoryKind, StoredProjectMemory } from '../types.js';

export const VALID_MEMORY_KINDS = new Set<ProjectMemoryKind>([
  'project',
  'rule',
  'decision',
  'reference',
  'feedback',
  'convention',
  'module',
  'lesson'
]);

/** Exported for guard tests + tooling that needs to enumerate the valid
 *  set without duplicating the literal. Single source of truth. */
export const VALID_PROJECT_MEMORY_KINDS: readonly ProjectMemoryKind[] = Array.from(VALID_MEMORY_KINDS);

export function slugify(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'project-memory';
}

export function parseBlock(block: string, sourceArtifact: string): ExtractedProjectMemory | null {
  const normalizedBlock = block.replace(/\r\n/g, '\n');
  const separatorIndex = normalizedBlock.indexOf('\n---\n');
  if (separatorIndex < 0) return null;

  const header = normalizedBlock.slice(0, separatorIndex).trim();
  const body = normalizedBlock.slice(separatorIndex + '\n---\n'.length).trim();
  const fields = new Map<string, string>();

  for (const line of header.split('\n')) {
    const [key, ...valueParts] = line.split(':');
    const normalizedKey = key?.trim();
    const value = valueParts.join(':').trim();
    if (normalizedKey && value) {
      fields.set(normalizedKey, value);
    }
  }

  const title = fields.get('title')?.trim();
  const kind = fields.get('kind')?.trim() as ProjectMemoryKind | undefined;
  if (!title || !kind || !VALID_MEMORY_KINDS.has(kind) || body.length === 0) return null;

  return { title, kind, body, sourceArtifact };
}

export function renderMemoryFile(memory: ExtractedProjectMemory): string {
  const name = slugify(memory.title);
  return [
    '---',
    `name: ${name}`,
    `description: ${memory.title}`,
    'metadata:',
    `  type: ${memory.kind}`,
    `  sourceArtifact: ${memory.sourceArtifact}`,
    '---',
    '',
    memory.body,
    ''
  ].join('\n');
}

/**
 * Where a stored memory file's `kind` came from. `'none'` means the file
 * has no resolvable kind (no `metadata.type`, no `kind:`, no `type:`, or
 * the value present is not one of the 8 valid kinds).
 */
export type MemoryKindSource = 'metadata.type' | 'kind' | 'type' | 'none';

export interface MemoryKindResolution {
  kind: ProjectMemoryKind | null;
  source: MemoryKindSource;
  /** The first raw value found in the frontmatter, even when it is not a valid kind. */
  rawKind: string | null;
}

export interface ParsedMemoryFrontmatter {
  hasFrontmatter: boolean;
  name?: string;
  description?: string;
  sourceArtifact?: string;
  kind: MemoryKindResolution;
  /** Raw frontmatter block text (without the `---` fences); '' when absent. */
  frontmatter: string;
  body: string;
}

/**
 * Resolve the peaks memory kind from a stored memory file's frontmatter.
 *
 * Resolution order (first *valid* kind wins):
 *   1. nested `metadata.type`   — the canonical peaks contract
 *   2. top-level `kind:`        — the legacy alias (was silently dropped before)
 *   3. top-level `type:`        — tolerated by the pre-existing trim-based reader
 *   4. `none`                   — reported as unclassified; never invented
 *
 * Slice 2026-09-09-memory-system-overhaul (B): before this helper, files
 * using a top-level `kind:` were silently dropped by the reader (defect
 * #2). Falling through to `kind:` / `type:` is a strict superset of the
 * old behaviour — no previously-indexed file changes kind.
 */
export function resolveMemoryKind(content: string): MemoryKindResolution {
  const parsed = parseMemoryFrontmatter(content);
  return parsed.kind;
}

/**
 * Single parse surface for stored memory frontmatter. Both
 * `parseStoredMemoryFile` (read path) and the reindex / ingest / doctor
 * classifiers consume this so there is exactly one kind-resolution rule
 * in the codebase.
 */
export function parseMemoryFrontmatter(content: string): ParsedMemoryFrontmatter {
  const normalized = content.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { hasFrontmatter: false, kind: { kind: null, source: 'none', rawKind: null }, frontmatter: '', body: normalized.trim() };
  }
  const endIndex = normalized.indexOf('\n---\n', 4);
  if (endIndex < 0) {
    return { hasFrontmatter: false, kind: { kind: null, source: 'none', rawKind: null }, frontmatter: '', body: normalized.trim() };
  }

  const frontmatter = normalized.slice(4, endIndex);
  const body = normalized.slice(endIndex + '\n---\n'.length).trim();

  let name: string | undefined;
  let description: string | undefined;
  let sourceArtifact: string | undefined;
  let nestedType: string | undefined;
  let topType: string | undefined;
  let kindField: string | undefined;
  let inMetadata = false;

  for (const rawLine of frontmatter.split('\n')) {
    const indented = /^\s/.test(rawLine);
    const line = rawLine.trim();
    if (!indented) {
      inMetadata = line === 'metadata:';
    }
    if (line.startsWith('name:')) name = line.slice('name:'.length).trim();
    else if (line.startsWith('description:')) description = line.slice('description:'.length).trim();
    else if (line.startsWith('type:')) {
      const value = line.slice('type:'.length).trim();
      if (indented || inMetadata) nestedType ??= value;
      else topType ??= value;
    } else if (line.startsWith('kind:')) kindField ??= line.slice('kind:'.length).trim();
    else if (line.startsWith('sourceArtifact:')) sourceArtifact = line.slice('sourceArtifact:'.length).trim();
  }

  const candidates: ReadonlyArray<readonly [MemoryKindSource, string | undefined]> = [
    ['metadata.type', nestedType],
    ['kind', kindField],
    ['type', topType]
  ];
  let kind: MemoryKindResolution = { kind: null, source: 'none', rawKind: null };
  for (const [source, raw] of candidates) {
    if (raw === undefined || raw === '') continue;
    if (kind.rawKind === null) kind = { kind: null, source: 'none', rawKind: raw };
    if (VALID_MEMORY_KINDS.has(raw as ProjectMemoryKind)) {
      kind = { kind: raw as ProjectMemoryKind, source, rawKind: raw };
      break;
    }
  }

  return { hasFrontmatter: true, frontmatter, ...(name !== undefined ? { name } : {}), ...(description !== undefined ? { description } : {}), ...(sourceArtifact !== undefined ? { sourceArtifact } : {}), kind, body };
}

export function parseStoredMemoryFile(content: string, filePath: string): StoredProjectMemory | null {
  const parsed = parseMemoryFrontmatter(content);
  if (!parsed.hasFrontmatter) return null;
  const { name, description, sourceArtifact, body } = parsed;
  const kind = parsed.kind.kind;
  if (!name || kind === null || body.length === 0) return null;

  return {
    name,
    title: description ?? name,
    kind,
    sourceArtifact: sourceArtifact && sourceArtifact !== 'undefined' ? sourceArtifact : null,
    body,
    filePath
  };
}