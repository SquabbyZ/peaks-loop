// tests/unit/prd/_handoff-gate-evidence-fixtures.ts
//
// Shared module-level fixtures for the two handoff-gate-evidence suites
// (`handoff-gate-evidence.test.ts` and `handoff-gate-evidence-render.test.ts`).
// Hoisted VERBATIM from the original single file so a split does not fork the
// constants; the render dimension moved to its own sibling to clear the 500-line
// raw cap. This is a helper module (leading underscore, NOT `*.test.ts`), so the
// root vitest config (`tests/unit/**/*.test.ts`) never collects it on its own.

import { type GateEvidence } from '../../../src/services/prd/handoff-types.js';

export const SESSION_ID = '2026-09-17-session-b1';
export const REQUEST_ID = 'rid-b1-gate-evidence-producer';
export const BODY = '# Body\n\nAcceptance checks:\n- B1: the reader reports the map.\n';

/** All five keys, the shape the schema doc renders. */
export const ALL_FIVE: GateEvidence = {
  projectScan: '.peaks/project-scan/project-scan.md',
  prdHandoff: `.peaks/_runtime/${SESSION_ID}/prd/handoff-${REQUEST_ID}.md`,
  codeReview: `.peaks/_runtime/${SESSION_ID}/rd/code-review-${REQUEST_ID}.md`,
  securityReview: `.peaks/_runtime/${SESSION_ID}/audit/security-${REQUEST_ID}.md`,
  perfBaseline: `.peaks/_runtime/${SESSION_ID}/audit/perf-${REQUEST_ID}.md`
};
