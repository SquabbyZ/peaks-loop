/**
 * peaks-prd handoff — frontmatter schema (v2.11.0, schemaVersion: 2).
 *
 * The handoff is the **immutable** single source of truth that all
 * downstream consumers (peaks-rd main loop + 4 audit sub-agents +
 * peaks-qa) read. It is written by peaks-prd AFTER user confirmation
 * (per `skills/peaks-prd/SKILL.md` Step 5.5) and replaces the legacy
 * peaks-rd tech-doc handoff (v2.10.0 and earlier).
 *
 * Frontmatter invariant: `handoffHash` MUST equal the lowercase hex
 * sha256 of the body content (UTF-8, no BOM, no frontmatter prefix).
 * The hash is computed by `services/prd/handoff-service.ts` at write
 * time and re-verified by every consumer before reading the body
 * (D1 in `v2-11-rm-rd-techdoc-immutable-handoff`).
 *
 * Path convention: the file lands at
 * `.peaks/_runtime/<sessionId>/prd/handoff.md` (gitignored session
 * artifact; the binding to `<changeId>` lives in
 * `.peaks/_runtime/current-change`). NEVER write under
 * `.peaks/_runtime/<change-id>/...` directly (slice 2.8.3 hard ban).
 */

/** Schema version 2 — bumped from v1 (which had no sha256 + no AC/goal
 *  IDs in frontmatter). Every consumer MUST refuse a handoff whose
 *  frontmatter is missing or carries `schemaVersion !== '2'`. */
export type HandoffSchemaVersion = '2';

/**
 * Handoff frontmatter — the structured header block between the
 * leading and trailing `---` fences. `readonly` enforces D1's
 * immutability: once written, peaks-rd / peaks-qa / sub-agents MUST
 * NOT mutate the on-disk copy.
 */
export interface HandoffFrontmatter {
  readonly requestId: string;
  readonly sessionId: string;
  readonly changeId: string;
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
  | 'file-missing'
  | 'frontmatter-malformed'
  | 'hash-mismatch'
  | 'schema-version-mismatch';