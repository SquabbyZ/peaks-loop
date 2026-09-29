// ---------------------------------------------------------------------------
// Frontmatter extract-path surface for project memory files.
//
// Split out of `./frontmatter.ts` by the `b1-filesplit-campaign` (wave 3,
// leaf `b1w3-c-memory`): the accepted-kind allow-list, the `slugify` helper,
// and the extract-path block parser / renderer. `./frontmatter.ts` re-exports
// every name here so the `index.ts` barrel, `markdown-pure.ts` and the CLI
// keep importing them from `./parsers/frontmatter.js` unchanged.
// ---------------------------------------------------------------------------

import {
  PROJECT_MEMORY_KINDS,
  type ExtractedProjectMemory,
  type MemoryBlockParse,
  type ProjectMemoryKind
} from '../types.js';

/** Accepted-kind set, derived from the canonical `PROJECT_MEMORY_KINDS`
 *  tuple so the parser cannot drift from the union type / tier map. */
export const VALID_MEMORY_KINDS: ReadonlySet<ProjectMemoryKind> = new Set<ProjectMemoryKind>(
  PROJECT_MEMORY_KINDS
);

/** Exported for guard tests + tooling that needs to enumerate the accepted
 *  set (CLI help text, `--kind` validation) without duplicating the literal. */
export const VALID_PROJECT_MEMORY_KINDS: readonly ProjectMemoryKind[] = PROJECT_MEMORY_KINDS;

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'project-memory';
}

/**
 * Single implementation of the extract-path block parse. Returns a
 * discriminated result so the caller can say WHY a found block was rejected.
 *
 * The precondition order mirrors the original combined `if` exactly
 * (separator → title → kind present → kind valid → body non-empty), so the
 * accepted set is bit-for-bit what it always was; only the explanation is new.
 */
export function parseBlockResult(block: string, sourceArtifact: string): MemoryBlockParse {
  const normalizedBlock = block.replace(/\r\n/g, '\n');
  const separatorIndex = normalizedBlock.indexOf('\n---\n');
  if (separatorIndex < 0) {
    return {
      ok: false,
      reason: 'missing-separator',
      detail: "block header is not followed by a '---' separator line"
    };
  }

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
  if (!title) {
    return {
      ok: false,
      reason: 'missing-title',
      detail: "block header has no non-empty 'title:' field"
    };
  }
  if (!kind) {
    return {
      ok: false,
      reason: 'missing-kind',
      detail: "block header has no non-empty 'kind:' field"
    };
  }
  if (!VALID_MEMORY_KINDS.has(kind)) {
    return {
      ok: false,
      reason: 'unknown-kind',
      detail: `block declares kind '${kind}', which is not an accepted memory kind`
    };
  }
  if (body.length === 0) {
    return { ok: false, reason: 'empty-body', detail: 'block body is empty' };
  }

  return { ok: true, memory: { title, kind, body, sourceArtifact } };
}

/**
 * `null`-on-failure projection of `parseBlockResult`. Kept because callers
 * (and the parser's own contract) consume a plain nullable value; both views
 * come from the one implementation above, so they cannot diverge.
 */
export function parseBlock(block: string, sourceArtifact: string): ExtractedProjectMemory | null {
  const parsed = parseBlockResult(block, sourceArtifact);
  return parsed.ok ? parsed.memory : null;
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
