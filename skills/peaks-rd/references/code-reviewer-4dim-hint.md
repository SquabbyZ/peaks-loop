# Code-reviewer 4-dim hint (slice 2.1 — proposal 2)

> Hint block appended to the code-reviewer sub-agent prompt at dispatch
> time. The RD main loop injects the verbatim block below after the
> Karpathy-guidelines context block (see
> `references/rd-sub-agent-dispatch.md` §"Karpathy-guidelines context").
> The block is the canonical promotion surface for the convention at
> `.peaks/standards/typescript/testing.md`.

## What the reviewer checks (4-dim convention)

When the diff under review touches `tests/unit/**`, the reviewer MUST
verify the diff does not violate the 4-dimension split
(`render` / `behavior` / `integration` / `a11y`). The reviewer does not
need to flag every test-case misalignment; only `describe`-level
violations (one `describe` block spanning two dimensions).

### Review checklist for test diffs

- [ ] Each `describe(...)` block is exactly one dimension. No test case
      inside belongs to a different dimension.
- [ ] No mocking of the SUT in `render` / `behavior` blocks. (Mocks are
      allowed in `integration` blocks and only for the external
      boundary.)
- [ ] Error-message text and error-class names live in `a11y`, not in
      `behavior`. (Asserting `expect(...).toThrow(SomeError)` is
      `behavior`; asserting on the message regex is `a11y`.)
- [ ] E2E tests under `tests/e2e/**` are NOT in scope of this check —
      they follow `peaks-qa`'s test-case-generation rules instead.

### Severity mapping

| Violation | Severity | Reason |
|---|---|---|
| `describe` block spanning 2+ dimensions | LOW | Doc-level concern; reviewer flags so the next refactor can split. **Not a blocker.** |
| Mocking the SUT in `render` | MEDIUM | Breaks the "render = no SUT mocks" rule; the mock is hiding real behavior. |
| Mocking the SUT in `behavior` | MEDIUM | Same as above for `behavior`. |
| Putting error-message regex in `behavior` instead of `a11y` | LOW | Doc-level concern; non-blocking. |

### How to apply this hint

1. Run `git diff -- tests/unit/**` (and any new file under
   `tests/unit/_samples/**`).
2. For each `describe` block in the diff, classify it into one of the
   4 dimensions using the decision tree in
   `.peaks/standards/typescript/testing.md`.
3. If a block fits more than one dimension, flag it under the
   "Doc-level" category — do NOT block.
4. Add a single line under the existing `## Review Summary` table:

```
| Severity | Count | Status |
|----------|-------|--------|
| CRITICAL | 0     | pass   |
| HIGH     | 0     | pass   |
| MEDIUM   | <n>   | info   |     ← test-mock violations (if any)
| LOW      | <m>   | note   |     ← 4-dim doc-level violations (if any)
```

Where `<n>` and `<m>` are the counts from steps 2-3. Empty counts
(`0 | pass`) are fine — absence of test diffs means nothing to flag.

### What this hint does NOT do

- It does NOT introduce a lint rule. ESLint custom rules for
  `describe`-dimension classification age poorly (false positives on
  inline test files, fragile AST parsing).
- It does NOT require retroactive refactor of existing test files.
  Only test diffs under review are checked.
- It does NOT override the existing `code-reviewer.md` checklist
  (security / quality / performance). The 4-dim check is a parallel,
  lower-severity concern.