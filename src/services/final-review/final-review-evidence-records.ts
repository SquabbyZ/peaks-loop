// src/services/final-review/final-review-evidence-records.ts
//
// The `CollectedEvidence` record builders — one per way a source can turn out:
// read failure (missing vs unreadable), blank, omitted, and found (whole or as
// an over-cap EXCERPT). Hoisted out of final-review-evidence-collect.ts, which
// the slice of 2026-10-13 left at 298 of its 300-line cap; the bodies are
// byte-for-byte what that module held. The allocator and the read phase stay
// there, so the one-directional edge is collect → records.

import type {
  CollectedEvidence,
  EvidenceCandidate,
  EvidenceSource,
  EvidenceStatus
} from './final-review-evidence-sources.js';
import { MAX_EVIDENCE_BYTES_TOTAL } from './final-review-evidence-budget.js';
import type { DimensionKind } from './final-review-types.js';

export interface EvidenceBase {
  readonly source: EvidenceSource;
  readonly relativePath: string;
  readonly absolutePath: string;
}

export function readFailureEvidence(
  base: EvidenceBase,
  candidate: EvidenceCandidate
): CollectedEvidence {
  // `read` is never `'ok'` here (it is set exactly when the read failed),
  // and `'ok'` is not a status — the branch is what says which of the two
  // failure facts this is.
  const status: EvidenceStatus = candidate.read === 'unreadable' ? 'unreadable' : 'missing';
  return {
    ...base,
    status,
    totalBytes: 0,
    includedBytes: 0,
    excerpt: false,
    content: '',
    reason:
      candidate.read === 'missing'
        ? candidate.error
        : `the file exists but could not be read (${candidate.error})`
  };
}

export function blankEvidence(base: EvidenceBase, raw: Buffer): CollectedEvidence {
  return {
    ...base,
    status: 'empty',
    totalBytes: raw.byteLength,
    includedBytes: 0,
    excerpt: false,
    content: '',
    reason: `file exists but contains no reviewable content (${raw.byteLength} bytes)`
  };
}

export interface OmissionContext {
  readonly budgetLeft: number;
  readonly allowance: number;
  readonly holders: ReadonlyMap<number, DimensionKind>;
  readonly pending: Set<number>;
  readonly reservedElsewhere: number;
  readonly unit: number;
  readonly candidates: readonly EvidenceCandidate[];
  readonly index: number;
}

export function omittedEvidence(
  base: EvidenceBase,
  raw: Buffer,
  ctx: OmissionContext
): CollectedEvidence {
  const { allowance, budgetLeft, candidates, holders, pending, reservedElsewhere, unit, index } =
    ctx;
  const waiting = [...pending]
    .filter((holder) => holder !== index)
    .map((holder) => `${holders.get(holder)} (source ${candidates[holder]?.source.key ?? '?'})`);
  return {
    ...base,
    status: 'omitted',
    totalBytes: raw.byteLength,
    includedBytes: 0,
    excerpt: false,
    content: '',
    reason:
      reservedElsewhere > 0
        ? `${reservedElsewhere} bytes of the budget are reserved for dimension(s) ${waiting.join(', ')} — their only remaining evidence comes later in the source order; this source is inlined WHOLE or not at all and needs ${unit} bytes, while ${budgetLeft} were left (${allowance} after the reservation)`
        : `total evidence budget (${MAX_EVIDENCE_BYTES_TOTAL} bytes) is exhausted — this source is inlined WHOLE or not at all and needs ${unit} bytes, ${budgetLeft} were left`
  };
}

export function foundEvidence(
  base: EvidenceBase,
  raw: Buffer,
  unit: number,
  content: string
): CollectedEvidence {
  return {
    ...base,
    status: 'found',
    totalBytes: raw.byteLength,
    includedBytes: unit,
    // `unit` is `sourceUnit(candidate)` = `min(file bytes, cap)`, so this is
    // exactly "the FILE is bigger than the cap" — never a budget-cut fragment.
    excerpt: unit < raw.byteLength,
    content,
    reason: ''
  };
}
