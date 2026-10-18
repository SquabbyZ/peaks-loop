---
name: do-not-wire-an-implicit-root-build-to-fix-a-message
description: do-not-wire-an-implicit-root-build-to-fix-a-message
metadata:
  type: decision
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-rootdist.md
---

§2.13 had two ways out: accept the ≈9–14 s implicit root build, or give the misleading test a stated
prerequisite. The slice took the second. The measurement is host-variable (8.9–14.2 s across runs),
so the cost is real and not worth paying on every unit run for two files.

**Why:** the defect was the message, not the absence of a build. An implicit build would change every
test run's cost to fix one sentence.

**How to apply:** separate "the prerequisite is missing" from "the prerequisite should be built
implicitly". Fix the first with a directed failure; decide the second on measured cost.
