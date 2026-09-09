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
//      metadata.type / metadata.sourceArtifact) followed by the body. A file
//      may also open with HTML-comment lines (the `<!-- peaks-memory:start -->`
//      sediment marker) before the frontmatter; `parseMemoryFrontmatter`
//      skips that leading comment run before looking for the `---` fence.
//
// Both parsers share the `VALID_MEMORY_KINDS` allow-list (derived from the
// canonical `PROJECT_MEMORY_KINDS` tuple in `../types.ts`) and the
// `slugify` helper used to derive filenames from titles.
// ---------------------------------------------------------------------------

import { basename } from 'node:path';

import { PROJECT_MEMORY_KINDS } from '../types.js';
import type { ExtractedProjectMemory, ProjectMemoryKind, StoredProjectMemory } from '../types.js';

/** Accepted-kind set, derived from the canonical `PROJECT_MEMORY_KINDS`
 *  tuple so the parser cannot drift from the union type / tier map. */
export const VALID_MEMORY_KINDS: ReadonlySet<ProjectMemoryKind> = new Set<ProjectMemoryKind>(PROJECT_MEMORY_KINDS);

/** Exported for guard tests + tooling that needs to enumerate the accepted
 *  set (CLI help text, `--kind` validation) without duplicating the literal. */
export const VALID_PROJECT_MEMORY_KINDS: readonly ProjectMemoryKind[] = PROJECT_MEMORY_KINDS;

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
 * the value present is not one of the accepted kinds in
 * `PROJECT_MEMORY_KINDS`).
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
  /** Top-level `title:` frontmatter value. Never the nested `metadata.title`
   *  (that is a different semantic); used only as a name fallback on the
   *  read path — see `resolveMemoryName`. */
  title?: string;
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

/** Start of an HTML comment line, allowing leading horizontal whitespace. */
const LEADING_COMMENT_OPEN = /^[ \t]*<!--/;

/**
 * Length of the leading run of blank lines and standalone HTML-comment lines.
 *
 * A stored memory may be written with the documented sediment marker
 * (`<!-- peaks-memory:start -->`) — or any HTML comment — BEFORE its YAML
 * frontmatter. This helper reports how much of the file to skip so the fence
 * can still be found. At least one comment line must be present: a file that
 * merely starts with blank lines is not treated as marker-prefixed, so the
 * pre-existing (fence-at-byte-0) behaviour is preserved exactly.
 */
function leadingCommentPrefixLength(normalized: string): number {
  let offset = 0;
  let sawComment = false;
  for (;;) {
    const rest = normalized.slice(offset);
    const blank = /^[ \t]*\n/.exec(rest);
    if (blank !== null) {
      offset += blank[0].length;
      continue;
    }
    const open = LEADING_COMMENT_OPEN.exec(rest);
    if (open === null) break;
    const closeIndex = rest.indexOf('-->', open[0].length);
    if (closeIndex < 0) break;
    const afterClose = closeIndex + '-->'.length;
    const lineEnd = rest.indexOf('\n', afterClose);
    if (lineEnd < 0) break;
    // Only a whole comment line counts; trailing prose after `-->` means the
    // file does not open with a comment block.
    if (rest.slice(afterClose, lineEnd).trim() !== '') break;
    offset += lineEnd + 1;
    sawComment = true;
  }
  return sawComment ? offset : 0;
}

/**
 * Single parse surface for stored memory frontmatter. Both
 * `parseStoredMemoryFile` (read path) and the reindex / ingest / doctor
 * classifiers consume this so there is exactly one kind-resolution rule
 * in the codebase.
 *
 * Tolerates a leading run of HTML-comment lines (e.g. the
 * `<!-- peaks-memory:start -->` sediment marker) before the opening `---`
 * fence. The closing fence is still required and body extraction is
 * unchanged: the body is the text after the closing fence.
 */
export function parseMemoryFrontmatter(content: string): ParsedMemoryFrontmatter {
  const normalized = content.replace(/\r\n/g, '\n');
  const head = normalized.slice(leadingCommentPrefixLength(normalized));
  if (!head.startsWith('---\n')) {
    return { hasFrontmatter: false, kind: { kind: null, source: 'none', rawKind: null }, frontmatter: '', body: normalized.trim() };
  }
  const endIndex = head.indexOf('\n---\n', 4);
  if (endIndex < 0) {
    return { hasFrontmatter: false, kind: { kind: null, source: 'none', rawKind: null }, frontmatter: '', body: normalized.trim() };
  }

  const frontmatter = head.slice(4, endIndex);
  const body = head.slice(endIndex + '\n---\n'.length).trim();

  let name: string | undefined;
  let titleField: string | undefined;
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
    else if (line.startsWith('title:')) { if (!indented) titleField = line.slice('title:'.length).trim(); }
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

  return { hasFrontmatter: true, frontmatter, ...(name !== undefined ? { name } : {}), ...(titleField !== undefined ? { title: titleField } : {}), ...(description !== undefined ? { description } : {}), ...(sourceArtifact !== undefined ? { sourceArtifact } : {}), kind, body };
}

/** Which frontmatter field (or the filename) supplied a memory's name. */
export type MemoryNameSource = 'name' | 'title' | 'stem' | 'none';

export interface MemoryNameResolution {
  /** The resolved name, or null when every fallback was empty. */
  name: string | null;
  source: MemoryNameSource;
}

/**
 * Deterministic name fallback chain for the read path:
 *
 *   1. `name:`            — the canonical field written by `renderMemoryFile`
 *   2. `title:`           — hand-written / legacy files (the 5 on-disk files
 *                           this slice fixes carried only `title:` + `kind:`)
 *   3. filename stem      — last resort, so a well-formed memory with a valid
 *                           kind is never dropped just for missing a name
 *
 * Empty values are skipped rather than accepted: a `name:` of `''` still
 * falls through, and a file whose stem is also empty resolves to null so the
 * caller's validation is preserved (never invents a name).
 */
export function resolveMemoryName(parsed: ParsedMemoryFrontmatter, filePath: string): MemoryNameResolution {
  if (parsed.name !== undefined && parsed.name.length > 0) return { name: parsed.name, source: 'name' };
  if (parsed.title !== undefined && parsed.title.length > 0) return { name: parsed.title, source: 'title' };
  const stem = basename(filePath, '.md');
  if (stem.length > 0) return { name: stem, source: 'stem' };
  return { name: null, source: 'none' };
}

export function parseStoredMemoryFile(content: string, filePath: string): StoredProjectMemory | null {
  const parsed = parseMemoryFrontmatter(content);
  if (!parsed.hasFrontmatter) return null;
  const { description, sourceArtifact, body } = parsed;
  const kind = parsed.kind.kind;
  const { name } = resolveMemoryName(parsed, filePath);
  if (name === null || kind === null || body.length === 0) return null;

  return {
    name,
    title: description ?? name,
    kind,
    sourceArtifact: sourceArtifact && sourceArtifact !== 'undefined' ? sourceArtifact : null,
    body,
    filePath
  };
}