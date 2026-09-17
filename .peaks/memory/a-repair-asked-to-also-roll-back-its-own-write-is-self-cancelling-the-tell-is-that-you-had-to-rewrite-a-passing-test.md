---
name: a-repair-asked-to-also-roll-back-its-own-write-is-self-cancelling-the-tell-is-that-you-had-to-rewrite-a-passing-test
description: A repair asked to also roll back its own write is self-cancelling — the tell is that you had to rewrite a passing test
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-09-17-session-607ead/txt/handoff-rid-a1.md
---

If a repair operation also restores the pre-repair state, its **net effect on that state is zero while
it still reports success**. The repair ran; the evidence says it did; the thing it was supposed to fix
is exactly as it was. Here `peaks codegraph repair-index` was asked to roll back its own config write,
which left `peaks codegraph status` still reporting the gap and exit 75 never clearing — silently
undoing how 4.0.52 had reached include gap 31→0.

**The tell is the test.** Making the new behaviour pass required rewriting **two CLI cases that already
passed and were correct** (`expected true to be false`). A design that invalidates passing tests is not
a local detail — it is a claim that the shipped contract was wrong. That is the moment to stop and ask,
not to rewrite the tests and continue. The sub-agent that hit this did stop and reported it; that was
the correct move, and it is why this shipped as a revert instead of a regression.

**Why:** rolling back is a *decision*, not a *step*. A repair's job is to reach the repaired state; an
undo is the operator's job, on their own schedule, and it needs its own verb so it can be pointed at
independently of any repair.

**How to apply:** when a defect report says "X does not do Y, at odds with expected Y", do not assume X
and Y are compatible. For each pair, ask what the operation means if it does **both** — and if the
answer is "nothing changed", the expectation is the thing that is wrong, not the code. Then expose the
missing capability as its own explicit entry point (here `config-restore`, exit 77) rather than folding
it into the operation whose effect it would cancel.
