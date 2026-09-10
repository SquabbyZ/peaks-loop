---
name: an-absolute-rule-collides-with-implementation-reality-enumerate-the-carve-outs
description: An absolute rule collides with implementation reality — enumerate the carve-outs
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-09-10-session-528a63/txt/handoff-s4.md
---

S4's cookie rule was amended to "**no other artifact may hold these values, anywhere** — not under
`.peaks/_runtime/`, not elsewhere in the project tree, not elsewhere under the user's home." That
wording turned out to be **literally unsatisfiable**, and it blocked a legitimate design:

1. A headed Chromium writes its live session cookies to an **ephemeral profile directory it manages
   itself**, for the duration of any login session. No login flow can prevent that. So a headed login
   is **never zero-exposure**, and the rule implied otherwise.
2. Publishing the profile atomically requires a **transient staging file** in the profile directory.
   The rule forbade it, so the only compliant option was a non-atomic write — which truncated the
   previous session on failure. The rule was pushing the implementation toward a worse state.

**Why:** an absolute written to close one loophole will usually forbid something legitimate too. When
that happens the implementation either violates the rule silently or regresses to satisfy it — and the
rule's authority is what gets spent.

**How to apply:** keep the default absolute, then **enumerate the carve-outs by name**, each with its
bounds (here: per-run name, `0600`, same directory, deleted on every failure path, never read as a
profile). A rule with named exceptions is enforceable; one with an unstated exception is not. When you
amend such a rule, say plainly what the exception costs — including that the "safe" path is not
actually zero-exposure.
