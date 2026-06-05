# QA Request 2026-06-04-workspace-reconcile

- session: 2026-06-04-session-89f7cb
- linked-prd: .peaks/2026-06-04-session-89f7cb/prd/requests/001-2026-06-04-workspace-reconcile.md
- linked-rd:  .peaks/2026-06-04-session-89f7cb/rd/requests/001-2026-06-04-workspace-reconcile.md
- linked-ui:  .peaks/2026-06-04-session-89f7cb/ui/requests/2026-06-04-workspace-reconcile.md  (when UI involved)
- type: feature

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

- overall: pass

## Status

- created: 2026-06-04T15:17:54.018Z
- last update: 2026-06-05T00:19:30.000Z
- state: verdict-issued
