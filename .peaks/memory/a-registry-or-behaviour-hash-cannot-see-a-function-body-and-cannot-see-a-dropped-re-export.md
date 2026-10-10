---
name: a-registry-or-behaviour-hash-cannot-see-a-function-body-and-cannot-see-a-dropped-re-export
description: A registry or behaviour hash cannot see a function body and cannot see a dropped re-export
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-10-session-062f74/txt/handoff.md
---

Five batches each "proved" behaviour-preserving refactors by hashing the rendered command registry
before and after. An independent reviewer rebuilt the harness outside the repo, established its own
determinism first (three consecutive runs, registry `e590b7a7…` ×3, behaviour `2f1c749b…` ×3), then
planted real defects INSIDE function bodies: renaming the envelope field `dockerRmFailed` to
`dockerRemoved` inside `releaseLease`, and dropping `--force` from the `docker rm` that
`releaseLease` runs. Both hashes stayed byte-identical both times. The registry render covers the
declaration surface only, and the behaviour render only covers the argv list it drives — and the
dimension the refactor actually changed (bodies) is the one dimension neither measures. Two rows in
the field list were dead constants rather than blind spots — "handler arity" is always 1 because
Commander wraps every `.action(fn)`, and "aliases" renders empty because 0 of 518 commands register
one. The same blind spot dropped 5 re-exported types from a façade in a later slice while every
test and both equivalence harnesses stayed green; only comparing the resolved declaration surface
against the TS checker caught it. Fix for the class: for each path a batch declares undriven,
require a direct-call unit test on the extracted function, not another argv case.
