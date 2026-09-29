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
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parse as parseYaml } from 'yaml';

import { classifyGateEvidence } from './handoff-gate-evidence.js';
import {
  HANDOFF_SCHEMA_VERSION,
  isGateEvidence,
  isSchemaVersion2,
  serializeHandoff
} from './handoff-frontmatter-shape.js';
import { handoffRelativePath } from './handoff-path-resolution.js';
import type { GateEvidence, Handoff, HandoffFrontmatter, HandoffProbe } from './handoff-types.js';

// Slice `b1-filesplit-campaign` (wave 3): the capsule PATH layer
// (`assertSafeHandoffIds` / `handoffRelativePath` / `resolveHandoffPath`) and the
// frontmatter field primitives (`HANDOFF_SCHEMA_VERSION` / `serializeHandoff` /
// `isSchemaVersion2` / `isGateEvidence`) moved VERBATIM to
// `./handoff-path-resolution.ts` and `./handoff-frontmatter-shape.ts` so this
// file clears the 300 raw-line cap. The public names below are re-exported from
// this path, so no importer changed; the id->path guard these joins carry is
// still measured — the new module is named in rule D's scanned set in
// `tests/unit/runtime/no-runtime-input-guard.test.ts`.
export { handoffRelativePath, resolveHandoffPath } from './handoff-path-resolution.js';

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
  /** Override path; defaults to `.peaks/_runtime/<sid>/prd/handoff-<rid>.md`. */
  handoffPath?: string;
  /** Paths to the gate evidence files, keyed by gate. Omitted field and
   *  empty map are equivalent here: neither renders a `gateEvidence` block,
   *  so a caller that declares nothing writes bytes identical to a pre-B1
   *  capsule.
   *
   *  THIS IS NOT A SECOND SOURCE (B2). In production the value reaching this
   *  parameter is always `deriveGateEvidence(...)`
   *  (`services/prd/gate-evidence-derivation.ts`), which computes it from the
   *  request type and the gate table. This function stays pure — it does not
   *  read the type itself — so the map can be constructed without touching
   *  the disk; that is why the parameter exists rather than an internal call.
   *
   *  SHAPE CONTRACT (F2 of `rid-b1-qa`, now enforced in both directions): a
   *  map this accepts is EXACTLY what `readHandoffGateEvidence` reports as
   *  `evidence` — `classifyGateEvidence` is the one shape rule behind both,
   *  and `parseHandoffContent` stores the classified map rather than the raw
   *  YAML. A declaration both paths REFUSE (`not-map` / `value-not-string`)
   *  is refused here by a throw and there by a status; neither silently
   *  produces a map the other cannot. */
  gateEvidence?: GateEvidence;
}): Handoff {
  const handoffPath = opts.handoffPath ?? handoffRelativePath(opts.sessionId, opts.requestId);
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
    // Conditionally spread rather than `gateEvidence: undefined`: this
    // tsconfig sets `exactOptionalPropertyTypes`, and an explicit `undefined`
    // would also make `serializeHandoffFrontmatter`'s
    // `frontmatter.gateEvidence` key present-but-undefined for every caller
    // that declares nothing.
    ...(opts.gateEvidence === undefined ? {} : { gateEvidence: opts.gateEvidence })
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
      actualHash: handoff.frontmatter.handoffHash
    };
  }
  const actualHash = sha256OfBody(handoff.body);
  if (actualHash !== handoff.frontmatter.handoffHash) {
    return {
      ok: false,
      reason: 'hash-mismatch',
      actualHash,
      expectedHash: handoff.frontmatter.handoffHash
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
  //
  // F2: `gateEvidence` is normalized the same way, for the same reason. The
  // raw YAML value is not returned: the CLASSIFIED map is. Unknown keys are
  // not part of `GateEvidence`, so storing the raw object made the interface
  // claim a five-key map while holding a six-key one — and made
  // `frontmatter.gateEvidence` disagree with what the field's reader reports
  // for the same bytes. The predicate above has already rejected every shape
  // that is not `absent` or `ok`, so this spread only ever adds a clean map.
  const gateEvidenceShape = classifyGateEvidence(parsed.gateEvidence);
  return {
    frontmatter: {
      ...parsed,
      schemaVersion: HANDOFF_SCHEMA_VERSION,
      ...(gateEvidenceShape.kind === 'ok' ? { gateEvidence: gateEvidenceShape.evidence } : {})
    },
    body
  };
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
    typeof v.handoffPath === 'string' &&
    isGateEvidence(v.gateEvidence)
  );
}
