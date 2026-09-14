/**
 * peaks-prd handoff service — v2.11.0 (D1 in
 * `v2-11-rm-rd-techdoc-immutable-handoff`).
 *
 * Owns the immutable handoff at
 * `.peaks/_runtime/<sessionId>/prd/handoff-<rid>.md` (one capsule per slice;
 * the pre-rid-scoping `.peaks/_runtime/<sessionId>/prd/handoff.md` stays
 * readable through `resolveHandoffPath`):
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
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parse as parseYaml } from 'yaml';

import { serializeHandoffFrontmatter } from './handoff-frontmatter.js';
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

/**
 * The canonical capsule path for ONE SLICE, relative to the project root.
 *
 * Slice `2026-09-14-prd-capsule-rid-scoping`: the capsule used to be one slot
 * per SESSION (`prd/handoff.md`), so the second slice's handoff silently
 * overwrote the first slice's — and `AUDIT_REQUIRES_HANDOFF` stayed green
 * because it never checked WHOSE rid the file named. Measured on
 * `2026-09-13-session-21878f`: a four-slice job passed that prerequisite on a
 * capsule left by a different line of work.
 *
 * This is the WRITE target, so it always carries the rid — a consumer-side
 * fallback here would leave a rid-scoped requirement with a bare-name writer,
 * which is the defect shape this slice exists to remove. Readers that must
 * tolerate pre-rid-scoping sessions call `resolveHandoffPath` instead.
 */
export function handoffRelativePath(sessionId: string, requestId: string): string {
  return join('.peaks', '_runtime', sessionId, 'prd', `handoff-${requestId}.md`);
}

/**
 * The capsule a CONSUMER should read for (session, requestId): the rid-scoped
 * path when it is on disk, else the pre-rid-scoping bare name. Returns null
 * when neither exists.
 *
 * Three sessions on disk still hold only the bare file
 * (`2026-09-06-session-a87ca4`, `2026-09-12-session-e37ef0`,
 * `2026-09-13-session-21878f`), so the legacy tier has to keep resolving for
 * the gate and for every reader below.
 *
 * `requestId` is optional because the detect-only audit surface reaches its
 * service without one. Such a caller can name only the bare path: a session
 * holding nothing but rid-scoped capsules reports missing rather than picking
 * among its siblings' capsules, which would re-open the cross-slice mix-up
 * this scoping exists to close (fail closed, not "some capsule is there").
 */
export function resolveHandoffPath(opts: {
  projectRoot: string;
  sessionId: string;
  requestId?: string;
}): string | null {
  const candidates = [
    ...(opts.requestId !== undefined ? [handoffRelativePath(opts.sessionId, opts.requestId)] : []),
    join('.peaks', '_runtime', opts.sessionId, 'prd', 'handoff.md')
  ];
  for (const relative of candidates) {
    const absolute = join(opts.projectRoot, relative);
    if (existsSync(absolute)) return absolute;
  }
  return null;
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
  /** Override path; defaults to `.peaks/_runtime/<sid>/prd/handoff-<rid>.md`. */
  handoffPath?: string;
}): Handoff {
  const handoffPath =
    opts.handoffPath ??
    handoffRelativePath(opts.sessionId, opts.requestId);
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
  // The one canonical frontmatter rendering, shared with
  // `handoff-auto-regen.ts`. `yaml.stringify` used to render this block and
  // emitted `schemaVersion: "2"` + a bare `handoffHash:`, which the
  // `AUDIT_REQUIRES_HANDOFF` gate and both audit loaders all reject.
  return `${serializeHandoffFrontmatter(handoff.frontmatter)}${handoff.body}`;
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
 * Slice `2026-09-14-handoff-writer-gate-divergence` then fixed the other half:
 * the writer no longer emits the quoted form at all (see
 * `handoff-frontmatter.ts`). This tolerance stays because handoffs already on
 * disk were written by the old writer and by hand; the writer fix must not
 * retroactively make them unreadable.
 */
function isSchemaVersion2(value: unknown): boolean {
  return value === HANDOFF_SCHEMA_VERSION || value === 2;
}

/**
 * The READER's shape check — deliberately looser than `verifyHandoff`:
 * `handoffHash` must be a string, and nothing about its VALUE is validated here.
 *
 * The accepted-but-unverifiable shape, stated rather than left to be
 * discovered: a capsule carrying `handoffHash: sha256:<hex>` — the form the
 * pre-fix writer and this session's hand-corrected capsules use — is READ by
 * `readHandoff` and can NEVER pass `verifyHandoff`. The verifier compares the
 * value to `sha256OfBody(body)` byte for byte (`:127-135`) and no prefix
 * normalization exists anywhere in this module, so the leading `sha256:`
 * guarantees `hash-mismatch`. ONLY the bare-hex form verifies, which is what
 * every writer now emits (`handoff-frontmatter.ts`).
 *
 * So `readHandoff` succeeding is NOT evidence that a capsule is verifiable —
 * the tolerance above exists so old capsules stay READABLE, not so they become
 * acceptable. Request §三 bullet 3 asked for exactly this confirmation
 * (rid `2026-09-14-handoff-writer-gate-divergence`).
 */
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