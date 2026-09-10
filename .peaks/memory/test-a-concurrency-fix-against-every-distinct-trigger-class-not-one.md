---
name: test-a-concurrency-fix-against-every-distinct-trigger-class-not-one
description: Test a concurrency fix against every distinct trigger class, not one
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-09-10-session-528a63/txt/handoff.md
---

S2's race fix shipped with a test using a single trigger (the loser delayed at the lock) and it was
accepted as proof the race was closed. It was not: a separate trigger — a daemon alive but stalled
past the 500 ms `/health` timeout, trivially reachable because a first op blocks the event loop
during the chromium install — produced two live daemons for one session. Two reviewers reproduced it
independently.

**Why:** a passing test proves the trigger it exercises, and reading it as proof of the property is
how a known narrow case gets mistaken for a closed class.

**How to apply:** when accepting a concurrency or liveness fix, enumerate the **distinct trigger
classes** (contention window, timeout/slow path, truncation, crash) and require a test per class.
Say which classes are covered and which are not.
