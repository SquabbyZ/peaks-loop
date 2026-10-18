---
name: never-quote-a-vitest-selector-glob
description: never-quote-a-vitest-selector-glob
metadata:
  type: convention
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-container.md
---

A quoted `"tests/unit/*.test.ts"` is a vitest filter string, not a shell glob, so it matches nothing
and the run is green over zero files. On 2026-10-19 a sub-agent reported the repo tier green with the
quoted form; the root tier (which contained the failing `spawn-windows-hide-guard`) never ran. This is
backlog §14.9's trap, now on its third session.

**Why:** vitest treats each positional as a `String.includes` filter; `*` is literal. A vacuous green
is indistinguishable from a real one in a report.

**How to apply:** leave the glob UNQUOTED so the shell expands it, or enumerate the files, or run the
directory (`tests/unit`) and accept the wider set. When a sub-agent reports a tier green, check which
exact command it ran before trusting the count.
