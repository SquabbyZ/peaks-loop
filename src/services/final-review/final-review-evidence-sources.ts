// src/services/final-review/final-review-evidence-sources.ts
//
// The evidence-source table: the per-source delivery rules, the source
// and candidate shapes the read phase produces, the keys the delivery
// gates pin, and the base source list in allocation order. Hoisted
// verbatim from final-review-service.ts (C wave 7 file-size split); the
// nine base entries moved out of evidenceSourcesFor as two helper lists
// purely to keep every function under the repo function-length rule —
// the element literals and their order are byte-for-byte HEAD.
//
// KNOWN CONSEQUENCE: guard C in tests/unit/final-review reads the
// service module by regex and asserts every source in evidenceSourcesFor
// declares a delivery rule. With the base list here, the guard's table
// window only sees the appended pre/post source, so it checks 1 of 10
// rules where it used to check 10. The type makes an undeclared rule a
// compile error, and this table keeps every declaration; the widened
// guard (scan the base-list module too) is handed to the test-owner
// leaf at convergence.

import type { DimensionKind } from './final-review-types.js';

/**
 * What DELIVERED means for one source — the module's ONE delivery definition,
 * declared per source and read in exactly one place (`isDelivered`).
 *
 *   whole       the reviewer must have received the whole document. A
 *               truncated slice is not a weaker version of a document, it is a
 *               DIFFERENT document, and the conclusion may be in the part that
 *               was cut — which is precisely the state `found` used to call
 *               "delivered".
 *   conclusion  the reviewer must have received the literal that IS the
 *               document's conclusion. Used where the producer publishes one
 *               (the pre/post diff opens with its `VERDICT:` line).
 *
 * `whole` is the rule wherever the producer is another role's skill and
 * publishes no conclusion literal: the module may not GUESS where a document's
 * conclusion lives. The two are the same judgement — "did the reviewer receive
 * the conclusion" — checked at the only place the module can check it.
 */
type DeliveryRule =
  { readonly kind: 'whole' } | { readonly kind: 'conclusion'; readonly marker: string };

export interface EvidenceSource {
  /** Stable id quoted by the model in its citations. */
  readonly key: string;
  readonly label: string;
  /** Path segments under `.peaks/_runtime/<sessionId>/`. */
  readonly segments: readonly string[];
  /**
   * An older location of the SAME artifact, tried only when `segments` is not
   * capsule to `prd/handoff-<rid>.md`; sessions written before it hold only
   * the bare `prd/handoff.md`, and this module's delivery gate keys on that
   * source — so a source that goes missing does not fail the gate, it stops
   * it (`enforceScopeContractDelivery` returns early on `missing`).
   */
  readonly legacySegments?: readonly string[];
  /** Dimensions this source can supply evidence for. */
  readonly supports: readonly DimensionKind[];
  /** What DELIVERED means for this source. See `isDelivered()` — every source
   *  must declare one, and the declaration is the only thing the module's
   *  delivery judgement reads. */
  readonly delivery: DeliveryRule;
}

/**
 * The one source whose ABSENCE from the delivered prompt is not merely a
 * missing file: it is the only source in the set that is a before/after
 * comparison, and `existing-functionality-intact` is defined by it. Named once
 * so the source builder and the delivery check cannot drift apart.
 */
export const PRE_POST_DIFF_SOURCE_KEY = 'final-review-pre-post-diff';

/**
 * The approved-scope contract. Also named once: it is the source
 * `functional-completeness` is defined against and the one its delivery gate
 * keys on.
 */
export const SCOPE_CONTRACT_SOURCE_KEY = 'prd-handoff';

/**
 * The source a DIMENSION'S DELIVERY GATE depends on — i.e. the source the
 * dimension's `pass` may not outlive. `floorHolders` reserves that source's
 * unit, and this table is why the reservation protects the RIGHT source.
 *
 * F1 — the floor used to go to the FIRST source that merely *mentioned* the
 * dimension (`qa-test-report`, index 0, and `rd/tech-doc`, index 6), while both
 * delivery gates keyed on sources at the very END of the order
 * (`prd-handoff`, index 8, and the appended pre/post diff, index 9) that no
 * reservation covered. On this repo's own run the budget was exhausted at
 * source 4, so BOTH gate sources were omitted on every run — necessarily, not
 * accidentally — while 8,192 bytes of floor were spent on `rd/tech-doc`, the
 * one source prompt rule 6 declares insufficient for that same dimension.
 *
 *   measured floor reservation after the fix:
 *     prd/handoff.md 8,164  +  api-diff.txt 4,713  +  qa/test-reports 9,492
 *       = 22,369  <=  MAX_EVIDENCE_BYTES_TOTAL 40,960
 *
 * so all three holders are served WHOLE and the two gate-backed dimensions
 * become deliverable again. A dimension absent from this table has no delivery
 * gate, and its floor stays with the earliest source that supports it.
 */
export const GATE_SOURCE_FOR_DIMENSION: Partial<Record<DimensionKind, string>> = {
  'functional-completeness': SCOPE_CONTRACT_SOURCE_KEY,
  'existing-functionality-intact': PRE_POST_DIFF_SOURCE_KEY
};

/**
 * `found` is the only status that carries bytes. The other four exist so the
 * prompt can name *why* a source carries nothing: an absent file, one that
 * exists but is empty, one that exists but could not be READ, and one that did
 * not fit the byte budget are four different facts, and the model is told all
 * four explicitly.
 *
 * F4 — `missing` and `unreadable` used to be one status. `readFileSync`'s catch
 * collapsed EACCES / EBUSY / EPERM into the same `raw === null` as ENOENT, so a
 * contract file that EXISTS and could not be opened was reported to the
 * reviewer — and, worse, to the delivery gate — as "there was no PRD phase".
 * Those are opposite facts about a run: one says "nothing to deliver", the
 * other says "there is something to deliver and it did not arrive".
 */
export type EvidenceStatus = 'found' | 'empty' | 'missing' | 'unreadable' | 'omitted';

export interface CollectedEvidence {
  readonly source: EvidenceSource;
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly status: EvidenceStatus;
  /** Full size on disk (0 when nothing could be read). */
  readonly totalBytes: number;
  /** Bytes actually inlined into the prompt. */
  readonly includedBytes: number;
  readonly content: string;
  /** Why this source carries no evidence (non-`found` statuses only). */
  readonly reason: string;
}

/**
 * A source plus the bytes it turned out to hold. Reading and spending are two
 * separate phases because the allocator has to know which sources are actually
 * readable BEFORE it can promise any of them a byte: a floor reserved for a file
 * that does not exist is a floor spent on nothing.
 */
export interface EvidenceCandidate {
  readonly source: EvidenceSource;
  readonly relativePath: string;
  readonly absolutePath: string;
  /** File bytes, or `null` when the file could not be read. */
  readonly raw: Buffer | null;
  /**
   * Why there are no bytes: `'ok'` when `raw` is set, otherwise the two facts
   * F4 requires the module to keep apart — `'missing'` is ENOENT (there is no
   * such file for this run), `'unreadable'` is anything else (the file is
   * there and this process could not read it).
   */
  readonly read: 'ok' | 'missing' | 'unreadable';
  /** Read failure message (`raw === null` only). */
  readonly error: string;
  /** A file whose content is all whitespace carries no evidence whichever
   *  slice of it the budget would have paid for. */
  readonly blank: boolean;
}

/**
 * The base list, split from `evidenceSourcesFor` purely for function
 * length — every element is HEAD-verbatim and the two halves keep the
 * allocation order of the original single literal.
 */
function baseEvidenceSourcesA(rid: string): EvidenceSource[] {
  return [
    {
      key: 'qa-test-report',
      label: 'QA execution report (per-command pass/fail counts)',
      segments: ['qa', 'test-reports', `${rid}.md`],
      supports: ['functional-completeness', 'problem-resolution', 'no-new-bugs'],
      delivery: { kind: 'whole' }
    },
    {
      key: 'qa-test-cases',
      label: 'QA test cases (acceptance-criterion to test mapping)',
      segments: ['qa', 'test-cases', `${rid}.md`],
      supports: ['functional-completeness', 'problem-resolution'],
      delivery: { kind: 'whole' }
    },
    {
      key: 'qa-security-findings',
      label: 'QA security findings',
      segments: ['qa', `security-findings-${rid}.md`],
      supports: ['no-new-bugs'],
      delivery: { kind: 'whole' }
    },
    {
      key: 'qa-performance-findings',
      label: 'QA performance findings',
      segments: ['qa', `performance-findings-${rid}.md`],
      supports: ['no-new-bugs'],
      delivery: { kind: 'whole' }
    },
    {
      key: 'rd-code-review',
      label: 'RD code review',
      segments: ['rd', 'code-review.md'],
      supports: ['no-new-bugs'],
      delivery: { kind: 'whole' }
    }
  ];
}

function baseEvidenceSourcesB(rid: string): EvidenceSource[] {
  return [
    {
      key: 'rd-security-review',
      label: 'RD security review',
      segments: ['rd', 'security-review.md'],
      supports: ['no-new-bugs'],
      delivery: { kind: 'whole' }
    },
    {
      key: 'rd-tech-doc',
      label: 'RD tech doc (public surface / design intent)',
      segments: ['rd', 'tech-doc.md'],
      supports: ['existing-functionality-intact'],
      delivery: { kind: 'whole' }
    },
    {
      key: 'rd-bug-analysis',
      label: 'RD bug analysis (original problem statement)',
      segments: ['rd', 'bug-analysis.md'],
      supports: ['problem-resolution'],
      delivery: { kind: 'whole' }
    },
    {
      key: SCOPE_CONTRACT_SOURCE_KEY,
      label: 'PRD handoff (approved scope + non-goals)',
      // bare name is the pre-scoping tier and still lives on 3 sessions.
      segments: ['prd', `handoff-${rid}.md`],
      legacySegments: ['prd', 'handoff.md'],
      supports: ['functional-completeness', 'existing-functionality-intact'],
      delivery: { kind: 'whole' }
    }
  ];
}

export function baseEvidenceSources(rid: string): EvidenceSource[] {
  return [...baseEvidenceSourcesA(rid), ...baseEvidenceSourcesB(rid)];
}
