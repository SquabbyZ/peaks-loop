---
name: a-producer-must-not-emit-a-section-the-consumer-cannot-fill
description: a-producer-must-not-emit-a-section-the-consumer-cannot-fill
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-qatemplate.md
---

`request init --role qa` rendered an OpenSpec exit gate carrying `<id>` placeholders, then the
`qa:running` transition refused the pristine template with `LINT_GATE_FAILED`. The lint was right;
the producer was wrong. A template whose required section is unfillable in the repository that
generated it is a gate that can never pass.

**Why:** the placeholder lint checks every `<...>` token uniformly, so it cannot distinguish
"the author must fill this" from "this repository has nothing to put here". The producer is the
only layer that knows which sections are applicable.

**How to apply:** when a template section depends on repository shape, render the decision at
generation time from an explicit project root (`existsSync(join(projectRoot, 'openspec',
'changes'))`), emit one attributable N/A line when the input is absent, and leave the lint and the
transition unchanged. Test both branches and an injection control that forces the old branch.
