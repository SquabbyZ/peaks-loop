/**
 * Support constants + option schemas + hint renderers extracted verbatim from
 * `slice-review-commands.ts` (file-size cap campaign). Mechanical move only:
 * the four command descriptions, the score/reject action option schemas, and
 * the pending/rejected checklist hint texts.
 */

export const SLICE_REVIEW_DESCRIPTION =
  'Show the 4-5 business review items for a slice (template; user scores 1-5). ' +
  'If no review exists for the slice, a new one is created (pending state). ' +
  'The 12 Gaps positioning memory: user reviews BUSINESS / PRODUCT, not technical.';

export const SLICE_SCORE_DESCRIPTION =
  'Record a single item score (1-5). 1 = P0 fail, 2-3 = needs work, 4-5 = OK. ' +
  'The 12 Gaps threshold: avg >= 3 AND no item <= 2 → accepted; otherwise rejected.';

export const SLICE_ACCEPT_DESCRIPTION =
  'Mark the slice as accepted (user-approved). All 4-5 items must be ' +
  'scored; the derived decision must be "accepted" (avg >= 3 AND ' +
  'no item <= 2). Otherwise the accept is rejected by the gate.';

export const SLICE_REJECT_DESCRIPTION =
  'Mark the slice as rejected with a reason. The slice goes back to ' +
  'peaks-rd repair-loop. The reason is persisted for the audit trail.';

export interface SliceScoreOpts {
  item: string;
  score: string;
  note?: string;
  sessionId?: string;
  project?: string;
  json?: boolean;
}

export interface SliceRejectOpts {
  reason: string;
  sessionId?: string;
  project?: string;
  json?: boolean;
}

export const PENDING_SCORE_HINTS = [
  `Score each item with: peaks slice score <slice-id> --item <id> --score <1-5>`,
  `When all items are scored, run: peaks slice accept <slice-id>`
];

export function renderRejectionNotes(rejectionReason?: string): string[] {
  return [
    `Rejected: ${rejectionReason ?? '(no reason)'}`,
    'Address the issue, then re-score and accept.'
  ];
}
