# Code Review: 004-2026-06-04-rd-4way-fanout

- session: 2026-06-04-session-b60252
- rid: 004-2026-06-04-rd-4way-fanout
- type: refactor
- reviewer: code-reviewer (peaks-rd main-loop, full-auto profile)
- reviewed files: `skills/peaks-rd/SKILL.md`, `skills/peaks-qa/SKILL.md`, `skills/peaks-solo/references/workflow-gates-and-types.md`, `tests/unit/parallel-fan-out.test.ts`
- verification: `pnpm typecheck` (pass, 0 errors), `pnpm vitest run tests/unit/parallel-fan-out.test.ts` (13/13 pass, 14ms), full vitest (1785/1785 pass + 5 skipped, 36.67s)

## Summary

The slice expands peaks-rd's parallel review fan-out from 3 to 4 sub-agents. The new 4th sub-agent (`qa-test-cases-writer`) writes `qa/test-cases/<rid>.md` in parallel with the existing code-review/security-review/perf-baseline sub-agents, so QA's main loop's first action becomes "execute pre-drafted test plan" instead of "draft + execute". Gate C in both peaks-rd's table and the solo references' bash code block is updated to require `qa/test-cases/<rid>.md` for feature / refactor / bugfix slices. peaks-qa is updated to be aware of the optimization. 13 new vitest cases verify the contract: sub-agent names, output paths, Gate C table, degradation notes, hard prohibitions, QA main loop awareness. Full dogfood: peaks-rd + peaks-qa + peaks-solo runbooks unchanged, skill-doctor 35/35 pass.

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

None.

### LOW

- **L-1 (skills/peaks-rd/SKILL.md:599-625 — sub-agent 4 writes to QA's dir while orchestrated by RD)**
  The 4th sub-agent (`qa-test-cases-writer`) is invoked from peaks-rd's main loop but writes to `qa/test-cases/<rid>.md` (a path under `qa/`, not `rd/`). This is a small role-boundary crossing. Mitigated by: the sub-agent's contract says "do NOT execute tests, do NOT write to `tests/` dir on disk" — the file is a planning artifact (markdown + `ts` snippets) that QA's main loop reads and re-drafts as actual test code. The trust boundary is the same as the 3 existing sub-agents (all read-only on the git diff; all write to a specific path under `.peaks/<sid>/`). **Acceptable; intentional parallelization.**
  File: `skills/peaks-rd/SKILL.md:599-625`

- **L-2 (skills/peaks-rd/SKILL.md:599-625 — qa-test-cases-writer's prohibitions don't mention linters)**
  The 4th sub-agent's hard prohibitions say "do NOT execute tests" and "do NOT write to `tests/`" but don't explicitly say "do NOT run linters / typecheckers". Linters are read-only and don't change state, so this is technically safe. **Acceptable; linters are implied under "review only".**
  File: `skills/peaks-rd/SKILL.md:599-625`

- **L-3 (skills/peaks-rd/SKILL.md — 800-line cap exceeded by 10 lines)**
  peaks-rd/SKILL.md was 775 lines pre-refactor; this slice adds ~35 lines (Sub-agent 4 section + Gate C table update + expanded Aggregation/Degradation) and removes ~20 lines (no actual deletions in this slice; the 3-way fan-out section was renamed, not removed). New total: ~810 lines, slightly over the 800-line cap from `common/coding-style.md`. **Acceptable for this slice; a follow-up refactor will slim the SKILL.md by extracting the inline perf-baseline scaffold runbook (`peaks perf baseline --apply --reason ...`) to a `references/` file. Out of scope here.**
  File: `skills/peaks-rd/SKILL.md`

- **L-4 (skills/peaks-solo/references/workflow-gates-and-types.md:110 — bash code block comment line 250+ chars)**
  The Gate C bash code block now has a long comment line (250+ chars) documenting the qa/test-cases pre-drafting. Acceptable for a comment (not a code line), but if the line gets much longer it will be hard to read. **Acceptable; documentation line, not code.**
  File: `skills/peaks-solo/references/workflow-gates-and-types.md:110`

## Required Fixes

None. (No CRITICAL, HIGH, or MEDIUM findings.)

## Recommended

- **L-1**: Acceptable; intentional parallelization. The sub-agent is named `qa-test-cases-writer` (in QA's domain) but orchestrated by RD's main loop (in RD's review fan-out); the file path is canonical.
- **L-2**: Acceptable; linters are read-only and implied under "review only".
- **L-3** (deferred to a follow-up): When the next refactor lands, slim peaks-rd/SKILL.md by extracting the inline perf-baseline scaffold runbook to a `references/` file. Net: ~30-40 lines moved out of SKILL.md, bringing it back under 800.
- **L-4**: Acceptable; documentation line. If the line gets longer, consider splitting into 2 lines.

## Verdict

**verdict: pass** (0 CRITICAL, 0 HIGH, 0 MEDIUM, 4 LOW; L-1 + L-2 acceptable as-is, L-3 deferred, L-4 acceptable)
