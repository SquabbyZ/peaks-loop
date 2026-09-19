/**
 * peaks-prd handoff — frontmatter schema (v2.11.0, schemaVersion: 2).
 *
 * The handoff is the **immutable** single source of truth that all
 * downstream consumers (peaks-rd main loop + 4 audit sub-agents +
 * peaks-qa) read. It is written by peaks-prd AFTER user confirmation
 * (per `skills/bee/peaks-prd/SKILL.md` Step 5.5) and replaces the legacy
 * peaks-rd tech-doc handoff (v2.10.0 and earlier).
 *
 * Frontmatter invariant: `handoffHash` MUST equal the lowercase hex
 * sha256 of the body content (UTF-8, no BOM, no frontmatter prefix).
 * The hash is computed by `services/prd/handoff-service.ts` at write
 * time and re-verified by every consumer before reading the body
 * (D1 in `v2-11-rm-rd-techdoc-immutable-handoff`).
 *
 * Path convention: the file lands at
 * `.peaks/_runtime/<sessionId>/prd/handoff-<rid>.md` (one capsule per slice;
 * `.peaks/_runtime/<sessionId>/prd/handoff.md` is the pre-rid-scoping tier and
 * stays readable). Gitignored session artifact; the binding to `<sessionId>` lives in
 * `.peaks/_runtime/current-change`). NEVER write under
 * `.peaks/_runtime/<change-id>/...` directly (slice 2.8.3 hard ban).
 */

/** Schema version 2 — bumped from v1 (which had no sha256 + no AC/goal
 *  IDs in frontmatter). Every consumer MUST refuse a handoff whose
 *  frontmatter is missing or carries `schemaVersion !== '2'`. */
export type HandoffSchemaVersion = '2';

/**
 * The FIVE fixed `gateEvidence` keys, in canonical serialization order.
 *
 * This array is the single source of truth for the key set: the
 * `GateEvidenceKey` type is derived from it, the serializer iterates it,
 * and the reader matches against it. Slice B1
 * (`2026-09-17-4-0-51-cleanup`) collapsed four mutually contradictory
 * descriptions of this field (a `string[]` in the reader's code comment,
 * a `string[]` of PATHS in its tests, a map of paths in
 * `skills/bee/peaks-rd/references/writing-handoff-frontmatter.md:35-41`)
 * onto the documented map. Do NOT re-spell these five literals anywhere
 * else — a second copy is how the four descriptions diverged.
 */
export const GATE_EVIDENCE_KEYS = [
  'projectScan',
  'prdHandoff',
  'codeReview',
  'securityReview',
  'perfBaseline'
] as const;

/** One of the five `gateEvidence` keys. Derived, never re-spelled. */
export type GateEvidenceKey = (typeof GATE_EVIDENCE_KEYS)[number];

/**
 * Is `key` one of the five? THE membership test — the serializer's
 * unknown-key check, the reader's classifier and the shape predicate all ask
 * this one function, so no caller can disagree about what the key set is.
 */
export function isGateEvidenceKey(key: string): key is GateEvidenceKey {
  return (GATE_EVIDENCE_KEYS as readonly string[]).includes(key);
}

/**
 * `gateEvidence` — a partial map from gate key to the PATH of that gate's
 * evidence file. Partial because a slice may legitimately not have run
 * every gate; the consumer (Gate C, wired in slice B2) fails on a missing
 * key, which is where "did you declare it?" is decided — NOT here.
 *
 * Unknown keys are not expressible in this type. The reader still reports
 * them at runtime (`unknownKeys`) so a typo is diagnosable rather than
 * silently dropped.
 */
export type GateEvidence = Readonly<Partial<Record<GateEvidenceKey, string>>>;

/**
 * Handoff frontmatter — the structured header block between the
 * leading and trailing `---` fences. `readonly` enforces D1's
 * immutability: once written, peaks-rd / peaks-qa / sub-agents MUST
 * NOT mutate the on-disk copy.
 */
export interface HandoffFrontmatter {
  readonly requestId: string;
  readonly sessionId: string;
  readonly schemaVersion: HandoffSchemaVersion;
  /** Lowercase hex sha256 of the body content. Recomputed by
   *  `verifyHandoff`; mismatch means tampering → refuse to read. */
  readonly handoffHash: string;
  /** ISO 8601 timestamp at write time. */
  readonly writtenAt: string;
  /** PRD goal IDs the handoff binds to (e.g. `['G1', 'G2']`). */
  readonly goals: readonly string[];
  /** PRD acceptance-criteria IDs (e.g. `['AC-1', 'AC-2']`). */
  readonly acceptanceCriteria: readonly string[];
  /** PRD preserved-behavior IDs (e.g. `['P1', 'P12']`). */
  readonly preservedBehavior: readonly string[];
  /** Absolute path to the handoff file on disk (for re-verify). */
  readonly handoffPath: string;
  /** Paths to the evidence files peaks-qa validates at Gate C, keyed by
   *  gate. ABSENT (not `{}`) when the slice declared none — the serializer
   *  omits the block entirely rather than emitting an empty map, so old
   *  handoffs gain no noise line. Read it through
   *  `readHandoffGateEvidence`, which reports WHY it is unusable instead of
   *  collapsing every failure to `null`. */
  readonly gateEvidence?: GateEvidence;
}

/** Handoff — frontmatter + body. The body is the markdown source of
 *  truth that sub-agents and downstream consumers parse. */
export interface Handoff {
  readonly frontmatter: HandoffFrontmatter;
  readonly body: string;
}

/** Result of `verifyHandoff`. `ok: true` means the frontmatter's
 *  `handoffHash` matches the recomputed sha256 of the body. */
export interface HandoffProbe {
  readonly ok: boolean;
  readonly reason?: HandoffProbeReason;
  readonly actualHash?: string;
  readonly expectedHash?: string;
}

export type HandoffProbeReason =
  'file-missing' | 'frontmatter-malformed' | 'hash-mismatch' | 'schema-version-mismatch';
