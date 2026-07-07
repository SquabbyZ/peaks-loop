# L2.1 Tasks

## Task 1 — Red-line catalog + scanner framework + `peaks audit` top-level

**Scope**: Ship the audit framework that all 5 P0 enforcers plug into.

- [ ] `src/services/audit/types.ts` (NEW) — RedLineEntry, RedLineBacking, RedLineAudit, RedLineAuditResult
- [ ] `src/services/audit/red-line-catalog.ts` (NEW) — static catalog of red-line patterns (MANDATORY / BLOCKING / MUST NOT / RED LINE markers)
- [ ] `src/services/audit/classifier.ts` (NEW) — pattern match → RedLineEntry
- [ ] `src/services/audit/scanners/skills-tree-scanner.ts` (NEW) — scan `skills/*/SKILL.md`
- [ ] `src/services/audit/scanners/rules-tree-scanner.ts` (NEW) — scan `.claude/rules/**/*.md`
- [ ] `src/services/audit/scanners/openspec-scanner.ts` (NEW) — scan `openspec/changes/**/*.md`
- [ ] `src/services/audit/backing-detector.ts` (NEW) — classify each red line as cli-backed / partial / prose-only
- [ ] `src/services/audit/red-lines-service.ts` (NEW) — main entry; orchestrates scanners + classifier + backing-detector
- [ ] `src/cli/commands/audit-commands.ts` (NEW) — register `peaks audit` top-level + `red-lines` subcommand
- [ ] Register `audit-commands.ts` in `src/cli/index.ts` (verify no existing `program.command('audit')`)
- [ ] Tests: `tests/unit/services/audit/{red-lines-service,classifier,backing-detector}.test.ts` + `tests/unit/services/audit/scanners/*.test.ts`

**Coverage**: ≥ 80%; per-file ≤ 200 lines.

**Gate B2 evidence**: `pnpm vitest run tests/unit/services/audit/`.

## Task 2 — sub-agent-sid enforcer (P0 #3)

**Scope**: Reuse Slice 0.5 sid-naming-guard, expose via the audit scanner.

- [ ] `src/services/audit/enforcers/sub-agent-sid.ts` (NEW) — `findInvalidSids(projectRoot)` using `isValidSessionId` from `sid-naming-guard.ts`
- [ ] Wire into `red-lines-service.ts` as a backing detector for sub-agent-sid red lines
- [ ] Tests: `tests/unit/services/audit/enforcers/sub-agent-sid.test.ts`

**Coverage**: 100% (small file).

**Dogfood**: `peaks audit red-lines` flags invalid sids on the current repo's `.peaks/_sub_agents/` (which has no invalid sids post-Slice-0.5-Task-7).

## Task 3 — tech-doc-presence enforcer (P0 #4)

**Scope**: Extend `peaks request transition` to require tech-doc.md before `spec-locked`.

- [ ] `src/services/audit/enforcers/tech-doc-presence.ts` (NEW) — `techDocExists(sessionId, projectRoot)`
- [ ] Wire into `src/services/requests/request-transition-service.ts` — add a new `prerequisite` for `spec-locked` transition
- [ ] Tests: `tests/unit/services/audit/enforcers/tech-doc-presence.test.ts` + extend `tests/unit/services/requests/request-transition-service.test.ts`

**Dogfood**: `peaks request transition <rid> spec-locked` fails on a session without tech-doc.md.

## Task 4 — mock-placement enforcer (P0 #5)

**Scope**: Add a 5th check to `peaks slice check`.

- [ ] `src/services/audit/enforcers/mock-placement.ts` (NEW) — `hasInlineMock(content)` + `findMockViolations(changedFiles)`
- [ ] Wire into `src/services/slice/slice-check-service.ts` (existing) — append the 5th check
- [ ] Tests: `tests/unit/services/audit/enforcers/mock-placement.test.ts` + extend `tests/unit/services/slice/slice-check-service.test.ts`

**Dogfood**: `peaks slice check` flags a fixture with inline mock data.

## Task 5 — Code-code-ban enforcer (P0 #1)

**Scope**: PreToolUse hook on `Bash` matcher, deny `git commit` / `git apply` from a peaks-* skill.

- [ ] `src/services/audit/enforcers/code-code-ban.ts` (NEW) — `isSoloCodeCommit(skill, command)`
- [ ] Wire into `src/services/hooks/pre-tool-use-bash.ts` (existing) — add the guard
- [ ] Tests: `tests/unit/services/audit/enforcers/code-code-ban.test.ts` + extend `tests/unit/services/hooks/pre-tool-use-bash.test.ts`

**Trust red line**: fail-open if registry / manifest read fails (per `gate-enforcement-hook.md`).

## Task 6 — no-root-pollution enforcer (P0 #2)

**Scope**: PreToolUse hook on `Write` / `Edit` matcher, deny writes outside the root allowlist.

- [ ] `src/services/audit/enforcers/no-root-pollution.ts` (NEW) — `isRootWrite(filePath, projectRoot)` + allowlist constant
- [ ] `src/services/hooks/pre-tool-use-edit.ts` (NEW) — Edit/Write hook handler (peaks currently only has Bash hook)
- [ ] Wire `no-root-pollution` into `pre-tool-use-edit.ts`
- [ ] Tests: `tests/unit/services/audit/enforcers/no-root-pollution.test.ts` + `tests/unit/services/hooks/pre-tool-use-edit.test.ts`

**Dogfood**: `peaks hooks install` registers the new Edit/Write hook; writing a new file at repo root fails when the LLM is in a peaks-* skill.

## Task 7 — Integration test + dogfood

**Scope**: End-to-end test + dogfood run.

- [ ] `tests/integration/audit-red-lines.test.ts` (NEW) — full CLI invocation: `peaks audit red-lines --project <tmp-fixture> --json`
- [ ] Fixture: a small repo with 1 SKILL.md, 1 .claude/rules file, 1 OpenSpec change, with mix of `cli-backed` / `partial` / `prose-only` red lines
- [ ] Verify envelope shape, counts, and per-red-line backing classification
- [ ] Verify: 5 P0 enforcers all show `cli-backed` for their respective red lines
- [ ] Run `peaks audit red-lines --project .` on the current repo and capture JSON output for the QA test report
- [ ] Update `peaks-skill-output-style.md` if the JSON shape diverges from the standard envelope

**Gate B2 evidence**: integration test pass + `pnpm typecheck` clean.

**Gate B3 evidence**: code-review.md (RD sub-agent or self-review).

**Gate B4 evidence**: security-review.md (RD sub-agent or self-review; focus on hook fail-open behavior, allowlist bypass risk, sid injection).

**Gate B8 evidence**: `peaks scan diff-vs-scope --rid 001-l2-1-redlines-audit --project .` shows no out-of-scope diff.

## Done criteria

- All 7 tasks checked.
- `pnpm typecheck` clean.
- `pnpm vitest run` green.
- `peaks audit red-lines --project .` returns a stable JSON envelope.
- 5 P0 red lines flipped from `prose-only` to `cli-backed` (verifiable via the JSON).
- Branch: `feature/l2-1-redlines-audit`; identity from global gitconfig; no AI trailer.
- QA verdict: pass (after `peaks-qa` runs Gate A2/A3/A4/D).

## Estimated time

- Task 1: 1.5 days (framework + 3 scanners + tests)
- Task 2: 0.25 day (small reuse)
- Task 3: 0.25 day (single prerequisite)
- Task 4: 0.5 day (regex + slice check extension)
- Task 5: 0.5 day (PreToolUse wiring)
- Task 6: 0.5 day (new hook handler + allowlist)
- Task 7: 0.5 day (integration + dogfood)

**Total**: ~4 days (slightly over §9 estimate of 2-3 days; the framework + 5 enforcers + integration test is at the upper end of "8-12 red lines").
