# PRD per-request artifact contract

Every PRD invocation must leave one durable artifact under the workflow-local workspace so the work is traceable later. Treat the artifact as the canonical record; the chat transcript is not.

## Required path

```
.peaks/_runtime/<session-id>/prd/requests/<request-id>.md
```

`<request-id>` is `YYYY-MM-DD-<kebab-slug>` when the user does not name it explicitly. Use a stable id so QA/RD/SC handoffs can reference it.

## Required content

```markdown
# PRD Request <request-id>

- type: feature | bug | refactor | clarification
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

- to peaks-rd: <link to RD request artifact path>
- to peaks-qa: <link to QA request artifact path>
- to peaks-ui: <link to UI request artifact path, if UI involved>

## Status

- created: <ISO timestamp>
- last update: <ISO timestamp>
- state: draft | confirmed-by-user | handed-off | blocked
```

## Rules

- Do not skip the artifact even for "small" or "obvious" requests. The trace is the value.
- Sanitize before writing: no login URLs, cookies, tokens, headers, storage state, browser traces, or screenshots/logs containing PII or SSO/MFA material.
- Do not commit the artifact unless the user or active profile explicitly authorizes durable retention.
- One artifact per request id. Updates append a new dated section or append-only block; do not silently rewrite earlier confirmed content.
- Handoff is blocked if the artifact is missing or its state is `draft`.

## Bug-specific notes

For bug input, the PRD artifact must still capture:

- expected vs actual behavior;
- reproduction steps in user-visible terms;
- regression boundary (what should NOT change);
- acceptance criteria for "fixed" in the user's words.

Bugs are valid PRD input — do not skip the PRD artifact and route directly to RD.
