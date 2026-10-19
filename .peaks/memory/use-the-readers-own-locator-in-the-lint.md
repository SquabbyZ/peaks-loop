---
name: use-the-readers-own-locator-in-the-lint
description: use-the-readers-own-locator-in-the-lint
metadata:
  type: convention
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-absentstate.md
---

`missingStateFinding` calls `locateArtifactState` — the same locator the transition uses — rather than
a second regex over the body. The lint and the fail-closed transition therefore agree on what "has a
state line" means.

**Why:** a second locator drifts on fenced blocks, indentation and multiple lines; the lint could pass
a document the transition refuses.

**How to apply:** when a lint checks for a field's presence, import the reader's locator. If it is not
exported, export it rather than reimplementing the rule.
