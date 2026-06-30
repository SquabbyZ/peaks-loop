import type { RequestType } from './artifact-prerequisites.js';

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

function renderPrdTemplate(requestId: string, _sessionId: string, sessionId: string, timestamp: string, requestType: RequestType): string {
  return `# PRD Request ${requestId}

- session: ${sessionId}
- type: ${requestType}
- source: <ticket, message URL, or "verbal" with a short sanitized quote>
- raw input (sanitized): <one-paragraph restatement of what the user actually asked for>

## Goals

- ...

## Non-goals

- ...

## Preserved behavior

- ...

## Acceptance criteria

- ... (browser-verifiable when frontend is in scope)

## Frontend delta (only when target is frontend)

- pages / routes / components / states / permissions / data deps / edge cases
- 待联调态: ...
- API contracts pending: ...

## Risks and open questions

- ...

## Handoff

- to peaks-rd: ${formatHandoffPath(sessionId, 'rd', requestId)}
- to peaks-qa: ${formatHandoffPath(sessionId, 'qa', requestId)}
- to peaks-ui: ${formatHandoffPath(sessionId, 'ui', requestId)}  (when UI involved)

## Status

- created: ${timestamp}
- last update: ${timestamp}
- state: draft
`;
}

function renderUiTemplate(requestId: string, _sessionId: string, sessionId: string, timestamp: string, requestType: RequestType): string {
  return `# UI Request ${requestId}

- session: ${sessionId}
- linked-prd: ${formatHandoffPath(sessionId, 'prd', requestId)}
- type: ${requestType}
- scope: full new surface | iteration on existing surface | regression fix | visual refresh
- design direction: editorial | bento | Swiss | luxury | retro-futurist | glass | product-system | other-explicit-name

## Affected surfaces

- pages / routes / components / modals / states (loading, empty, error, hover, focus, active, responsive)
- explicit out-of-scope surfaces (do not modify)

## UX flow and page states

- entry points, primary flow, secondary flows, exit points
- state machine per surface when state transitions matter

## Visual constraints

- typography pair: ...
- palette: ...
- density and motion intensity dials: ...
- rejected generic patterns

## Interaction constraints

- keyboard, focus order, ARIA roles, gesture support, accessibility minima

## UI regression seeds

- list of visible regressions QA must check against the prior state

## Browser evidence

- sanitized observations only — no login URLs, cookies, headers, tokens, storage state, browser traces, or screenshots/logs with PII / SSO / MFA material

## Handoff

- to peaks-rd: ${formatHandoffPath(sessionId, 'rd', requestId)}
- to peaks-qa: ${formatHandoffPath(sessionId, 'qa', requestId)}

## Status

- created: ${timestamp}
- last update: ${timestamp}
- state: draft
`;
}

function renderRdTemplate(requestId: string, _sessionId: string, sessionId: string, timestamp: string, requestType: RequestType): string {
  return `# RD Request ${requestId}

- session: ${sessionId}
- linked-prd: ${formatHandoffPath(sessionId, 'prd', requestId)}
- linked-ui:  ${formatHandoffPath(sessionId, 'ui', requestId)}  (when UI involved)
- type: ${requestType}

## Red-line scope

- in-scope files / routes / API paths / data models
- explicit out-of-scope surfaces (do not modify, mock, delete, or replace)

## Standards preflight

- peaks standards init/update --project <path> --dry-run output paths and status
- planned application: apply | review-only | blocked

## OpenSpec linkage (when openspec/ exists)

- change-id: <openspec change id>
- entry validate: peaks openspec validate <change-id> data.valid status
- to-rd projection: peaks openspec to-rd <change-id> artifact path
- exit validate (after implementation): status

## Coverage status

- current total UT coverage: <percent>
- new/changed code coverage: <percent>
- gate verdict: pass | legacy-accepted | blocked

## Slice contract

- slice id, functional boundary, pre-refactor behavior, target structure, unit-test requirements, acceptance checks, rollback plan, commit boundary

## Implementation evidence

- diff paths, test commands + outputs, code review findings + fixes, security review findings + fixes, dry-run output

## MCP usage (when external docs lookup was used)

- capabilityId / tool / sanitized args
- artifact path of stored result
- no secrets, no full network bodies

## Handoff

- to peaks-qa: ${formatHandoffPath(sessionId, 'qa', requestId)}
- to peaks-sc: ${formatCommitBoundaryPath(sessionId, requestId)}

## Status

- created: ${timestamp}
- last update: ${timestamp}
- state: draft
`;
}

function renderQaTemplate(requestId: string, _sessionId: string, sessionId: string, timestamp: string, requestType: RequestType): string {
  return `# QA Request ${requestId}

- session: ${sessionId}
- linked-prd: ${formatHandoffPath(sessionId, 'prd', requestId)}
- linked-rd:  ${formatHandoffPath(sessionId, 'rd', requestId)}
- linked-ui:  ${formatHandoffPath(sessionId, 'ui', requestId)}  (when UI involved)
- type: ${requestType}

## Red-line boundary check

- in-scope changes seen in the diff (match PRD + RD scope)
- out-of-scope changes flagged (any extra file, route, mock, fixture, behavior)
- verdict: clean | boundary-violation

## OpenSpec exit gate (when openspec/ exists)

- change-id: <id>
- peaks openspec validate <id> data.valid: true | false
- issues: ...

## Acceptance checks

- per-criterion: check method, result (pass | fail | blocked), evidence path

## Mandatory validation gates

- unit tests: command + pass/fail + coverage delta
- API validation (when applicable): request paths exercised, evidence
- browser E2E (when frontend): headed gstack/browse/dist/browse visible-browser confirmation, sanitized route/actions, console/network observations
- browser-error feedback loop: page errors, console exceptions, broken network, hydration failures → return-to-RD evidence
- security check: tool used, findings, fixes, unresolved risks
- performance check: tool used, baseline vs after numbers when available
- validation report path

## Regression matrix

- list of surfaces / API paths / browser flows checked
- pass/fail per row

## Browser evidence

- sanitized observations only — no login URLs, cookies, headers, tokens, storage state, browser traces, or screenshots/logs with PII / SSO / MFA material

## Verdict

- overall: pass | return-to-rd | blocked

## Status

- created: ${timestamp}
- last update: ${timestamp}
- state: draft
`;
}

function renderScTemplate(requestId: string, _sessionId: string, sessionId: string, timestamp: string, requestType: RequestType): string {
  return `# SC Request ${requestId}

- session: ${sessionId}
- linked-prd: ${formatHandoffPath(sessionId, 'prd', requestId)}
- linked-rd:  ${formatHandoffPath(sessionId, 'rd', requestId)}
- linked-qa:  ${formatHandoffPath(sessionId, 'qa', requestId)}
- linked-ui:  ${formatHandoffPath(sessionId, 'ui', requestId)}  (when UI involved)
- type: ${requestType}

## Change impact

- modules / files / routes / data models touched
- blast radius: local | cross-cutting | release-critical
- rollback strategy

## Commit boundaries

- one commit per OpenSpec heading (when openspec/ exists)
- otherwise: list of slice ids → commit message + scope

## Artifact retention

- prd artifact: ...
- rd artifact: ...
- qa artifact: ...
- ui artifact: ... (when UI involved)
- coverage evidence: ...
- code review evidence: ...

## Sync / authorization

- artifact workspace path: .peaks/_runtime/${sessionId}/
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
`;
}

export function renderTemplate(role: RequestArtifactRole, requestId: string, sessionId: string, changeSlug: string, timestamp: string, requestType: RequestType): string {
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
