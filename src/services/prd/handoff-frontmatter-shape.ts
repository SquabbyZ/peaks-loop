/**
 * Slice `b1-filesplit-campaign` (wave 3) — verbatim extraction of the handoff
 * frontmatter's FIELD-level primitives from `./handoff-service.ts`: the required
 * schema version, the one canonical frontmatter rendering, and the two
 * per-field acceptance rules (`schemaVersion`, `gateEvidence`). The composite
 * predicate that calls them, `isHandoffFrontmatter`, stays in
 * `handoff-service.ts` — it carries an existing `complexity` finding, and a new
 * module must start clean, so only what it calls moved.
 *
 * Bodies, doc comments and thrown strings are unchanged; `handoff-service.ts`
 * imports these and keeps exporting its own public surface, so no importer
 * changed.
 */
import { serializeHandoffFrontmatter } from './handoff-frontmatter.js';
import { classifyGateEvidence } from './handoff-gate-evidence.js';
import type { Handoff, HandoffSchemaVersion } from './handoff-types.js';

/** Required schema version for new handoffs. */
export const HANDOFF_SCHEMA_VERSION: HandoffSchemaVersion = '2';

export function serializeHandoff(handoff: Handoff): string {
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
 * the writer no longer emits the quoted form at all (see
 * `handoff-frontmatter.ts`). This tolerance stays because handoffs already on
 * disk were written by the old writer and by hand; the writer fix must not
 * retroactively make them unreadable.
 */
export function isSchemaVersion2(value: unknown): boolean {
  return value === HANDOFF_SCHEMA_VERSION || value === 2;
}

/**
 * B1: `gateEvidence` is optional, but when present it MUST be a map of
 * strings — an ARRAY here is the pre-B1 shape its own test file used to
 * write, and it is a broken declaration, not a claim.
 *
 * used to be a second predicate (same boundary, different downstream result)
 * that let the same bytes read one way here and another way through
 * `readHandoffGateEvidence`; both now ask `classifyGateEvidence`. Only
 * `absent` and `ok` are accepted: a malformed declaration must be refused by
 * `readHandoff` (which is documented to throw on malformed input) exactly as
 * the reader refuses it, so the two can never disagree about the same file.
 *
 * Unknown keys are still accepted HERE — the map is normalized to the five
 * known keys by the caller — because refusing them would make a typo render
 * a whole capsule unreadable, and the reader's `unknownKeys` is the surface
 * that makes the typo diagnosable instead.
 */
export function isGateEvidence(value: unknown): boolean {
  const kind = classifyGateEvidence(value).kind;
  return kind === 'absent' || kind === 'ok';
}
