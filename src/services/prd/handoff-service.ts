/**
 * peaks-prd handoff service — v2.11.0 (D1 in
 * `v2-11-rm-rd-techdoc-immutable-handoff`).
 *
 * Owns the immutable handoff at
 * `.peaks/_runtime/<sessionId>/prd/handoff.md`:
 *
 *   - `initHandoff` — pure; computes sha256 of the body and returns
 *     a Handoff whose frontmatter `handoffHash` matches.
 *   - `writeHandoff` — writes the file under `.peaks/_runtime/<sid>/prd/`,
 *     creating the dir if missing.
 *   - `readHandoff` — reads + parses; throws on malformed input.
 *   - `verifyHandoff` — re-reads + recomputes hash; returns a
 *     `HandoffProbe` (never throws on hash mismatch — that's a
 *     verification outcome, not a fatal error).
 *   - `showHandoff` — returns the raw markdown content (frontmatter
 *     + body verbatim) for human display via `peaks prd handoff show`.
 *
 * Hash contract (D1): `handoffHash` is the lowercase hex sha256 of
 * the body content as UTF-8 bytes. The body MUST be the literal
 * markdown source — no normalization, no trailing-newline padding.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import type {
  Handoff,
  HandoffFrontmatter,
  HandoffProbe,
  HandoffSchemaVersion,
} from './handoff-types.js';

/** Required schema version for new handoffs. */
const HANDOFF_SCHEMA_VERSION: HandoffSchemaVersion = '2';

/** Compute the lowercase hex sha256 of a UTF-8 string. */
export function sha256OfBody(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

/** Pure: produce a Handoff with the frontmatter populated. Hash is
 *  computed here; callers MUST NOT pre-populate `handoffHash`. */
export function initHandoff(opts: {
  requestId: string;
  sessionId: string;
  body: string;
  writtenAt: string;
  goals: readonly string[];
  acceptanceCriteria: readonly string[];
  preservedBehavior: readonly string[];
  /** Override path; defaults to `.peaks/_runtime/<sid>/prd/handoff.md`. */
  handoffPath?: string;
}): Handoff {
  const handoffPath =
    opts.handoffPath ??
    join('.peaks', '_runtime', opts.sessionId, 'prd', 'handoff.md');
  const handoffHash = sha256OfBody(opts.body);
  const frontmatter: HandoffFrontmatter = {
    requestId: opts.requestId,
    sessionId: opts.sessionId,
    schemaVersion: HANDOFF_SCHEMA_VERSION,
    handoffHash,
    writtenAt: opts.writtenAt,
    goals: [...opts.goals],
    acceptanceCriteria: [...opts.acceptanceCriteria],
    preservedBehavior: [...opts.preservedBehavior],
    handoffPath,
  };
  return { frontmatter, body: opts.body };
}

/** Write a Handoff to disk. `projectRoot` is the absolute project
 *  root (so the `.peaks/_runtime/...` path is resolved absolutely).
 *  Creates intermediate dirs. */
export async function writeHandoff(
  handoff: Handoff,
  projectRoot: string
): Promise<{ path: string; hash: string }> {
  const absolutePath = join(projectRoot, handoff.frontmatter.handoffPath);
  await mkdir(dirname(absolutePath), { recursive: true });
  const content = serializeHandoff(handoff);
  await writeFile(absolutePath, content, 'utf8');
  return { path: absolutePath, hash: handoff.frontmatter.handoffHash };
}

/** Read + parse a handoff from disk. Throws on missing file or
 *  malformed frontmatter. */
export async function readHandoff(filePath: string): Promise<Handoff> {
  const content = await readFile(filePath, 'utf8');
  return parseHandoffContent(content);
}

/** Verify a handoff by re-reading and re-hashing. Returns a probe
 *  (never throws on hash mismatch — that's the outcome).
 *
 *  N1: the two failure classes are reported separately. The previous
 *  single `catch` folded every read failure into `file-missing`, so a
 *  handoff that WAS on disk but whose frontmatter the parser refused was
 *  reported as absent — sending an operator to look for a missing file
 *  that was right there. Only a genuine read failure (ENOENT, EACCES, …)
 *  is `file-missing` now; anything the parser rejects is
 *  `frontmatter-malformed`. */
export async function verifyHandoff(filePath: string): Promise<HandoffProbe> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf8');
  } catch {
    return { ok: false, reason: 'file-missing' };
  }
  let handoff: Handoff;
  try {
    handoff = parseHandoffContent(content);
  } catch {
    return { ok: false, reason: 'frontmatter-malformed' };
  }
  if (handoff.frontmatter.schemaVersion !== HANDOFF_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: 'schema-version-mismatch',
      actualHash: handoff.frontmatter.handoffHash,
    };
  }
  const actualHash = sha256OfBody(handoff.body);
  if (actualHash !== handoff.frontmatter.handoffHash) {
    return {
      ok: false,
      reason: 'hash-mismatch',
      actualHash,
      expectedHash: handoff.frontmatter.handoffHash,
    };
  }
  return { ok: true, actualHash, expectedHash: actualHash };
}

/** Return the raw markdown content of a handoff file (frontmatter +
 *  body verbatim). For human display. */
export async function showHandoff(filePath: string): Promise<string> {
  return readFile(filePath, 'utf8');
}

// ── internal helpers ─────────────────────────────────────────────────

/** Split raw content into `{ frontmatter, body }`. Throws if the
 *  frontmatter block is missing or malformed. */
function parseHandoffContent(content: string): Handoff {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(content);
  if (!match) {
    throw new Error('handoff: frontmatter block missing or malformed');
  }
  const yamlBlock = match[1]!;
  const body = match[2] ?? '';
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlBlock);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`handoff: frontmatter YAML parse failed: ${message}`);
  }
  if (!isHandoffFrontmatter(parsed)) {
    throw new Error('handoff: frontmatter shape validation failed');
  }
  // N1: normalize the version to its canonical string form. `schemaVersion: 2`
  // (bare) is valid YAML that parses to the NUMBER 2; `schemaVersion: '2'` is
  // what `stringifyYaml` writes. Both mean schema version 2, so the parsed
  // frontmatter is returned with the canonical `'2'` rather than the raw scalar
  // — otherwise every downstream `=== '2'` comparison would depend on which
  // producer wrote the file.
  return {
    frontmatter: { ...parsed, schemaVersion: HANDOFF_SCHEMA_VERSION },
    body
  };
}

function serializeHandoff(handoff: Handoff): string {
  const yamlStr = stringifyYaml(
    handoff.frontmatter as unknown as Record<string, unknown>
  ).trimEnd();
  return `---\n${yamlStr}\n---\n${handoff.body}`;
}

/**
 * N1: accept BOTH shapes of `schemaVersion` — the string `'2'` and the bare
 * YAML number `2` — and reject any other value.
 *
 * The reader used to require `typeof v.schemaVersion === 'string'`. That made
 * `readHandoff` refuse `prd/handoff.md` written by `handoff-auto-regen.ts`,
 * which emits the unquoted `schemaVersion: 2`, while the
 * `AUDIT_REQUIRES_HANDOFF` prereq — a SUBSTRING check for `schemaVersion: 2` —
 * happily passed the same bytes. So the gate that exists to guarantee a
 * readable handoff was satisfied by a handoff the parser would not read, and
 * `peaks prd handoff verify` exited 1 on a healthy file.
 *
 * Quoting the writer instead is NOT a fix: it would delete the very substring
 * the prereq pins, turning a broken read into a broken gate. The tolerant read
 * is the only change that satisfies both consumers.
 */
function isSchemaVersion2(value: unknown): boolean {
  return value === HANDOFF_SCHEMA_VERSION || value === 2;
}

function isHandoffFrontmatter(value: unknown): value is HandoffFrontmatter {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.requestId === 'string' &&
    typeof v.sessionId === 'string' &&
    isSchemaVersion2(v.schemaVersion) &&
    typeof v.handoffHash === 'string' &&
    typeof v.writtenAt === 'string' &&
    Array.isArray(v.goals) &&
    Array.isArray(v.acceptanceCriteria) &&
    Array.isArray(v.preservedBehavior) &&
    typeof v.handoffPath === 'string'
  );
}