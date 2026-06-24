/**
 * design-draft-confirm enforcer (L2.2 P1) — verifies a design draft exists
 * and has been confirmed before the rd implementation phase begins.
 *
 * Two red lines:
 *   - rl-design-draft-confirm-001: design-draft.md must exist before spec-locked
 *   - rl-design-draft-confirm-002: design-draft must have a 'confirmed' marker
 *
 * The state-machine check is wired into peaks request transition (the
 * spec-locked transition requires both files to exist + design to be
 * confirmed). The catalog flags the entry as cli-backed when the
 * enforcer file exists.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const CONFIRMATION_MARKERS: readonly RegExp[] = [
  /\bconfirmed\b\s*[:=]\s*true/i,
  /\bstatus:\s*confirmed-by-user/i,
  /^#\s*confirmed\b/im,
];

export interface DesignDraftConfirmInput {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly changeId: string;
}

export interface DesignDraftConfirmResult {
  readonly draftExists: boolean;
  readonly draftPath: string;
  readonly confirmed: boolean;
  readonly confirmationPath: string;
}

export function checkDesignDraftConfirmation(input: DesignDraftConfirmInput): DesignDraftConfirmResult {
  // Back-compat read: 2.8.0-era `peaks workspace init` wrote design drafts
  // at `.peaks/_runtime/<changeId>/ui/design-draft.md`. The 2.8.3+ canonical path
  // is `.peaks/_runtime/change/<changeId>/ui/design-draft.md`, but the
  // audit gate must continue to read the legacy sibling dir if it exists.
  // Design drafts live at .peaks/_runtime/<changeId>/ui/design-draft.md (UI role) or
  // .peaks/_runtime/<changeId>/prd/requests/<rid>.md (PRD). For L2.2 the canonical
  // location is the UI design-draft.
  const draftPath = join(input.projectRoot, '.peaks', input.changeId, 'ui/design-draft.md');
  const draftExists = existsSync(draftPath);
  if (!draftExists) {
    return {
      draftExists: false,
      draftPath,
      confirmed: false,
      confirmationPath: '',
    };
  }

  let content: string;
  try {
    content = readFileSync(draftPath, 'utf8');
  } catch {
    return {
      draftExists: true,
      draftPath,
      confirmed: false,
      confirmationPath: draftPath,
    };
  }

  const confirmed = CONFIRMATION_MARKERS.some((p) => p.test(content));
  return {
    draftExists: true,
    draftPath,
    confirmed,
    confirmationPath: draftPath,
  };
}
