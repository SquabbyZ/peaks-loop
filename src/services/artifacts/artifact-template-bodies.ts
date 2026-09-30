/**
 * Static template bodies for the five request-artifact templates in
 * artifact-templates.ts, hoisted VERBATIM for the 300-line cap
 * (C-family wave 4, leaf c4w1-artifacts). Each constant is the byte-exact
 * middle chunk of the corresponding template markdown body; the render
 * functions compose head + body + tail, so emitted markdown is unchanged.
 */

export const PRD_TEMPLATE_BODY = `## Goals

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

`;

export const UI_TEMPLATE_BODY = `## Affected surfaces

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

`;

export const RD_TEMPLATE_BODY = `## Red-line scope

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

`;

export const QA_TEMPLATE_BODY = `## Red-line boundary check

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

`;

export const SC_TEMPLATE_BODY = `## Change impact

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

`;
