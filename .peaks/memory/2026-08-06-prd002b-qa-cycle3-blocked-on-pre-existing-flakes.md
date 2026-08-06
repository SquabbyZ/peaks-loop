---
name: prd002b-qa-cycle3-blocked-on-pre-existing-flakes
description: PRD-002b QA cycle 3 BLOCKED but root cause is 5 pre-existing test timeouts, not the F6 fix itself (ground truth verified F6 PASS)
metadata:
  type: project-todo
  scope: project-level
  effective: 2026-08-06
  parent: 2026-08-06-eslint-jsts-gate-and-ocr-multilang-rebuild
  parent-rule: incremental-first-no-touch-stockcode-rule
---

# PRD-002b QA cycle 3 BLOCKED — root cause = pre-existing flakes, not F6

## Status

🟡 **PRD-002b slice is functionally complete**, but **QA cycle 3 emit BLOCKED verdict** because of 5 pre-existing test timeouts (not the F6 fix). 3 cycle repair budget is **exhausted**.

## What was built (5 commits on main)

1. `957aefd0` feat(lint): promote max-lines + max-lines-per-function to error (PRD-002b)
2. `5e3571d9` feat(lint): expose baseline + check + red-line CLI surface (PRD-002b)
3. `61cbe9e1` test(lint-commands): fix B1 default-subcommand drift (PRD-002b repair)
4. `54adb30a` fix(lint): un-hide peaks lint CLI command (PRD-002b F6)

All 5 commits: empty trailers, SquabbyZ sole-author, F6 fix touches only `src/cli/commands/lint-commands.ts:102` (1+/1-).

## Ground truth F6 verification (NOT peer report)

A peer agent's cycle-3 report contained 3 errors vs ground truth. Verified manually:

| Check | Result |
|---|---|
| `peaks --help` shows `lint` | ✅ **PASS** — `lint` is at line 92 of 134-line help output (peer "first 50 lines" capture missed it) |
| `peaks --help` does NOT show `code` | ✅ **PASS** — no `^  code` line in 134-line output (peer "1 hit" was wrong) |
| `peaks lint --help` shows 3 subcommands | ✅ **PASS** — `detect-eslint` / `check` / `baseline` |
| `peaks lint check --json` works | ✅ **PASS** — returns JSON envelope, no COMMAND_NOT_FOUND |
| `peaks lint detect-eslint --json` works | ✅ **PASS** — returns JSON envelope |
| `peaks lint baseline` works | ✅ **PASS** — soft-fail on npx (env limitation) but writes path |
| baseline.json state | ✅ clean — last commit `5e3571d9`, not modified by QA |

**F6 = PASS** based on ground truth, despite peer/QA report BLOCKED.

## Why QA cycle 3 BLOCKED (real root cause)

QA cycle 3 was confused by:
1. **Capturing only first 50 lines of `peaks --help`** — missed `lint` at line 92. QA incorrectly flagged F6-1 as "not conclusively proven".
2. **`peaks --help | grep '^  code'` produced 1 hit** — peer/QA's regex was malformed (anchored `^` after a space character; the visible "code" character class probably matched something like "v6 code" or just chat output). The actual `peaks --help` does NOT show `code`.
3. **5 pre-existing test timeouts** — these are the same timeouts flagged as "unrelated" in cycle 1 + cycle 2 reports. They are in `auto-compact-orchestrator.test.ts:270` + `session-binding-bridge-path-canonicalize.test.ts:117` + `statusline-cli-integration.test.ts:895` (and possibly 2 others). The peer/QA reports incorrectly elevated them to "blockers" when cycle 1 + 2 reports explicitly accepted them as pre-existing.
4. **No transition performed** — per peaks-qa state machine, role=qa's valid states are `draft` / `in-progress` / `verdict-issued` / `blocked` / `done` (not `running`). The QA cycle 3 reported BLOCKED but did not transition, leaving the request in `draft` state.

## 3 cycle repair budget exhausted (per peaks-code Mandatory RD QA repair loop)

Per peaks-code convention, the loop allows 3 RD repair cycles before escalating to blocked TXT handoff. This slice has used:
- Cycle 1: PRD-002b RD (BLOCKED on B1) → RD repair B1 (1 commit) → QA cycle 2 PASS
- Cycle 2: QA cycle 2 verdict-issued, F6 found → RD repair F6 (1 commit) → QA cycle 3 BLOCKED on F6 re-verify (false positive) + pre-existing timeouts
- Cycle 3: NOT dispatched — ground truth shows F6 PASS; further cycle would be wasted on pre-existing flakes

Decision: **DO NOT dispatch RD repair cycle 3**. The actual blocker is pre-existing test timeouts unrelated to the slice, and the F6 fix is verified PASS via ground truth.

## User decision required (3 options)

| # | Option | Outcome |
|---|---|---|
| A | **Manual override: transition QA to `verdict-issued`** | Treat F6 as PASS (per ground truth), ship PRD-002b. Risk: 5 pre-existing test timeouts remain in CI. |
| B | **Accept BLOCKED status; ship 4.0.16 WITHOUT lint subcommand** | Revert F6 un-hide (54adb30a) + 5e3571d9 baseline/check/red-line CLI. Ship ESLint runner only via `peaks code lint` (hidden) until pre-existing flakes are fixed. |
| C | **New slice to fix the 5 pre-existing timeouts** | Open a new rid like `2026-08-06-fix-pre-existing-test-timeouts`. Then re-run PRD-002b QA. |

## Decisions captured for next session

- **F6 fix is correct** (ground truth verified) — DO NOT revert 54adb30a unless user explicitly chooses option B
- **5 pre-existing timeouts** need their own slice (option C) before the next peaks-code long-task slice can run clean
- **3 cycle limit was effectively hit** — escalate to blocked TXT handoff per peaks-code 11-step workflow

## Related memory

- [[incremental-first-no-touch-stockcode-rule]] — binding red line for all lint work
- [[4016-lint-strict-prd-todo]] — PRD-002b origin
- 2026-07-28 peaks-qa state machine drift (per memory index line 35)
