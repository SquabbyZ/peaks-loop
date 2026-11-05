---
name: the-capability-baseline-lock-hash-only-covers-the-row-count
description: The capability-baseline lock hash only covers the row count
metadata:
  type: bug
  sourceArtifact: .peaks/_runtime/2026-11-05-session-af31e4/txt/handoff-release.md
---

`src/services/capability-baseline/store.ts` computes the signed baseline's hash with
`JSON.stringify(stripped, Object.keys(stripped).sort())`. The second argument is a JSON replacer
(array of key names), applied RECURSIVELY, so every nested row serializes as `{}` and the hash
input is effectively `{"rows":[{},{},...]}`. Consequence: mutating any row's content leaves
`capability-baseline.lock` valid — the lock is a row-COUNT check, not a tamper check. Verified by
editing a row and re-hashing. Fixing it changes the signature semantics (every existing lock would
need re-signing), so it needs its own slice and the operator's decision.
