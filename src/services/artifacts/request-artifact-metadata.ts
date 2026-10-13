import { DEFAULT_REQUEST_TYPE, isRequestType, type RequestType } from './artifact-prerequisites.js';
import { readArtifactState } from './request-artifact-state-helpers.js';

/**
 * Where a request artifact's effective type came from.
 *
 * `default` means the body carried no usable `- type:` line, so
 * `DEFAULT_REQUEST_TYPE` was substituted. Nothing else in the repository tells
 * that apart from a deliberate `- type: feature`, and the substitution has a
 * price: measured 2026-10-13 through `getPrerequisitesFor`, the `feature` row at
 * `rd:qa-handoff` demands 9 artifacts, `bugfix` 10, `docs` and `chore` none. The
 * locked PRD handoff for this slice states 10 for `feature`; 9 is what the
 * function returns.
 *
 * `peaks request init` writes a type line only when `--type` was passed, so the
 * absence of the line survives creation instead of being stamped over with the
 * default at the moment the distinction is first knowable.
 */
export type RequestTypeSource = 'declared' | 'default';

export type ArtifactMetadata = {
  state: string;
  requestType: RequestType;
  requestTypeSource: RequestTypeSource;
  createdAt?: string;
  sessionId?: string;
};

/**
 * Read the fields of a request artifact body. Moved verbatim out of
 * `request-artifact-service.ts` when the type's provenance was added; the only
 * behaviour change is `requestTypeSource`, which records whether a usable
 * `- type:` line was actually present.
 */
export function extractMetadata(markdown: string): ArtifactMetadata {
  const state = readArtifactState(markdown) ?? 'unknown';
  let createdAt: string | undefined;
  let requestType: RequestType = DEFAULT_REQUEST_TYPE;
  let requestTypeSource: RequestTypeSource = 'default';
  let sessionId: string | undefined;
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    const createdMatch = /^-\s*created:\s*(.+?)\s*$/.exec(line);
    if (createdMatch !== null && createdMatch[1] !== undefined) {
      createdAt = createdMatch[1];
      continue;
    }
    const typeMatch = /^-\s*type:\s*(.+?)\s*$/.exec(line);
    if (typeMatch !== null && typeMatch[1] !== undefined) {
      const candidate = typeMatch[1];
      if (isRequestType(candidate)) {
        requestType = candidate;
        requestTypeSource = 'declared';
      }
      // Placeholder values (e.g. "feature | bug | refactor | clarification") fall back to default.
      continue;
    }
    const sessionMatch = /^-\s*session:\s*(.+?)\s*$/.exec(line);
    if (sessionMatch !== null && sessionMatch[1] !== undefined) {
      sessionId = sessionMatch[1];
      continue;
    }
  }
  const base: ArtifactMetadata = { state, requestType, requestTypeSource };
  if (createdAt !== undefined) base.createdAt = createdAt;
  if (sessionId !== undefined) base.sessionId = sessionId;
  return base;
}
