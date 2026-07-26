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

export function parseStoredMemoryFile(content: string, filePath: string): StoredProjectMemory | null {
  const normalized = content.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return null;
  const endIndex = normalized.indexOf('\n---\n', 4);
  if (endIndex < 0) return null;

  const frontmatter = normalized.slice(4, endIndex);
  const body = normalized.slice(endIndex + '\n---\n'.length).trim();

  let name: string | undefined;
  let description: string | undefined;
  let kind: string | undefined;
  let sourceArtifact: string | undefined;

  for (const rawLine of frontmatter.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('name:')) name = line.slice('name:'.length).trim();
    else if (line.startsWith('description:')) description = line.slice('description:'.length).trim();
    else if (line.startsWith('type:')) kind = line.slice('type:'.length).trim();
    else if (line.startsWith('sourceArtifact:')) sourceArtifact = line.slice('sourceArtifact:'.length).trim();
  }

  if (!name || !kind || !VALID_MEMORY_KINDS.has(kind as ProjectMemoryKind) || body.length === 0) return null;

  return {
    name,
    title: description ?? name,
    kind: kind as ProjectMemoryKind,
    sourceArtifact: sourceArtifact && sourceArtifact !== 'undefined' ? sourceArtifact : null,
    body,
    filePath
  };
}