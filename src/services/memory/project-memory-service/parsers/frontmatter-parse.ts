// ---------------------------------------------------------------------------
// Frontmatter extract-path surface for project memory files.
//
// Split out of `./frontmatter.ts` by the `b1-filesplit-campaign` (wave 3,
// leaf `b1w3-c-memory`): the accepted-kind allow-list, the `slugify` helper,
// and the extract-path block parser / renderer. `./frontmatter.ts` re-exports
// every name here so the `index.ts` barrel, `markdown-pure.ts` and the CLI
// keep importing them from `./parsers/frontmatter.js` unchanged.
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';

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

/**
 * Hex characters of the title digest the derived branch keeps. 32 hex = 128
 * bits, and the name is therefore `memory_` + 32 = **39 characters for every
 * title**, however long the title is.
 */
const DERIVED_NAME_HEX_LENGTH = 32;

/**
 * Filename stem for a memory title, and the `name:` its stored frontmatter
 * carries.
 *
 * The character class is Unicode-aware deliberately. An ASCII-only class
 * reduced EVERY title written in a non-Latin script to the same empty string,
 * so all of them landed on one constant name: whichever title arrived first
 * took that file, and each later one was skipped because the store refuses to
 * overwrite a file it already holds. Two titles that still reduce to one stem
 * are refused outright by the plan builders' duplicate-name check.
 *
 * A title with no letter or digit in any script ("!!!") leaves nothing to build
 * a name from. That branch takes the first 32 hex characters of the title's
 * sha256 instead of a fixed constant, so distinct titles still reach distinct
 * names. It is a DIGEST rather than the title's bytes because of LENGTH: an
 * encoding that grew with the title (the two-hex-chars-per-byte
 * `toString('hex')` this replaced) produced names past the filesystem limit for
 * a long enough title, so the write failed and took the whole batch with it —
 * measured, exit 1 and 0 files for a 140-character title. A digest is 39
 * characters whatever the title is.
 *
 * THE FIXED LENGTH IS BOUGHT WITH A PROBABILISTIC GUARANTEE, and that is the
 * strongest thing this branch can claim. For the derived branch distinct titles
 * reach distinct names with overwhelming probability rather than by
 * construction: a collision needs two titles whose first 128 digest bits agree
 * — the birthday bound puts that at about n^2 / 2^129 for n derived names in one
 * store, i.e. under 1 in 10^26 at a million names. The branch above keeps the
 * stronger, exact property (two titles share a stem only if they are equal
 * modulo case and runs of non-letter/non-digit characters). Neither branch loses
 * a block silently on a collision: within a run the duplicate-name check refuses
 * the whole extract, and across runs the later write is skipped and NAMED in the
 * envelope's `warnings`.
 *
 * The '_' is outside the alphabet the branch above can emit, so a derived name
 * cannot equal a title-derived stem.
 */
export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length > 0) return slug;
  const digest = createHash('sha256').update(title, 'utf8').digest('hex');
  return `memory_${digest.slice(0, DERIVED_NAME_HEX_LENGTH)}`;
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
