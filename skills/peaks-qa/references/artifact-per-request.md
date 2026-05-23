# QA per-request artifact contract

Every QA invocation must leave one durable artifact under the workflow-local workspace so the verification evidence and acceptance verdict are traceable later.

## Required path

```
.peaks/<session-id>/qa/requests/<request-id>.md
```

Use the `<request-id>` PRD assigned (`YYYY-MM-DD-<kebab-slug>`). QA may also produce companion artifacts (regression matrix JSON, browser evidence directory, coverage report, security report, performance report) under the same `qa/` workspace and link to them from this file.

## Required content

```markdown
# QA Request <request-id>

- linked-prd: .peaks/<session-id>/prd/requests/<request-id>.md
- linked-rd:  .peaks/<session-id>/rd/requests/<request-id>.md
- linked-ui:  .peaks/<session-id>/ui/requests/<request-id>.md  (when UI involved)
- type: feature | bug | refactor | clarification

## Red-line boundary check

- in-scope changes seen in the diff (match PRD + RD scope)
- out-of-scope changes flagged (any extra file, route, mock, fixture, behavior)
- verdict: clean | boundary-violation

## OpenSpec exit gate (when openspec/ exists)

- change-id: <id>
- `peaks openspec validate <id>` data.valid: true | false
- issues: ...

## Acceptance checks

For each PRD acceptance criterion:

- criterion text
- check method (UT command, API call, browser path, security tool, performance tool)
- result: pass | fail | blocked
- evidence path

## Mandatory validation gates

- unit tests: command + pass/fail + coverage delta
- API validation (when applicable): request paths exercised, evidence
- browser E2E (when frontend): Playwright MCP visible-browser confirmation (`mcp__playwright__browser_take_screenshot` / `browser_snapshot`), sanitized route/actions, console/network observations (`browser_console_messages`, `browser_network_requests`)
- browser-error feedback loop: page errors, console exceptions, broken network, hydration failures → return-to-RD evidence
- security check: tool used, findings, fixes, unresolved risks
- performance check: tool used, baseline vs after numbers when available
- validation report path

## Regression matrix

- list of surfaces / API paths / browser flows checked
- pass/fail per row

## Browser evidence

- sanitized observations only — no login URLs, cookies, headers, tokens, storage state, browser traces, or screenshots/logs with PII / SSO / MFA material
- artifact directory path

## Verdict

- overall: pass | return-to-rd | blocked
- if return-to-rd: list of failing acceptance items + RD repair request payload
- if pass: ready for `peaks openspec archive <id>` (when openspec/ exists)

## Status

- created: <ISO timestamp>
- last update: <ISO timestamp>
- state: draft | running | verdict-issued
```

## Rules

- Do not skip the QA artifact even for "obvious" passes. The artifact is the trace future maintainers need.
- Any failing acceptance criterion blocks verdict pass; route the QA findings back to RD per the Solo RD↔QA repair loop.
- Playwright MCP is the only acceptable frontend browser gate. Screenshots from other tools, logs, or manual steps do not substitute when frontend is in scope.
- Sanitize all browser/network/log evidence before writing.
- Do not commit unless the user or active profile authorizes durable retention.
