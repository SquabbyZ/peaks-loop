---
name: a-guards-name-is-not-its-predicate
description: a-guards-name-is-not-its-predicate
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff.md
---

`getSessionDir` and `tryGetSessionDir` say "must be a single path segment", but they use
`isUnsafePathInput`, which is a traversal guard and admits `a/b`. The reviewer producer inherited
that predicate and wrote its artifacts under `.peaks/_runtime/a/b/rd/`; QA caught it only because the
producer's own comment claimed to refuse unsafe session ids.

**Why:** a predicate's name and its call sites' prose are not its behaviour. "Unsafe" meant
"traversal", not "single segment", and the caller read the word it needed.

**How to apply:** when a call site says "must be a single path segment", assert the separator axes
explicitly (`/`, `\`) or call a dedicated single-segment predicate. Do not infer it from
`isUnsafePathInput`. Add the `a/b` arm as the control; `..` and `\` already pass for the wrong reason.
