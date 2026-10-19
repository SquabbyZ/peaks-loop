---
name: a-side-effect-on-a-success-path-has-no-in-order-alternative
description: a-side-effect-on-a-success-path-has-no-in-order-alternative
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-qamarker.md
---

`qa/.initiated` was written only as a side effect of `request init --role qa`, and that command refuses
when the QA artifact already exists. A QA role that wrote its artifact first therefore had no in-order
way to create the marker; the only exits were deleting a real artifact or hand-creating the file.

**Why:** a side effect is reachable only through the command that carries it. When that command's guard
depends on the state the side effect is meant to accompany, the producer can reach a state with no
legitimate transition out.

**How to apply:** if a marker is a prerequisite, give it a verb of its own — idempotent and decoupled
from the artifact writer. Test the state where the artifact exists and the marker does not.
