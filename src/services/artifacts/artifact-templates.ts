import type { RequestType } from './artifact-prerequisites.js';
import {
  PRD_TEMPLATE_BODY,
  UI_TEMPLATE_BODY,
  RD_TEMPLATE_BODY,
  QA_TEMPLATE_BODY,
  SC_TEMPLATE_BODY
} from './artifact-template-bodies.js';

/**
 * Role discriminator for the five request-artifact templates. Lives here
 * (rather than in `request-artifact-service.ts`) so this pure-function
 * module has no dependency on the service. The service re-exports it for
 * back-compat with external callers.
 */
export type RequestArtifactRole = 'prd' | 'ui' | 'rd' | 'qa' | 'sc';

/**
 * Handoff path helpers.
 *
 * Slice 2026-06-29-change-id-root-removal: all handoff paths now key
 * on the session-id axis (`.peaks/_runtime/<sessionId>/<role>/...`)
 * instead of the deleted change-id axis
 * (`.peaks/_runtime/change/<sessionId>/<role>/...`). The session
 * dir is gitignored; the hard ban on `.peaks/_runtime/<id>/`
 * siblings remains in force.
 *
 * The render functions below emit markdown bodies that quote these
 * paths verbatim as write instructions — if the body contains a
 * banned top-level path, the sub-agent prompt will recreate the
 * forbidden dir on its next write.
 */

/** Canonical handoff path for a downstream role's request artifact. */
export function formatHandoffPath(sessionId: string, role: string, requestId: string): string {
  return `.peaks/_runtime/${sessionId}/${role}/requests/${requestId}.md`;
}

/** Canonical path for the SC commit-boundary handoff artifact. */
export function formatCommitBoundaryPath(sessionId: string, requestId: string): string {
  return `.peaks/_runtime/${sessionId}/sc/commit-boundaries/${requestId}.md`;
}

/** Canonical path for the txt skill-usage lessons log under a session scope. */
export function formatSkillUsageLessonsPath(sessionId: string): string {
  return `.peaks/_runtime/${sessionId}/txt/skill-usage-lessons.md`;
}

function renderPrdTemplate(
  requestId: string,
  _sessionId: string,
  sessionId: string,
  timestamp: string,
  requestType: RequestType
): string {
  return (
    `# PRD Request ${requestId}

- session: ${sessionId}
- type: ${requestType}
- source: <ticket, message URL, or "verbal" with a short sanitized quote>
- raw input (sanitized): <one-paragraph restatement of what the user actually asked for>

` +
    PRD_TEMPLATE_BODY +
    `## Handoff

- to peaks-rd: ${formatHandoffPath(sessionId, 'rd', requestId)}
- to peaks-qa: ${formatHandoffPath(sessionId, 'qa', requestId)}
- to peaks-ui: ${formatHandoffPath(sessionId, 'ui', requestId)}  (when UI involved)

## Status

- created: ${timestamp}
- last update: ${timestamp}
- state: draft
`
  );
}

function renderUiTemplate(
  requestId: string,
  _sessionId: string,
  sessionId: string,
  timestamp: string,
  requestType: RequestType
): string {
  return (
    `# UI Request ${requestId}

- session: ${sessionId}
- linked-prd: ${formatHandoffPath(sessionId, 'prd', requestId)}
- type: ${requestType}
- scope: full new surface | iteration on existing surface | regression fix | visual refresh
- design direction: editorial | bento | Swiss | luxury | retro-futurist | glass | product-system | other-explicit-name

` +
    UI_TEMPLATE_BODY +
    `## Handoff

- to peaks-rd: ${formatHandoffPath(sessionId, 'rd', requestId)}
- to peaks-qa: ${formatHandoffPath(sessionId, 'qa', requestId)}

## Status

- created: ${timestamp}
- last update: ${timestamp}
- state: draft
`
  );
}

function renderRdTemplate(
  requestId: string,
  _sessionId: string,
  sessionId: string,
  timestamp: string,
  requestType: RequestType
): string {
  return (
    `# RD Request ${requestId}

- session: ${sessionId}
- linked-prd: ${formatHandoffPath(sessionId, 'prd', requestId)}
- linked-ui:  ${formatHandoffPath(sessionId, 'ui', requestId)}  (when UI involved)
- type: ${requestType}

` +
    RD_TEMPLATE_BODY +
    `## Handoff

- to peaks-qa: ${formatHandoffPath(sessionId, 'qa', requestId)}
- to peaks-sc: ${formatCommitBoundaryPath(sessionId, requestId)}

## Status

- created: ${timestamp}
- last update: ${timestamp}
- state: draft
`
  );
}

function renderQaTemplate(
  requestId: string,
  _sessionId: string,
  sessionId: string,
  timestamp: string,
  requestType: RequestType
): string {
  return (
    `# QA Request ${requestId}

- session: ${sessionId}
- linked-prd: ${formatHandoffPath(sessionId, 'prd', requestId)}
- linked-rd:  ${formatHandoffPath(sessionId, 'rd', requestId)}
- linked-ui:  ${formatHandoffPath(sessionId, 'ui', requestId)}  (when UI involved)
- type: ${requestType}

` +
    QA_TEMPLATE_BODY +
    `## Status

- created: ${timestamp}
- last update: ${timestamp}
- state: draft
`
  );
}

function renderScTemplate(
  requestId: string,
  _sessionId: string,
  sessionId: string,
  timestamp: string,
  requestType: RequestType
): string {
  return (
    `# SC Request ${requestId}

- session: ${sessionId}
- linked-prd: ${formatHandoffPath(sessionId, 'prd', requestId)}
- linked-rd:  ${formatHandoffPath(sessionId, 'rd', requestId)}
- linked-qa:  ${formatHandoffPath(sessionId, 'qa', requestId)}
- linked-ui:  ${formatHandoffPath(sessionId, 'ui', requestId)}  (when UI involved)
- type: ${requestType}

` +
    SC_TEMPLATE_BODY +
    `- artifact workspace path: .peaks/_runtime/${sessionId}/
- memory sync authorized: yes | no
- artifact sync authorized: yes | no
- rationale if not authorized: keep local

## Rollback points

- commits / tags / branches that can revert each boundary

## Handoff

- to peaks-txt: ${formatSkillUsageLessonsPath(sessionId)} (when reusable lesson exists)

## Status

- created: ${timestamp}
- last update: ${timestamp}
- state: draft
`
  );
}

export function renderTemplate(
  role: RequestArtifactRole,
  requestId: string,
  sessionId: string,
  changeSlug: string,
  timestamp: string,
  requestType: RequestType
): string {
  switch (role) {
    case 'prd':
      return renderPrdTemplate(requestId, sessionId, changeSlug, timestamp, requestType);
    case 'ui':
      return renderUiTemplate(requestId, sessionId, changeSlug, timestamp, requestType);
    case 'rd':
      return renderRdTemplate(requestId, sessionId, changeSlug, timestamp, requestType);
    case 'qa':
      return renderQaTemplate(requestId, sessionId, changeSlug, timestamp, requestType);
    case 'sc':
      return renderScTemplate(requestId, sessionId, changeSlug, timestamp, requestType);
  }
}
