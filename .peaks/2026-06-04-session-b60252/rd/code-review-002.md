# Code Review: peaks-solo SKILL.md slim + references/ extraction

- session: 2026-06-04-session-b60252
- rid: 002-2026-06-04-solo-skill-slim-extract
- type: refactor
- reviewer: code-reviewer (peaks-rd main-loop, full-auto profile)
- reviewed files: `skills/peaks-solo/SKILL.md`, `skills/peaks-solo/references/runbook.md`, `skills/peaks-solo/references/workflow-gates-and-types.md`, `src/services/skills/skill-runbook-service.ts`, `tests/unit/doctor.test.ts`, `tests/unit/skill-default-runbook.test.ts`
- verification: `pnpm typecheck` (pass, 0 errors), `pnpm vitest run` (1764/1764 pass + 5 skipped, 23.25s), `wc -l` (SKILL.md=765, runbook.md=168, workflow-gates-and-types.md=175)

## Summary

The slice is a pure documentation + helper-extraction refactor. The 1071-line `peaks-solo/SKILL.md` is slimmed to 765 lines by extracting two reference blocks (the 168-line bash `## Default runbook` and the 175-line contract block covering request-type classification, workflow order, and transition verification gates A-G) into sibling files under `references/`. The `## Default runbook` block in `SKILL.md` is replaced with a 3-line pointer that quotes the contract in fewer words. The `inspectSkillRunbook` function in `src/services/skills/skill-runbook-service.ts` gains a new `loadRunbookSection` helper that prefers the longer of (a) the inline section in `SKILL.md` or (b) the same section in `references/runbook.md`, so a `peaks skill runbook peaks-solo --json` invocation transparently surfaces the full 168-line bash runbook regardless of where it lives. The two test files that read `peaks-solo/SKILL.md` for runbook self-checks (`doctor.test.ts`, `skill-default-runbook.test.ts`) now fall back to `references/runbook.md` if the inline section is just a pointer. All 6 existing tests on `inspectSkillRunbook` pass without modification because the helper correctly prefers the longer reference (168 lines) over the 3-line pointer in the slimmed SKILL.md. All 8 existing test cases in `skill-default-runbook.test.ts` and the 1 self-check in `doctor.test.ts` pass without modification because the new `loadRunbookSection` test helper is a 1:1 copy of the service helper. `pnpm typecheck` and the full vitest run both pass clean.

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

None.

### LOW

- **L-1 (skills/peaks-solo/references/runbook.md:13-15 — duplicate introductory prose)**
  The new `references/runbook.md` originally duplicated the line "The end-to-end CLI sequence for the `full-auto` profile. `assisted` and `strict` profiles pause at `[CONFIRM]` markers below. `full-auto` and `swarm` auto-proceed through all gates. See Transition Gates for artifact verification at each stage." on consecutive lines. This is a content-quality issue from the LLM-driven extraction. **FIXED inline in this slice** via Edit (the second copy was removed). Verified by re-reading the file: line 13 is the single sentence, line 15 begins the `\`\`\`bash` fence. No regression risk.
  File: `skills/peaks-solo/references/runbook.md:13-15`

- **L-2 (tests/unit/skill-default-runbook.test.ts:29-51 — test helper is a 1:1 copy of the service helper)**
  The new `loadRunbookSection` helper in `tests/unit/skill-default-runbook.test.ts:29-51` is a near-verbatim copy of `loadRunbookSection` in `src/services/skills/skill-runbook-service.ts:47-60`. Mild DRY violation. Mitigations: (a) the test is intentionally self-contained (importing the service helper would couple the test to the production module's internals, defeating the test's purpose of asserting behavior against file layout), (b) the copy is small (~22 lines), (c) any future change to the service helper should be mirrored in the test helper and vice versa, which is the test's contract. Acceptable.
  File: `tests/unit/skill-default-runbook.test.ts:29-51`

- **L-3 (src/services/skills/skill-runbook-service.ts:50-56 — broad `try { ... } catch {}`)**
  The new `loadRunbookSection` helper uses a bare `try { ... } catch { /* reference file does not exist or is not readable */ }` to swallow all errors when reading `references/runbook.md`. Defensive: the reference is optional, ENOENT and EACCES both should silently fall through. The two documented failure modes (file missing, file not readable) are both "the reference doesn't exist for our purposes" and the helper returns the inline section. The bare `catch` could mask real I/O errors (e.g. a permissions storm on the entire skills dir) but the cost of those errors is "we return the inline section if it exists, or `null` if it doesn't" — both of which are valid behaviors. Could be tightened to `catch (error: unknown) { if (!(error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT')) throw error; }` but the cost/benefit is low. Stylistic; no functional impact.
  File: `src/services/skills/skill-runbook-service.ts:50-56`

- **L-4 (src/services/skills/skill-runbook-service.ts:32-46 — JSDoc only mentions peaks-solo by name)**
  The JSDoc for `loadRunbookSection` says "This supports skills (notably `peaks-solo`) that extracted their 150-line bash runbook to a sibling reference..." — it is generic but the name drop singles out peaks-solo. Other skills may adopt the pattern in the future; the helper is not peaks-solo-specific. Stylistic; no functional impact. Could be reworded to drop the name. Optional.
  File: `src/services/skills/skill-runbook-service.ts:32-46`

## Required Fixes

- **L-1**: FIXED inline (duplicate line removed from `references/runbook.md`).

## Recommended

- **L-2**: Acceptable as-is; the test isolation is intentional. No action required.
- **L-3**: Acceptable as-is; the broad `catch` is the documented contract. No action required.
- **L-4** (optional): Drop the `peaks-solo` name from the JSDoc and use a generic phrasing ("skills that extracted their runbook..."). One-line change.

## Verdict

**verdict: pass** (0 CRITICAL, 0 HIGH, 0 MEDIUM, 4 LOW; L-1 fixed inline)
