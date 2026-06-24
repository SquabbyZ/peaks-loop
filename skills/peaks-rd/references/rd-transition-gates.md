# Peaks-Cli RD transition verification gates

> Extracted from `skills/peaks-rd/SKILL.md` on 2026-06-09 (slice 019 — slim skill files to references) to keep SKILL.md under the 800-line cap from `common/coding-style.md`. The content below is the verbatim "Transition verification gates" section that was previously inline; nothing was paraphrased, just relocated.

## Transition verification gates (MANDATORY — full per-gate contract)

You cannot declare a phase complete from memory. Each gate below is a `ls` or `grep` command you **MUST run** and whose output you **MUST see** before proceeding. If any file shows "No such file" or any command returns empty, the phase is incomplete.

> **CLI enforcement (NEW)**: the gates below are now ALSO enforced by `peaks request transition`. The CLI checks the same files before allowing the transition and fails with `code: PREREQUISITES_MISSING` if any are absent. The exact required files depend on the request type chosen at `peaks request init --type <feature|bugfix|refactor|docs|config|chore>` (default `feature`):
>
> | Type | rd:implemented requires | rd:qa-handoff also requires |
> |---|---|---|
> | feature / refactor | `rd/tech-doc.md` | `rd/code-review.md` + `rd/security-review.md` + `rd/perf-baseline.md` (filled Results table, or `N/A — no perf surface` in Notes) + **`qa/test-cases/<rid>.md`** (added in slice 004; pre-drafted by the 4th sub-agent in the parallel fan-out) |
> | bugfix | `rd/bug-analysis.md` (lighter than tech-doc; root cause + fix + regression test plan) | `rd/code-review.md` + `rd/security-review.md` + **`qa/test-cases/<rid>.md`**; `rd/perf-baseline.md` only when the bug is performance-shaped (matches the L449-452 "When this applies" criteria) |
> | config | (none) | `rd/security-review.md` only |
> | docs / chore | (none) | (none) |
>
> The escape hatch `--allow-incomplete --reason "<text>"` still exists for one-off exceptions; the bypass is recorded in the artifact transition note.

**Peaks-Cli Gate A — After project-scan read (before any implementation):**
```bash
ls .peaks/_runtime/change/<changeId>/rd/project-scan.md
# Expected output: .peaks/_runtime/change/<changeId>/rd/project-scan.md
# "No such file" → STOP, create the project-scan first. Do not write code.
```

**Peaks-Cli Gate A2 — Before tech-doc write: project structure verified (PATH CORRECTNESS — CRITICAL):**
```bash
# Verify EVERY file path and directory in the tech-doc exists in the actual project.
# Do not assume paths. Do not guess directory structures. Open the files and verify.
# Example verification (adapt paths to the actual tech-doc):
ls <every-single-directory-path-in-tech-doc> 2>&1 | grep -c "No such file"
# Expected: 0 (zero "No such file" errors)
# Any "No such file" → WRONG PATH. Fix the tech-doc BEFORE writing another word.
# This gate exists because a tech-doc with wrong paths wastes QA time,
# breaks the implementation, and forces the user to correct the engineer.
```

**Peaks-Cli Gate A3 — Before implementation: project standards files exist (CLAUDE.md + .claude/rules/):**
```bash
ls CLAUDE.md .claude/rules/common/coding-style.md .claude/rules/common/code-review.md .claude/rules/common/security.md 2>&1 | grep -c "No such file"
# Expected: 0 (all four files exist)
# Any missing → BLOCKED. Run `peaks standards init --project .` to generate them FIRST.
# Do not write a single line of implementation code without standards files in place.
# Without CLAUDE.md and .claude/rules/, code review and security review triggers won't fire.
```

**Peaks-Cli Gate B — Before QA handoff:**
```bash
ls .peaks/_runtime/change/<changeId>/rd/requests/<rid>.md \
   .peaks/_runtime/change/<changeId>/rd/tech-doc.md
# Both must exist. Missing either → BLOCKED, do not hand off to QA
```

**Peaks-Cli Gate B2 — Before QA handoff: unit tests exist and pass for the changed surface:**
```bash
# Run the project's test command against changed files. Record the output.
# Example (adapt to project test runner):
npx vitest run --changed --reporter=verbose 2>&1 | tail -20
# Expected: exit code 0, all changed-surface tests passing, coverage for new/changed code recorded
# Any failing test or zero tests for new code → BLOCKED. Write tests, then re-run.
#
# To run the FULL suite (slower; not the default for `peaks slice check`),
# drop `--changed` or use `npx vitest run --reporter=verbose`. The peaks-solo-test
# skill is the user-facing wrapper for the full suite; the slice check's
# `--run-tests` flag is the CLI opt-in.
```

**Peaks-Cli Gate B3 — Before QA handoff: code review evidence exists:**
```bash
ls .peaks/_runtime/change/<changeId>/rd/code-review.md 2>&1
# Expected: .peaks/_runtime/change/<changeId>/rd/code-review.md
# "No such file" → BLOCKED. Run code review (use code-reviewer agent or equivalent),
# record findings, fix CRITICAL/HIGH issues, then re-check.
```

**Peaks-Cli Gate B4 — Before QA handoff: security review evidence exists:**
```bash
ls .peaks/_runtime/change/<changeId>/rd/security-review.md 2>&1
# Expected: .peaks/_runtime/change/<changeId>/rd/security-review.md
# "No such file" → BLOCKED. Run security review (use security-reviewer agent or equivalent),
# fix CRITICAL/HIGH issues, record findings, then re-check.
```

**Peaks-Cli Gate B5 — RD artifact body has no unfilled placeholders:**
```bash
peaks request lint <rid> --role rd --project <repo> --session-id <session-id> --json
# Expected: ok=true. exit 0.
# ok=false → BLOCKED. The lint output lists every <placeholder>, "- ..." stub,
# and TBD/TODO marker with line numbers. Fill them in before attempting handoff.
```

**Peaks-Cli Gate B6 — Declared --type matches the actual diff:**
```bash
peaks scan request-type-sanity --project <repo> --type <type> --json
# Expected: consistent=true. exit 0.
# consistent=false → BLOCKED. Either the implementation scope-creeped beyond what
# the declared type covers, or the type was mis-classified at PRD time. Re-classify
# (`peaks request init` with the corrected --type) or trim the scope.
```

**Peaks-Cli Gate B7 — Repair cycle cap (only relevant during RD↔QA repair loop):**
```bash
peaks request repair-status <rid> --project <repo> --session-id <session-id> --json
# Expected: atCap=false. exit 0.
# atCap=true → BLOCKED. Three repair cycles already attempted; emit a blocked TXT
# handoff via Solo rather than entering a fourth cycle.
```

**Peaks-Cli Gate B8 — Diff stays inside the declared red-line scope:**
```bash
peaks scan diff-vs-scope --rid <rid> --project <repo> --session-id <session-id> --json
# Expected: ok=true. exit 0.
# violations[] non-empty → BLOCKED. A changed file matches an explicit out-of-scope
#   pattern. Revert it, or — only with PRD approval — expand the RD red-line scope.
# unclassified[] non-empty → BLOCKED. A changed file does not match any declared
#   in-scope pattern. Either add it to the in-scope list (intentional widening, requires
#   PRD approval) or revert the change.
# patternsDeclared=false → BLOCKED. The RD artifact's `## Red-line scope` section has
#   no concrete path or glob patterns. Fill it in with paths like `src/services/login/**`
#   before re-running. Auto-allowed paths (test files, .peaks/, __mocks__/) never need a pattern.
```

**Peaks-Cli Gate B9 — RD-side perf-baseline output present (when slice has a user-perceivable perf surface):**
```bash
ls .peaks/_runtime/change/<changeId>/rd/perf-baseline.md 2>&1
# Expected: .peaks/_runtime/change/<changeId>/rd/perf-baseline.md
# "No such file" + slice is feature / refactor / bugfix-when-perf → BLOCKED.
#   Run the perf-baseline sub-agent from "Parallel review fan-out" below (or
#   `peaks perf baseline --apply` inline), then fill in the Results table
#   with measurements (lighthouse / k6 / autocannon / project-local bench —
#   the CLI does not run these; that is the RD's job), then re-verify.
# "No such file" + slice is docs / chore / pure-bugfix-no-perf → OK to proceed;
#   this gate does not apply to those slice types.
# File exists but Results table is empty (only the header row, no data rows) →
#   BLOCKED. The sub-agent scaffolds the file; the main RD loop must fill in
#   the Path / route | Workload | Tool | Metric | Baseline | Threshold table
#   with actual numbers before handoff.
# File contains the marker `N/A — no perf surface` in its Notes section →
#   OK to proceed. This is the explicit opt-out the sub-agent writes when
#   the slice has no user-perceivable perf surface (e.g. a feature that only
#   adds an internal flag with no runtime cost, or a refactor that does not
#   alter any hot path).
#
# The CLI enforcement table below the section header also gates this at the
# `peaks request transition rd:qa-handoff` call, so a missing or empty file
# is rejected by the CLI with `code: PREREQUISITES_MISSING`.
```
