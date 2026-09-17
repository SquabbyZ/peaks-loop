---
name: a-hand-maintained-allow-list-that-points-at-an-old-machine-path-is-a-silent-gate-not-a-working-one
description: A hand-maintained allow-list that points at an old machine path is a silent gate, not a working one
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-09-16-session-5bcf09/sc/release-2-doctor-truth.md
---

`peaks doctor` failed on every workspace that used caller bindings because `RUNTIME_SYSTEM_SUBDIRS = new Set(['change'])` listed only one of the eight runtime dirs the code actually writes. Worse, a process storm of 327 leaked `peaks` nodes — and the same class of event on smaller scale — masks real failures, so the doctor red signal was being trusted against a noise floor. Fix was registry + AST guard, not a derived set, because callers and bogus session dirs (`callers/` vs `x/`) are shape-identical.
