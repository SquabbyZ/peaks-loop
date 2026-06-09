# Mandatory test-case generation (QA)

> Body of `## Mandatory test-case generation` + `## Test Case: <title>` template. QA must generate test cases, not merely inspect existing ones. Every QA invocation that validates code changes must produce a test-case artifact at `.peaks/_runtime/<sessionId>/qa/test-cases/<request-id>.md`.

**Minimum test-case categories:**

1. **Unit test cases** — verify that RD's unit tests cover: happy path, edge cases (null/undefined/empty), error states, boundary values, and async behavior for each changed function/component/hook
2. **Integration test cases** — API contract verification, data flow through changed components, mock alignment with real API shapes
3. **UI regression test cases** (frontend only) — page load, component render states (loading, empty, error, populated), modal open/close, form submit/validation, table sort/filter/pagination, navigation flow, keyboard accessibility

**Test-case format:**

```markdown
## Test Case: <title>
- **Category:** unit | integration | ui-regression
- **Target:** <file-or-route>
- **Acceptance:** A1, A2  (comma-separated IDs from PRD `## Acceptance criteria`; see "Acceptance linkage" below)
- **Preconditions:** <state-before>
- **Steps:** 1. ... 2. ...
- **Expected result:** <what-should-happen>
- **Status:** pass | fail | blocked | skipped
- **Evidence:** <link-or-observation>
```

**Acceptance linkage (MANDATORY)** — every test case MUST have an `**Acceptance:**` field that references one or more acceptance items from the PRD by their position-based IDs (A1 = first bullet, A2 = second, …). The `peaks scan acceptance-coverage --rid <rid> --project <repo>` command parses both the PRD and this file, builds the coverage map, and fails the QA `verdict-issued` gate if any acceptance item has zero linked test cases. Test cases that genuinely have no acceptance owner (e.g. defense-in-depth regressions) should still include `- **Acceptance:** —` and explain in the **Evidence** field; the coverage report flags these as `unlinkedTestCases` for review without auto-blocking.

**Test-case execution**: Run the project's test command and record results against each generated test case. If the project uses Jest, run `npx jest --coverage` and link the coverage report. If the project uses Vitest, run `npx vitest run --changed --coverage` by default; use the full suite `npx vitest run --coverage` only when the slice warrants a deeper regression check. Record the coverage percentage for changed files in the test report.