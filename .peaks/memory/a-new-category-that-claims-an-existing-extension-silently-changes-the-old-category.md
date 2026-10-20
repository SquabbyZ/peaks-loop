---
name: a-new-category-that-claims-an-existing-extension-silently-changes-the-old-category
description: a new category that claims an existing extension silently changes the old category
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-20-session-a545d0/txt/handoff-002.md
---

Adding `c` to the OCR routing table with `c: ['.c', '.h']` also **removed `.h` from `cpp`**, because the table is a total mapping and the last writer wins. Nothing failed: the suite was green, the drift test against upstream's allowlist passed, and every new test covered the new language. What changed was `--language cpp` returning zero findings for a header-only diff, where the previous release returned findings.

The general shape: when a routing table is both a lookup and a public surface, adding a row can subtract from an existing row. The addition is reviewed; the subtraction is not, because it does not appear in the diff as a deletion on the old line unless you read the whole table.

Two checks catch it. First, a per-language pin on the *old* languages, not only the new one — a table-driven test that walks every language is what surfaced the `.h` case. Second, treat `preserved behavior` in the PRD as a testable list: if a language's behaviour must not change, assert it by name.

And the tempting repair is wrong: putting `.h` in both `c` and `cpp` makes one file map to two languages, which double-counts a single comment in every per-language summary. One file, one language, with the ambiguity documented where the table lives.

Related: [[a-claim-written-in-three-places-and-pinned-by-no-test-will-drift]], [[a-test-that-cannot-fail-is-worse-than-no-test]].
