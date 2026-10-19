---
name: refuse-an-empty-population-before-writing-a-baseline
description: refuse-an-empty-population-before-writing-a-baseline
metadata:
  type: decision
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-lintpop.md
---

An empty examined population returns `EMPTY_SCOPE` (exit 1) unless `--allow-empty`; `lint baseline`
refuses before writing, so a mistyped scope cannot overwrite the tracked baseline with an empty one.
`--allow-empty` returns ok with a structured warning naming `checkedFiles: 0`.

**Why:** a baseline is a fixture other gates compare against; writing an empty one is a silent
weakening. A refusal is recoverable; an overwritten fixture is not.

**How to apply:** validate the population before the write in any command that produces a fixture.
Keep an explicit opt-in for the legitimate empty case, and make it warn.
