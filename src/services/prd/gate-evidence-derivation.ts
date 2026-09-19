/**
 * Where `gateEvidence` comes FROM, and where its promise is checked.
 *
 * B2 (merged with the B1 repair), rid `rid-b2-gate-evidence-wiring`.
 *
 * B1 made the field real at the SERVICE layer and QA found the hole that
 * mattered (F1 of `rid-b1-qa`): all three frontmatter producers passed
 * nothing, so no capsule on disk ever carried the field — the dead surface
 * had moved one layer out, from "no producer function" to "no production
 * caller". This module closes that by DERIVING the map instead of accepting
 * it from a caller.
 *
 * WHY DERIVED, NOT PASSED IN. Every path in the map is a function of the
 * session id, the request id and the REQUEST TYPE, all of which the producer
 * already has. Asking the caller to supply the map would put a second source
 * next to the derivation, and a CLI flag (`--gate-evidence <json>`) would
 * additionally require the user to hand-author JSON, which the project's
 * Human-NL-Choice-Only rule forbids. So: one function, computed, no flag.
 *
 * THE TYPE-AWARE TENSION, AND HOW IT IS RESOLVED. The schema doc
 * (`skills/bee/peaks-rd/references/writing-handoff-frontmatter.md:53`) calls
 * the five keys a schema and says "Missing keys → Gate C failure". Taken
 * literally that demands all five paths in every capsule — and then a `docs`
 * slice, which Gate C requires NO evidence from, would fail the gate for
 * "declaring" `audit/perf-<rid>.md` and `audit/security-<rid>.md`, two files
 * its type is not supposed to produce. Declaring evidence that does not and
 * should not exist is a false claim, and a gate that fails on a false claim
 * the writer invented is worse than useless.
 *
 * Resolution, and the reason it is not a special case: the map declares
 * EXACTLY what this request type's transition gate requires, read from
 * `PREREQUISITES_BY_TYPE` — the same table `checkPrerequisites` enforces at
 * `rd:qa-handoff`. So:
 *
 *   - feature / refactor → projectScan, prdHandoff, codeReview,
 *     securityReview, perfBaseline (all five)
 *   - bugfix             → the same five
 *   - config             → projectScan, securityReview (TWO keys, verified
 *     against the table rather than assumed — `CONFIG_TABLE['rd:qa-handoff']`
 *     is `[SECURITY_REVIEW]` alone, so there is no `prdHandoff`: config has no
 *     `AUDIT_REQUIRES_HANDOFF` row. An earlier revision of this comment
 *     claimed three, and QA caught prose that disagreed with the code, which
 *     is the defect this module exists to end. The security path declared is
 *     the config-specific `rd/security-review.md` — genuinely ridless, per its
 *     own row — not the documented `audit/security-<rid>.md`, which no config
 *     slice writes)
 *   - docs / chore       → NOTHING. No `rd:qa-handoff` row ⇒ nothing for Gate C
 *     to validate ⇒ nothing declared (see below)
 *
 * WHY `projectScan` IS DECLARED, AND WHY ONLY FOR GATED TYPES. It is not read
 * from the table — it is Gate A's artifact, and Gate A is type-independent
 * ("After workspace init + project scan", step 0.6 of every workflow). But a
 * declaration is only worth making when something VERIFIES it, and the only
 * verifier is `checkDeclaredGateEvidence`, which runs on `rd:qa-handoff`. For a
 * type with a gate row, Gate C therefore does check this path like any other.
 * For `docs`/`chore` nothing ever reads it, so it is not declared: keeping an
 * inert statement in every docs capsule would recreate, in miniature, the exact
 * defect this whole line of work exists to remove — a claim no one reads, which
 * is how the field was dead in the first place (F1 of `rid-b2-qa`). Scope, in
 * one sentence: **this map declares the evidence paths Gate C will check for
 * this slice**, so an empty declaration is the honest one when there is no such
 * gate.
 *
 * THE REJECTED ALTERNATIVE, named so it is not silently revisited: declaring
 * all five unconditionally and teaching Gate C to check only the
 * type-required subset. Rejected because the capsule would then carry
 * permanent false statements about files that must never exist, and every
 * reader of the frontmatter (peaks-qa's own checklist among them) would need
 * the same type-conditioned filter to avoid mis-reading them.
 *
 * NO DERIVATION → NO DECLARATION. When there is no request artifact to read
 * the type off, this returns `undefined` and the producers write no
 * `gateEvidence` block at all. Never a partial map: a half-derived declaration
 * is a false statement about the missing half's keys, and the pre-B2 bytes are
 * the honest fallback. An id the artifact service REFUSES is not this case and
 * is not reported as `undefined` — see `deriveGateEvidenceForRequest`.
 */

import { join } from 'node:path';
import { pathExists } from 'peaks-loop-shared/fs';

import { getPrerequisitesFor, type RequestType } from '../artifacts/artifact-prerequisites.js';
import { showRequestArtifact } from '../artifacts/request-artifact-service.js';
import { readHandoffGateEvidence } from './handoff-gate-evidence.js';
import { resolveHandoffPath } from './handoff-service.js';
import { GATE_EVIDENCE_KEYS, type GateEvidence, type GateEvidenceKey } from './handoff-types.js';
import { PROJECT_SCAN_RELATIVE } from './project-scan-reader.js';

/**
 * Map ONE prerequisite of the `rd:qa-handoff` table onto the five-key
 * vocabulary. The PATHS come from the table (single source); this function
 * only names which key each required artifact answers to, so a change to a
 * prerequisite's path moves the declared path with it.
 *
 * `mut/mut-report.json`, `rd/karpathy-review-<rid>.md`,
 * `rd/third-party-review.md`, `qa/test-cases/<rid>.md` and the unit-test
 * marker have no key — the vocabulary is five keys, and those artifacts are
 * already enforced by the table itself, so they are deliberately not
 * declared here rather than being forced into a key that does not mean them.
 */
function gateKeyOfPrerequisitePath(relativePath: string): GateEvidenceKey | null {
  if (relativePath.startsWith('prd/handoff')) return 'prdHandoff';
  if (relativePath.startsWith('rd/code-review')) return 'codeReview';
  if (relativePath.startsWith('audit/security') || relativePath.startsWith('rd/security-review')) {
    return 'securityReview';
  }
  if (relativePath.startsWith('audit/perf')) return 'perfBaseline';
  return null;
}

/**
 * The `gateEvidence` map for a slice of `requestType` — the evidence paths
 * Gate C will check for it. Pure: no disk access, so a caller can compute it
 * without side effects. Empty (`{}`) — never a partial map — when the type has
 * no `rd:qa-handoff` row, because then there is no gate to declare anything to.
 */
export function deriveGateEvidence(opts: {
  readonly sessionId: string;
  readonly requestId: string;
  readonly requestType: RequestType;
}): GateEvidence {
  const requirements = getPrerequisitesFor('rd', 'qa-handoff', opts.requestType);
  // docs / chore land here: `MINIMAL_TABLE` has no row at that transition, so
  // nothing is required and nothing is declared. An empty map renders no block
  // at all (`handoff-frontmatter.ts`), so such a capsule is byte-identical to a
  // pre-B2 one and carries no statement that nothing verifies.
  if (requirements.length === 0) return {};
  const sessionRoot = join('.peaks', '_runtime', opts.sessionId);
  const evidence: Partial<Record<GateEvidenceKey, string>> = {
    projectScan: PROJECT_SCAN_RELATIVE
  };
  for (const prerequisite of requirements) {
    const key = gateKeyOfPrerequisitePath(prerequisite.relativePath);
    if (key === null) continue;
    // `<rid>` is the table's own placeholder, resolved the way the table's
    // resolver resolves it, so the declaration names the file the gate looks
    // for.
    evidence[key] = join(sessionRoot, prerequisite.relativePath.replace('<rid>', opts.requestId));
  }
  return evidence;
}

/**
 * Derive for a request by reading its PRD artifact — the only place the
 * request TYPE is recorded (`- type: <t>`, written by `peaks request init`
 * and read back by `request-artifact-service.extractMetadata`).
 *
 * Returns `undefined` when there is NO artifact to read — the one case the
 * producers turn into "write no block" (see the header). That is now the ONLY
 * `undefined`: a `showRequestArtifact` that THROWS is deliberately not caught,
 * so a caller can tell "this slice has nothing to declare" apart from "the
 * artifact could not be read".
 *
 * F4 (`rid-f4-ceiling-breach`). This used to be `catch { return undefined }`,
 * which folded those two into one value — and the repository's own ratchet
 * caught it (`capability-guard-runner/contracts/J03.ts`, rule
 * `catch-return-null`; the ceiling was written for exactly this shape). Nothing
 * is lost by letting the throw through. The refusals `showRequestArtifact` can
 * raise are the rid/sid ones, and BOTH callers reach a byte-identical message
 * on the next statement anyway — `assertSafeHandoffIds` (`handoff-service.ts`)
 * for `prd handoff init`, `generateEvidence`'s own guard for the evidence
 * generator — so the user-visible failure is unchanged; only its origin moves
 * two lines earlier. What the catch DID cover in practice was an I/O failure
 * while reading the artifact file, and swallowing that writes a capsule with no
 * declaration at all, which Gate C reads as "nothing declared, nothing to
 * check" (`field-absent` is not this check's business, below). A silent hole is
 * worse than a loud, already-duplicated one.
 */
export async function deriveGateEvidenceForRequest(opts: {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly requestId: string;
}): Promise<GateEvidence | undefined> {
  // F4 (`rid-f4-ceiling-breach`). The throw from `showRequestArtifact` is
  // propagated, so a caller can tell "this slice has nothing to declare"
  // (artifact missing → `artifact === null` → `requestType === null` →
  // `undefined`) apart from "the artifact could not be read" (an id the
  // service refuses → rejected with `Invalid request id: ...`). The old
  // `catch { return undefined }` collapsed both into the same value, and the
  // `catch-return-null` ratchet caught it. The refusals `showRequestArtifact`
  // raises are the rid / sid ones, and both callers reach a byte-identical
  // guard a few lines up — `assertSafeHandoffIds` for `prd handoff init`,
  // `generateEvidence`'s own guard for the evidence generator — so the
  // user-visible failure is unchanged; only its origin moves earlier.
  const artifact = await showRequestArtifact({
    projectRoot: opts.projectRoot,
    role: 'prd',
    requestId: opts.requestId,
    sessionId: opts.sessionId
  });
  const requestType: RequestType | null = artifact?.requestType ?? null;
  if (requestType === null) return undefined;
  return deriveGateEvidence({
    sessionId: opts.sessionId,
    requestId: opts.requestId,
    requestType
  });
}

/** `missing` / `warnings` in the same shape `checkPrerequisites` reports. */
export interface GateEvidenceDeclarationCheck {
  readonly ok: boolean;
  readonly missing: ReadonlyArray<{ path: string; description: string }>;
  readonly warnings: ReadonlyArray<{ path: string; code: string; message: string }>;
}

/**
 * GATE C — is the capsule's OWN declaration true?
 *
 * The division of labour, stated so the two checks cannot drift: the
 * prerequisite table says which artifacts this type MUST produce (it owns the
 * requirement and its file existence); this function says the capsule must
 * not CLAIM evidence it does not have (it owns the declaration). Neither
 * re-implements the other, and both read their paths from wherever the path
 * really comes from.
 *
 * A missing declared path FAILS and names the key, because a declaration the
 * gate cannot verify is exactly the "prose pretending to be data" state this
 * field was created to end. Outcomes that are not failures, each for its own
 * reason:
 *   - no capsule → not this check's business (`AUDIT_REQUIRES_HANDOFF` owns it)
 *   - `field-absent` → the capsule declares nothing; every pre-B1 capsule,
 *     and every slice whose producer could not derive a type
 *   - an unknown key → a WARNING: the five-key vocabulary is a typo trap, and
 *     the type's real requirement is still enforced by the table, so this
 *     informs without blocking
 */
export async function checkDeclaredGateEvidence(opts: {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly requestId: string;
}): Promise<GateEvidenceDeclarationCheck> {
  const capsule = resolveHandoffPath({
    projectRoot: opts.projectRoot,
    sessionId: opts.sessionId,
    requestId: opts.requestId
  });
  if (capsule === null) return { ok: true, missing: [], warnings: [] };

  const declared = await readHandoffGateEvidence(capsule);
  if (declared.status === 'field-absent' || declared.status === 'file-missing') {
    return { ok: true, missing: [], warnings: [] };
  }
  // A capsule with NO frontmatter block cannot declare anything, and
  // `AUDIT_REQUIRES_HANDOFF` — the prereq that owns capsule validity — accepts
  // that shape on a substring check (`schemaVersion: 2` + `sha256:` appearing
  // anywhere). Failing it here would make Gate C refuse capsules the gate next
  // to it accepts, breaking the "the checker and `request transition` agree"
  // property that `pipeline-verify-contract-drift.test.ts` pins. So the line is
  // drawn at the fence, not at readability: no fence ⇒ nothing declared;
  // a fence whose YAML will not parse ⇒ a declaration that may be inside and
  // unreadable, and THAT fails below.
  if (declared.status === 'frontmatter-malformed' && declared.reason === 'no-frontmatter-fence') {
    return { ok: true, missing: [], warnings: [] };
  }
  if (declared.status !== 'ok') {
    return {
      ok: false,
      missing: [
        {
          path: `gateEvidence(${declared.status})`,
          description:
            `the handoff's gateEvidence declaration is unusable (${declared.status}) — ` +
            'a declaration that cannot be read is not the same as no declaration'
        }
      ],
      warnings: []
    };
  }

  const missing: Array<{ path: string; description: string }> = [];
  for (const key of GATE_EVIDENCE_KEYS) {
    const declaredPath = declared.evidence[key];
    if (declaredPath === undefined) continue;
    if (await pathExists(join(opts.projectRoot, declaredPath))) continue;
    missing.push({
      path: `gateEvidence.${key}`,
      description: `gateEvidence.${key} declares "${declaredPath}", which does not exist`
    });
  }
  const warnings = declared.unknownKeys.map((key) => ({
    path: `gateEvidence.${key}`,
    code: 'gate-evidence-unknown-key',
    message:
      `gateEvidence declares "${key}", which is not one of the five keys ` +
      `(${GATE_EVIDENCE_KEYS.join(', ')}) — a misspelled key is why a required gate ` +
      'can read as undeclared'
  }));
  return { ok: missing.length === 0, missing, warnings };
}
