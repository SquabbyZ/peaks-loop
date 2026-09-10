---
name: a-test-that-cannot-fail-is-worse-than-no-test
description: A test that cannot fail is worse than no test
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-09-10-session-528a63/txt/handoff-s4.md
---

Slice S4 of `peaks-web` needed five review rounds, and the **first three each found a defect behind a
green suite — in every case because the test was structurally incapable of failing.** (1) The
confirmation wait was never exercised: the fake wrote the confirm file *inside* `launch()`, before the
wait began, so `waitForConfirmation` returned on its first check; replacing its body with a bare
`existsSync` left all 18 tests green. (2) A cadence counter was incremented *before* a closed-check, so
a failed read satisfied it; snapshotting once and then waiting kept all 35 green. (3) The atomicity
proof injected its failure *before* the real `writeFileSync`, so the byte-equality assertion could
never fail — a faithful revert to a non-atomic publish passed 49/49.

**Why:** a green suite is evidence about its assertions, never about the criterion. A test that cannot
fail converts an unknown into a recorded pass, and it does it invisibly — which is strictly worse than
having no test, because no test leaves you appropriately unsure.

**How to apply:** a fix is not verified until you have **made the test fail by reverting it**. In every
repair brief, require the implementer to name the mutation performed and the test that failed — or to
write "unguarded, could not make it fail". Treat an unfalsifiable claim in a report as a finding, not
as evidence. When injecting a failure, inject it at the operation the claim is *about* (for atomicity,
the rename; not the write that precedes it).
