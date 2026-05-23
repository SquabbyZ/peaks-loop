# UI per-request artifact contract

Every UI invocation must leave one durable artifact under the workflow-local workspace so design and frontend behavior decisions are traceable later.

## Required path

```
.peaks/<session-id>/ui/requests/<request-id>.md
```

Use the same `<request-id>` PRD assigned (`YYYY-MM-DD-<kebab-slug>`) so the PRD/UI/RD/QA records can be cross-linked.

## Required content

```markdown
# UI Request <request-id>

- linked-prd: .peaks/<session-id>/prd/requests/<request-id>.md
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
- rejected generic patterns (centered stock hero, default card grid, AI gradients, etc.)

## Interaction constraints

- keyboard, focus order, ARIA roles, gesture support, accessibility minima

## UI regression seeds

- list of visible regressions QA must check against the prior state
- browser paths and visible assertions QA can use directly

## Browser evidence

- sanitized observations only — no login URLs, cookies, headers, tokens, storage state, browser traces, or screenshots/logs with PII / SSO / MFA material
- where the Chrome DevTools MCP browser evidence is stored (`mcp__chrome-devtools__take_screenshot` / `take_snapshot` outputs, sanitized)

## Handoff

- to peaks-rd: <link to RD request artifact>
- to peaks-qa: <link to QA request artifact>

## Status

- created: <ISO timestamp>
- last update: <ISO timestamp>
- state: draft | direction-locked | handed-off | blocked
```

## Rules

- Do not skip the UI artifact when the request touches user-visible behavior. Even bug fixes that change visible flow require a UI request artifact.
- Tasteful direction is a constraint, not a suggestion: record the chosen direction and the rejected generic patterns so QA can fail a regression that drifts toward them.
- Sanitize before writing — same rules as PRD/RD/QA.
- Do not commit unless the user or active profile authorizes durable retention.
- Handoff to RD/QA is blocked while state is `draft`.
