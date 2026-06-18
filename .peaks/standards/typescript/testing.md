# TypeScript Testing — 4-Dimension Unit-Test Split (2.7.0, proposal 2)

> Project-local convention for splitting unit tests into 4 orthogonal
> dimensions. **Authored in slice 2.1** (proposal 2 of the 2.7.0
> optimization program). Mirrors the doc style of
> `.peaks/standards/typescript/coding-style.md` (single-section
> canonical file).

- Apply this split to every TypeScript module's unit-test file in
  `tests/unit/**`.
- One test file may cover multiple dimensions; each `describe(...)` block
  is exactly one dimension.
- The 4 dimensions are **mutually exclusive** at the `describe` level —
  no test case belongs to two dimensions.
- The convention does **not** introduce a lint. Promotion is via the
  code-reviewer sub-agent prompt hint at
  `skills/peaks-rd/references/code-reviewer-4dim-hint.md`.

## The 4 dimensions

| Dimension | What it covers | Frontend interpretation | CLI / non-UI interpretation |
|---|---|---|---|
| **render** | Output structure | Component renders the right DOM / JSX / class names | Function returns the right stdout / stderr / file shape / JSON |
| **behavior** | State transitions, event handlers, control flow | Click / hover / form submit / state machine transitions | Argument → return value, error thrown, control-flow branches |
| **integration** | Boundaries with the outside world | API client, context provider, router, Redux store | File system, child process, HTTP / IPC, env vars, external CLI |
| **a11y** | Human-facing clarity and inspectability | Keyboard nav, ARIA roles, contrast, focus order | Error messages, structured logs, exit codes, debug surfaces |

### Why these 4 (and not 3, not 5)

- **render** + **behavior** split output-shape from logic; the most common
  mistake in monolithic test files is conflating them.
- **integration** is the only dimension that **mocks the world**. The
  other 3 run the production code against test fixtures in-process.
- **a11y** forces every code path to surface *why* it failed to a human,
  not just *that* it failed. Tests in this dimension are usually short
  but catch every silent-failure class Karpathy §3 Surgical Changes warns
  against.

## Decision tree — which dimension does my new test go to?

```
Is the test mocking fs / network / process / external module?  → integration
Else, is the test asserting output shape only (no input variation)?     → render
Else, is the test asserting input → output / state transitions?          → behavior
Else, is the test asserting error message text or exit-code visibility?  → a11y
```

If a test fits more than one dimension, **split it**. Conjoined
dimensions are the same defect as conjoined concerns in production code.

## Per-dimension rules

### render

- One assertion per test case; multiple asserts only when they describe
  the same shape (e.g. all 4 fields of a returned object).
- Snapshot tests belong here. Keep snapshots short.
- No mocks of the SUT (system under test). Only fixtures for inputs.

### behavior

- Happy path + at least 1 edge case per `describe` block.
- Boundary values (0, 1, max, empty, undefined) live here.
- Asserts on return values and observable state — not on internal calls.

### integration

- **Mock only the boundary**, not the SUT. Mocking the SUT moves the
  test to `behavior` or `render`.
- Each `describe` block tests ONE external dependency.
- Failure cases (network down, fs full, process exit nonzero) are part
  of this dimension, not a separate "errors" dimension.

### a11y

- Asserts on the **user-visible text or signal**, not internal state.
- Exit codes, log line text, error.message content, console output —
  these are the asserts of this dimension.
- Keep it tight: 1-3 cases per `describe` block is enough to lock the
  human-facing surface.

## What this convention does NOT do

- **No new lint.** Promotion is through the code-reviewer sub-agent
  prompt hint (see `skills/peaks-rd/references/code-reviewer-4dim-hint.md`),
  which the RD main loop appends to the code-reviewer prompt at dispatch
  time. Heavy ESLint rules are deliberately avoided — they age poorly
  and the reviewer prompt is the source of truth.
- **No retroactive rewrite.** Existing test files are not migrated.
  Apply the convention to **new test files only**, and when the
  reviewer finds a dimension violation in a diff that touches tests,
  fix only the touched `describe` block.
- **No E2E coverage mandate.** Integration in this convention is
  *unit-level* integration (fs / network / process mocked). E2E lives
  in `tests/e2e/**` per the existing QA reference.

## Worked example

See `tests/unit/_samples/sample-4dim-module.test.ts` for a complete
sample file written under this convention, applied to a fictional
TypeScript CLI module (mirroring the shape of
`src/services/dispatch/sub-agent-dispatcher.ts`).

## Acceptance for this slice

- A new TypeScript module's test file uses 4 `describe` blocks (one per
  dimension) — or fewer if some dimensions are not applicable, in which
  case the file's header comment names the omitted dimensions and why.
- The code-reviewer prompt hint (see linked reference) is loaded by
  `peaks-rd` at fan-out time and applied to every test diff.