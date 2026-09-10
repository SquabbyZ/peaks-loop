---
name: measure-the-alternatives-before-fixing-a-wrong-target-defect
description: Measure the alternatives before "fixing" a wrong-target defect
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-09-10-session-528a63/txt/handoff.md
---

A probe checked for full `chromium` while `launch()` needed `chromium-headless-shell`. The obvious
fix was to change the launched engine. The implementer measured first: `chromium.launch({channel:
'chromium'})` took **15 101 ms** to `close()` versus **102 ms** for the headless shell — and teardown
must finish inside the stop waiter or the daemon is killed mid-teardown and orphans its browser,
which is the very thing AC6 forbids. So the fix went to the probe, not the engine.

**Why:** a "which side of the mismatch is wrong" defect has two candidate fixes, and the intuitive
one can trade a local correctness bug for a worse behavioural regression.

**How to apply:** when a constant, target or default looks wrong, measure the side effects of each
candidate fix before choosing. State the measurement in the report so the choice is reviewable.
