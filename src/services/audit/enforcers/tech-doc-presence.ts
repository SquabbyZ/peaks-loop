/**
 * tech-doc-presence enforcer — refuses `peaks request transition <rid>
 * spec-locked` if the slice's tech-doc.md is missing.
 *
 * Per L2 redesign §5.4. The tech-doc is the BLOCKING artifact for the
 * spec-locked transition. This enforcer is called from
 * `request-transition-service.ts` BEFORE the state machine runs.
 *
 * The session id is resolved from the current working directory using
 * the canonical workspace resolver (per
 * `src-services-session-canonical-workspace-resolver.md` memory).
 */

import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface TechDocPresenceInput {
  readonly projectRoot: string;
  readonly sessionId: string;
}

export interface TechDocPresenceResult {
  readonly exists: boolean;
  readonly path: string;
  readonly isEmpty: boolean;
}

export function checkTechDocPresence(input: TechDocPresenceInput): TechDocPresenceResult {
  const docPath = join(input.projectRoot, '.peaks/_runtime', input.sessionId, 'rd/tech-doc.md');
  if (!existsSync(docPath)) {
    return { exists: false, path: docPath, isEmpty: false };
  }
  let stat;
  try {
    stat = statSync(docPath);
  } catch {
    return { exists: false, path: docPath, isEmpty: false };
  }
  return { exists: true, path: docPath, isEmpty: stat.size === 0 };
}

/**
 * Hard-coded error message used by `request-transition-service.ts` when
 * the spec-locked transition is refused.
 */
export const TECH_DOC_MISSING_MESSAGE =
  'spec-locked transition requires `rd/tech-doc.md` to exist and be non-empty. ' +
  'Run `peaks-rd` to produce the tech-doc first, then retry the transition.';

export const TECH_DOC_MISSING_CODE = 'TECH_DOC_MISSING';
