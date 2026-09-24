---
name: a-digest-that-proves-the-source-side-does-not-prove-the-emit-side
description: A digest that proves the SOURCE side does not prove the EMIT side
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-09-24-session-b714c7/txt/handoff.md
---

A staleness guard that digests `packages/<pkg>/src/**` and compares against a recorded stamp proves only that the
sources have not moved. It says nothing about whether the **emit** is complete, and the gap is reachable:
`sync-version.mjs` **unlinks** `packages/peaks-loop-shared/dist/version.js` on every invocation, and `predev` runs
it with **no following build**.

Measured (`qa/rid-muf2sasw-qa-report.md:60-76`, reproduced by the orchestrator, and again by hand with
`mv packages/peaks-loop-shared/dist/version.js <aside>`): the guard reported `fresh ×4` over a tree missing an
emitted file, and the next `test:unit` failed with
`Cannot find package 'peaks-loop-shared/version' imported from src/cli/program.ts`.

Two durable readings. First, **a missing build artifact wears a module-resolution error**, which is the exact shape
the guard existed to remove — so the failure message is not evidence about its own cause. Second, the fix is a
**conjunct**, not a smarter digest: add the `emitIsComplete` rule `check-build-integrity.mjs` already encodes, and
bucket an incomplete emit as `stale`, not `missing` — QA's proposed `missing` alternative was measured to silently
*rebuild*, which would also swallow a package whose content had moved on.
