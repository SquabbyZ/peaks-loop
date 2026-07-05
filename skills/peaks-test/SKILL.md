---
name: peaks-test
description: Universal test-runner primitive for any in-flight Peaks-Loop workflow (orchestrator-agnostic). Runs the project's test suite on the current repo and reports results. Use when the user asks "run the tests", "跑一下 test", "跑测试" for ANY bee (peaks-code, future peaks-research, …). Triggers on "/peaks-test", "跑一下 test", "跑测试", "run the tests", "test now". (Replaces peaks-test as a top-level primitive.)
---

# Peaks-Loop Solo Test (wrapper)

Peaks-Loop Solo Test is a thin wrapper that runs the project's test suite on the current repo and reports results. It is the answer to "I just want to see if the tests pass" — no PRD, no RD, no QA, no full peaks-code orchestration. Just `pnpm vitest run` and a compact summary.

**This is a transparent wrapper.** The user does not stay in this skill — the test command runs, the result is summarized, and control hands off (back to the user, or to `peaks-code` if the user wants to act on the result).

## Skill presence (MANDATORY first action)

```bash
peaks skill presence:set peaks-test --project <repo> --mode <mode> --gate startup
peaks project memories --project <repo> --json  # load durable memory
```

## Step 1: Detect the project's test command

The Peaks-Loop project standard is `pnpm vitest run` (per `vitest.config.ts` + `package.json` scripts). For other project types, check the package.json scripts first. If the user explicitly named a different command (e.g. "跑 `pnpm test` not vitest"), use that.

```bash
# Default for peaks-loop itself + most TS projects with vitest
pnpm vitest run
```

For non-vitest projects (jest, mocha, pytest, etc.), the wrapper respects the project's existing test command. If the user says "run jest" or "run pytest", use that. Do NOT silently default to vitest.

## Step 2: Run the test suite

```bash
# Run with a reasonable timeout (5 min default; override for slow suites)
timeout 300 pnpm vitest run 2>&1 | tail -100
```

Capture both stdout and stderr. If the exit code is 0, tests passed. If non-zero, tests failed or the command errored out.

## Step 3: Summarize the result

Render a compact summary:

- **Test files**: `X passed, Y failed, Z skipped` (from the `Test Files  X passed (Y)` line)
- **Tests**: `A passed, B failed, C skipped` (from the `Tests  A passed | B skipped (C)` line)
- **Wall-clock**: the `Duration` line
- **Failures (if any)**: the first 5-10 failing test names + their failure messages, in priority order (the `FAIL` lines in the test output)

Then ask the user what they want to do next via `AskUserQuestion`:

| Option | What it does |
|---|---|
| Show the full failure list | Print all failing test names + messages (not just the first 5-10) |
| Open a slice to fix the failures | Hand off to `peaks-code` with the failing tests as the slice's "acceptance criteria" |
| Just summarize and exit | No further action; the user will decide later |

## Step 4: Hand off (if user picked option 2)

Re-assert `peaks-code` presence so the status header reads correctly for the rest of the run:

```bash
peaks skill presence:set peaks-code --project <repo> --mode <mode> --gate qa-validation
```

Then yield control. The user's next message will land in `peaks-code` (in QA validation phase, since the failing tests are the validation surface).

## Hard rules (do NOT skip)

- **Never silently fix test failures.** The user must choose what to do via `AskUserQuestion`. Silently "auto-fix"ing a failing test would mask the failure.
- **Never modify source code in this skill.** This is a wrapper. The actual fix (if the user wants one) is `peaks-code`'s job.
- **Never add a new `peaks <cmd>`.** Use only existing primitives: `peaks skill presence:set`, `peaks project memories`, `peaks workspace init` (for the handoff), `peaks request transition` (if going to QA-validation). The actual test command is the project's existing test runner, not a `peaks <cmd>`.
- **Never trust the test runner's exit code as the only signal.** Some failures print partial success (e.g. 100 passed + 1 failed); the wrapper must show the failures, not just say "exit 0".

## Anti-patterns (do NOT do)

- Do NOT run `peaks workspace init` on the real session. The wrapper is read-only on the workspace; it only reads the test results, not the workflow state.
- Do NOT write to `.peaks/_runtime/<sid>/`. This skill is read-only on the workspace.
- Do NOT auto-fail the workflow if the tests fail. The user gets a summary + 3 options; the workflow state is unchanged.
- Do NOT run `pnpm vitest run --watch` or any interactive mode. The wrapper captures the output as a one-shot run; interactive mode would block the orchestrator.

## Cross-references

- The "drives a CLI on the user's behalf" pattern (mirror of `peaks-sop`) is the closest existing precedent.
- `peaks-resume` (sibling wrapper, P2.1) is the workflow-state introspection variant; `peaks-test` is the test-execution variant.
- The "harness a project-native test runner" pattern is intentionally minimal — the wrapper should NOT add a new CLI for running tests (would violate the dev-preference.md "default-no on new CLI" rule + the user's explicit ask for "skill-first, CLI-auxiliary").
