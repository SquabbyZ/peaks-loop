---
name: a-refusal-path-can-throw-instead-of-refusing
description: a-refusal-path-can-throw-instead-of-refusing
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-release.md
---

`transitionRelease`'s refusal builds its message with `VALID_TRANSITIONS[from].join(…)`. For an unknown
`from` the lookup is `undefined`, so the refusal throws `TypeError: Cannot read properties of undefined
(reading 'join')` instead of returning a refusal. It is in-repo unreachable after §2.4's reader fix,
but a direct library caller with a hand-built state reaches it.

**Why:** a refusal path is still code; an index into a lookup can crash when the value is the very
thing being refused.

**How to apply:** in a refusal message, use `VALID_TRANSITIONS[from] ?? []` (or a named fallback) and
test the refusal with an unknown input. A refusal that throws is not a refusal.
