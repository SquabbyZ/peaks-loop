---
name: a-feature-can-be-fully-tested-and-still-be-unreachable-from-production
description: A feature can be fully tested and still be unreachable from production
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-09-17-session-607ead/txt/handoff-rid-b2.md
---

B1 shipped a producer, a type, a serializer, a rewritten reader, and 24 passing cases including a real
`initHandoff -> writeHandoff -> reader` round trip. Every test was green. QA then ran the actual CLI on
an actual project and read the file off disk: **the capsule had no `gateEvidence` at all.** All three
writers — the only `initHandoff` caller, the only `autoRegenPrdHandoff` caller, and a third producer —
passed nothing. The field was reachable from tests and unreachable from anywhere a user could go.

**Why:** the tests exercised the new seam directly, so they proved the seam worked. Nothing asked
whether anything *reached* the seam. The failure is one layer outside every test that existed, which is
exactly where a passing suite is silent.

**How to apply:** for anything described as "wired up", the acceptance case is **the real entry point,
run for real, with the result read back off disk** — not a unit test of the unit. Ask of the new code
"who calls this?" and follow the answer to a real invocation; if the answer is "the tests", the feature
is not shipped. The same check applies to the reverse: B1's header comment claimed the file "describes
what is on disk" while nothing on disk carried the field.
