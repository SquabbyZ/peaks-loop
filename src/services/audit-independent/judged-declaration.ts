/**
 * The machine-readable declaration of what an audit judged.
 *
 * `## Red-line scope` in the RD request is prose for a human and is read by no
 * machine here. The declaration is the only machine-read statement of a
 * slice's surface, and the producer that emits the artifact writes it, so a
 * caller cannot produce the artifact without one.
 *
 * Grammar — exactly one fenced json block under the heading `## Judged content`:
 *
 *   ## Judged content
 *
 *   ```json
 *   {"schemaVersion":1,"judgedAt":"2026-10-13T00:00:00.000Z","handoffHash":"unknown",
 *    "files":[{"path":"src/a.ts","sha256":"<64 hex>"}],
 *    "roots":[{"path":"src/dir","why":"<text>"}]}
 *   ```
 *
 * Rules. No backslash anywhere in the block: JSON resolves an escaped spelling
 * to the same string, so a raw reader and a parsing reader could disagree about
 * what was declared. A `path` is a relative POSIX path with no `..` and no
 * leading slash; `files` is non-empty; a duplicate path is refused. A root
 * entry must carry a non-empty `why` — a bare directory root is refused.
 *
 * LIMIT, recorded rather than fixed: any rule keyed on a self-reported field is
 * closed against accidental shedding, and not against a producer that rewrites
 * its own field.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const JUDGED_HEADING = '## Judged content';
export const JUDGED_SCHEMA_VERSION = 1;

export type JudgedFile = { readonly path: string; readonly sha256: string };
export type JudgedRoot = { readonly path: string; readonly why: string };

export type JudgedDeclaration = {
  readonly schemaVersion: number;
  readonly judgedAt: string;
  readonly handoffHash: string;
  readonly files: readonly JudgedFile[];
  readonly roots: readonly JudgedRoot[];
};

export type JudgedParseFailure = {
  readonly ok: false;
  readonly code: string;
  readonly detail: string;
};

export type JudgedParseResult =
  { readonly ok: true; readonly declaration: JudgedDeclaration } | JudgedParseFailure;

/**
 * The audit service's detect result when the declaration cannot be built. It
 * lives here so the producer can substitute it for the probe's verdict without
 * growing the service's own branch count.
 */
export function declarationMissingDetect(
  detect: { readonly handoffPresent: boolean; readonly templatePresent: boolean },
  failure: JudgedParseFailure
): {
  readonly state: 'declaration-missing';
  readonly handoffPresent: boolean;
  readonly templatePresent: boolean;
  readonly warnings: readonly string[];
  readonly nextActions: readonly string[];
} {
  return {
    state: 'declaration-missing',
    handoffPresent: detect.handoffPresent,
    templatePresent: detect.templatePresent,
    warnings: [
      `security-audit refused: the judged declaration is not buildable (${failure.code}: ${failure.detail}).`
    ],
    nextActions: [
      'Pass every judged path with --judged <path> (repeatable); each must exist and be a file.',
      'A run that declares nothing is refused rather than given an unbounded surface.'
    ]
  };
}

export type Sha256Result =
  | { readonly ok: true; readonly sha256: string }
  | { readonly ok: false; readonly code: 'missing' | 'unreadable'; readonly detail: string };

/** Hash the bytes of one file. A missing file is reported, never guessed. */
export function sha256OfFile(absPath: string): Sha256Result {
  let bytes: Buffer;
  try {
    bytes = readFileSync(absPath);
  } catch (error: unknown) {
    const code = (error as { code?: string }).code === 'ENOENT' ? 'missing' : 'unreadable';
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, code, detail };
  }
  return { ok: true, sha256: createHash('sha256').update(bytes).digest('hex') };
}

/** A declared path is a relative POSIX path pointing at one file. */
export function validateDeclaredPath(
  raw: unknown
): { ok: true; path: string } | { ok: false; detail: string } {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { ok: false, detail: 'path must be a non-empty string' };
  }
  if (raw.includes('\\')) return { ok: false, detail: `path must not contain a backslash: ${raw}` };
  if (raw.startsWith('/')) return { ok: false, detail: `path must be relative: ${raw}` };
  if (/^[a-zA-Z]:/.test(raw)) return { ok: false, detail: `path must be relative: ${raw}` };
  if (raw.endsWith('/')) {
    return { ok: false, detail: `path must name a file, not a directory: ${raw}` };
  }
  const segments = raw.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) {
    return { ok: false, detail: `path must be normalised with no traversal: ${raw}` };
  }
  return { ok: true, path: raw };
}

const HEX64 = /^[a-f0-9]{64}$/;

/** Render the declaration as the artifact section the check reads back. */
export function renderJudgedDeclaration(declaration: JudgedDeclaration): string {
  const payload = {
    schemaVersion: declaration.schemaVersion,
    judgedAt: declaration.judgedAt,
    handoffHash: declaration.handoffHash,
    files: declaration.files.map((f) => ({ path: f.path, sha256: f.sha256 })),
    roots: declaration.roots.map((r) => ({ path: r.path, why: r.why }))
  };
  return [JUDGED_HEADING, '', '```json', JSON.stringify(payload), '```', ''].join('\n');
}

/**
 * Extract the fenced block under the heading. Returns the raw block text or a
 * code naming why there is none. Deliberately literal: a heading that does not
 * match byte-for-byte is a missing declaration, not a variant to accommodate.
 */
function extractJudgedBlock(
  body: string
): { ok: true; block: string } | { ok: false; code: string } {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trimEnd() === JUDGED_HEADING);
  if (start === -1) return { ok: false, code: 'declaration-missing' };
  const rest = lines.slice(start + 1);
  const fenceStart = rest.findIndex((line) => line.trim() === '```json');
  if (fenceStart === -1) return { ok: false, code: 'declaration-unfenced' };
  const block: string[] = [];
  for (const line of rest.slice(fenceStart + 1)) {
    if (line.trim() === '```') return { ok: true, block: block.join('\n') };
    block.push(line);
  }
  return { ok: false, code: 'declaration-unterminated' };
}

function parseFileEntries(raw: unknown): { ok: true; files: JudgedFile[] } | JudgedParseFailure {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, code: 'declaration-empty', detail: 'files must be a non-empty array' };
  }
  const files: JudgedFile[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') {
      return { ok: false, code: 'declaration-schema', detail: 'a files entry is not an object' };
    }
    const row = entry as Record<string, unknown>;
    const checked = validateDeclaredPath(row['path']);
    if (!checked.ok) return { ok: false, code: 'declaration-path', detail: checked.detail };
    if (typeof row['sha256'] !== 'string' || !HEX64.test(row['sha256'])) {
      return { ok: false, code: 'declaration-hash', detail: checked.path };
    }
    if (seen.has(checked.path)) {
      return { ok: false, code: 'declaration-duplicate', detail: checked.path };
    }
    seen.add(checked.path);
    files.push({ path: checked.path, sha256: row['sha256'] });
  }
  return { ok: true, files };
}

function parseRootEntries(raw: unknown): { ok: true; roots: JudgedRoot[] } | JudgedParseFailure {
  if (!Array.isArray(raw)) {
    return { ok: false, code: 'declaration-schema', detail: 'roots must be an array' };
  }
  const roots: JudgedRoot[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') {
      return { ok: false, code: 'declaration-schema', detail: 'a roots entry is not an object' };
    }
    const row = entry as Record<string, unknown>;
    const checked = validateDeclaredPath(row['path']);
    if (!checked.ok) return { ok: false, code: 'declaration-path', detail: checked.detail };
    const why = row['why'];
    if (typeof why !== 'string' || why.trim().length === 0) {
      return { ok: false, code: 'declaration-bare-root', detail: checked.path };
    }
    roots.push({ path: checked.path, why });
  }
  return { ok: true, roots };
}

function parseEnvelopeBlock(
  block: string
): { ok: true; obj: Record<string, unknown> } | JudgedParseFailure {
  // A backslash is refused before parsing, not after: JSON resolves escapes, so
  // a parsed value and the raw bytes could describe different surfaces.
  if (block.includes('\\')) {
    return { ok: false, code: 'declaration-escaped', detail: 'the block contains a backslash' };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(block);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, code: 'declaration-unparsable', detail };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, code: 'declaration-unparsable', detail: 'the block is not a JSON object' };
  }
  const obj = raw as Record<string, unknown>;
  if (obj['schemaVersion'] !== JUDGED_SCHEMA_VERSION) {
    return { ok: false, code: 'declaration-schema', detail: String(obj['schemaVersion']) };
  }
  if (typeof obj['judgedAt'] !== 'string' || typeof obj['handoffHash'] !== 'string') {
    return { ok: false, code: 'declaration-schema', detail: 'judgedAt / handoffHash' };
  }
  return { ok: true, obj };
}

/**
 * Parse the declaration out of an artifact body. Strict on shape: a block that
 * parses to something other than the grammar is a refusal, never a default.
 */
export function parseJudgedDeclaration(body: string): JudgedParseResult {
  const extracted = extractJudgedBlock(body);
  if (!extracted.ok) return { ok: false, code: extracted.code, detail: JUDGED_HEADING };

  const envelope = parseEnvelopeBlock(extracted.block);
  if (!envelope.ok) return envelope;

  const files = parseFileEntries(envelope.obj['files']);
  if (!files.ok) return files;

  const roots = parseRootEntries(envelope.obj['roots'] ?? []);
  if (!roots.ok) return roots;

  return {
    ok: true,
    declaration: {
      schemaVersion: JUDGED_SCHEMA_VERSION,
      judgedAt: envelope.obj['judgedAt'] as string,
      handoffHash: envelope.obj['handoffHash'] as string,
      files: files.files,
      roots: roots.roots
    }
  };
}
