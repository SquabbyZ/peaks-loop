---
name: test-a-second-gate-against-the-first-and-never-read-a-missing-process-as-a-verdict
description: Test a second gate against the first, and never read a missing process as a verdict
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-22-session-b0e6e2/txt/handoff.md
---

Two lessons, both paid for by real mistakes in the same slice.

**1. A gate that has two implementations must be tested against the OTHER implementation, not only
against its own expectations.** The Code-Gate exists twice: the Node command
(`peaks code-gate`) and the bash sibling (`pre-tool-code-gate.sh`). Every individual test of either
implementation was green, and every test of the NEW Node logic was green — while the two
implementations disagreed on **6 of the 10** spellings of **one and the same file**
(`<root>/src/deep/x.ts`, read from `<root>/src`): `.//deep/x.ts`, `.///deep/x.ts`, `././/deep/x.ts`,
`.//deep//x.ts`, `.//x.ts`, `.//../src/deep/x.ts` all **denied** in Node and **allowed** in the
sibling. The escape was not a bug in the new logic — it was the **OLD** implementation that the new
one was measured against. The fix was to move the sibling's "is this absolute?" decision **ahead of**
its `./`-strip (the strip turns `.//x` into `/x`), after which the matrix reads **0 of 10
divergences**; the QA matrices then read **29 of 29** spellings in agreement and **65 of 65**
relative family rows denying in both.

*How to apply:* when one rule has two implementations (script + CLI, two adapters, two plugins),
build a matrix that feeds the **same inputs to both** and compares the verdict. Each
implementation's own tests can only prove that implementation. Also measure the **old**
implementation against the **new** one — the disagreement is almost always in the older code, and it
is invisible to each side's own suite.

**2. A missing process must never read as a verdict.** The orchestrator twice reported a false
result — once "the fix is not there", once "the hole is still open" — and a third false "the QA is
wrong". The cause in the first two: the harness spawned the gate from `<root>/src` with a
**relative** `node_modules/tsx/dist/cli.mjs`, so the runner resolved against the process working
directory, the CLI was **never found**, the process died with `Cannot find module`, and a detector
that only looked for the deny marker read the **silence as "allow"**. The companion failure ran the
other way: a payload whose `cwd` the harness **mangled** (backslashes eaten by a shell) made the
instrument produce a wrong input, and the instrument's output was read as a verdict about the
finding — the instrument was broken, not the finding.

*How to apply:* a harness that reports "allow" when it ran nothing is **worse than no harness**,
because it manufactures evidence. Three rules, all three of which the QA matrix follows and which
made both matrices run with `errors = 0 out of 140 rows per version`: spawn the gate **from the
directory the tool call runs in**; spell the CLI with an **absolute** path; and record a row whose
envelope cannot be parsed as an **ERROR**, never as an `allow`. Then read the failure as a failure
of the instrument first, and of the code second.
