# M7 — Regression + Release

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Confirm no regression in existing peaks-code / peaks-rd / peaks-qa flows + bump version + write CHANGELOG + sediment memory. After M7, peaks-job v1.0 is releasable.

**Architecture:** Standard peaks-loop release flow: run existing runbook in a sample project, confirm green; add `peaks-job` entry to CHANGELOG.md; version bump 3.0.x → 3.1.0; sediment `.peaks/memory/peaks-loop-job-introduction.md` for future sessions.

**Tech Stack:** pnpm scripts (`sync-version`, `clean-dist`, `tsc`), git, vitest.

---

## Global Constraints (from README)

Apply verbatim. Plus the CLAUDE.md red rule (no Claude co-author trailer) and the standard release pipeline scripts.

---

## Task 7.1: Run full unit + integration suite

- [ ] **Step 1: Unit suite**

Run: `pnpm vitest run tests/unit`
Expected: PASS — all green.

- [ ] **Step 2: Integration suite**

Run: `pnpm vitest run tests/integration`
Expected: PASS — all green.

- [ ] **Step 3: Silent-warning detector**

Run: `pnpm lint:silent-warning`
Expected: PASS, 0 warnings.

---

## Task 7.2: Regression test — existing peaks-code runbook still green

- [ ] **Step 1: Find an existing single-rid scenario fixture**

Run:
```bash
ls tests/integration/ | head -20
```
Identify a 1-2 fixture tests that exercise the existing runbook (e.g. PRD → RD → QA → commit flow for a single rid).

- [ ] **Step 2: Run them explicitly**

Run: `pnpm vitest run tests/integration --reporter=verbose`
Inspect: every existing scenario passes, **Job-related artifacts do not pollute the runbook**.

- [ ] **Step 3: If any regression appears**

Open the failing test. Determine the cause:
- (a) Job CLI introduced a global side-effect (e.g. an unconditional `.gitignore` mutation). Fix in `src/cli/commands/job-commands.ts`.
- (b) New subcommand registration broke Commander's tree. Move the `job` command behind an explicit `registerJobCommands(prog)` call so existing tests that build their own program tree without it are unaffected.
- (c) Resource snapshot global state leak. Add explicit cleanup.

Fix in the relevant layer. Re-run until green.

---

## Task 7.3: Version bump + CHANGELOG

**Files:**
- Modify: `package.json` (3.0.3 → 3.1.0)
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Bump version**

Run:
```bash
node ./scripts/sync-version.mjs
```
Expected: bumps `package.json` from 3.0.3 to 3.1.0.

- [ ] **Step 2: Add CHANGELOG entry**

Append at the top of `CHANGELOG.md`:

```markdown
## 3.1.0 — 2026-07-03

### Added — Peaks-Loop Job

- New `peaks job *` subcommand family: init / status / checkpoint / continue / resume / block / handoff / rotate-now / subagent-cleanup.
- New CLI flag `--main-loop-strategy single|rotating` on `job init`, with rotating-mode hard-default for ≥3 slices.
- New 9th subcommand `--watch` poll mode + statusline event hook for ambient progress visibility.
- Sub-agent wrapper enforces `--budget-mb 512` default in Job scope + cleanup gate before slice checkpoint.
- New peaks-code SKILL.md Steps 0.8 / 0.81 / 0.85 / 0.86 / 0.87 wrapping the existing single-rid runbook for multi-slice jobs.
- 9 hard-red-line rules embedded in SKILL.md (cost re-ask ban, slice-coalesce ban, fake-completion ban, detached-mode ban, cleanup-skip ban, rotate-skip ban, etc).

### Migration

- Existing single-rid flows are unchanged. The Job is opt-in via Step 0.8 detection; users who do not invoke multi-slice requests see no behavior difference.

### Spec

- Design: `docs/superpowers/specs/2026-07-03-peaks-loop-job-design.md` (v3).
- Plans: `docs/superpowers/plans/2026-07-03-peaks-job/`.
```

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: builds clean.

- [ ] **Step 4: Commit (no Claude co-author)**

```bash
git add package.json CHANGELOG.md
git -c user.name=SquabbyZ -c user.email=601709253@qq.com commit -m "chore(release): bump version 3.0.3 → 3.1.0 + CHANGELOG (peaks-job v1.0)"
```

---

## Task 7.4: Sediment `.peaks/memory/peaks-loop-job-introduction.md`

**Files:**
- Create: `.peaks/memory/peaks-loop-job-introduction.md`

- [ ] **Step 1: Write the memory**

```markdown
---
name: peaks-loop-job-introduction
description: peaks-loop Job v1.0 — outer-wrapper construct for long multi-slice work; how to use, hard rules, when to invoke
metadata:
  type: project
  createdAt: 2026-07-03
  affects: peaks-code Step 0.8+, peaks CLI (peaks job *), .peaks/_runtime/<sid>/job/<jid>/
---

# peaks-loop Job v1.0 — Introduction (2026-07-03 ship state)

## What it solves

LLM-runners processing long multi-slice work (e.g. add UT for every `app/` subdirectory) used to stop after the first slice with "this can't fit a single session" or "this is too expensive" rationalizations, even when the user explicitly disavowed cost.

Root cause: the runbook modeled one rid = one workflow. There was no outer loop. Auto-compact (v2.13.0) keeps a single rid alive across context overflow but does not chain rids.

Solution: a `Job` construct as a first-class CLI surface (`peaks job *`) plus a runbook-level outer loop (Step 0.8/0.81/0.85/0.86/0.87). Foreground-only, real-time visible (3-layer visibility).

## When to use

Trigger conditions (Step 0.8 detection):
- User request names multiple parallel targets (subdirectories, submodules, files).
- User says "全部完成" / "until all done" / "all of them" / similar.
- User disavows cost: "不用 care 费用" / "don't worry about cost" / "一直跑".

The detection is heuristic, not semantic. Edge cases can be overridden via explicit `--main-loop-strategy` and `--exit-policy` on `peaks job init`.

## Hard rules (9 red lines)

The LLM-runner MUST NOT (per spec §6.3):
1. Enter Step 11 / final handoff while job has remaining slices.
2. Re-ask about cost / length / context.
3. Coalesce multiple slices into one rid.
4. Modify a committed slice (`git commit --amend` on `done`).
5. Fake completion (commit-sha is verified).
6. Use detached / background / daemon sub-agents.
7. Skip `peaks job subagent-cleanup` between dispatch and slice checkpoint.
8. Skip or postpone a scheduled `peaks session rotate`.
9. Suppress visibility (statusline / `--watch` are always on).

Violations emit a `peaks job block` event with the red-line number.

## Main-loop strategies

- `single` — one main LLM session drives the entire job. Default for ≤2 slices. Context grows monotonically; auto-compact fires passively.
- `rotating` — every `rotateEvery` slices (default 3), the main LLM session resets via `peaks session rotate` and resumes via `peaks session resume`. **Hard default for ≥3 slices.** This is the answer to "compact didn't help, LLM returns HTTP 400 valid params" — periodic rotation resets the kernel-level state cleanly.

LLM-initiated override `rotating` → `single` requires:
- A reason ≥10 characters.
- Predicted wall-time ≤30 minutes.
- A `mainLoopOverride` audit field in state.json.

## Sub-agent resource safety

Every `peaks sub-agent dispatch` inside a Job scope MUST declare `--budget-mb` (default 512) AND fire `peaks job subagent-cleanup --force` BEFORE the next slice checkpoint. The wrapper refuses to mark a slice done until cleanup is clean. This is a hard policy (red line #7).

## Visibility layers

1. **LLM-runner transcript** — primary; the user reads the chat.
2. **`peaks job status --watch`** — terminal poll, ANSI bar, refresh 3s.
3. **Statusline** — ambient `job: <jid> [done/total] currentSlice ETA m:s context main%. cycle`.

All three are on by default. Suppression is a red-line violation.

## Files of interest

- Spec: `docs/superpowers/specs/2026-07-03-peaks-loop-job-design.md` (v3).
- Plans: `docs/superpowers/plans/2026-07-03-peaks-job/`.
- CLI: `src/cli/commands/job-commands.ts`.
- State machine: `src/services/job/{job-types,job-state-store,job-orchestrator,job-rotation}.ts`.
- Wrapper: `src/services/job/subagent-job-wrapper.ts`.
- Snapshot: `src/services/job/job-resource-snapshot.ts`.
- Skill: `skills/peaks-code/SKILL.md` (Steps 0.8 / 0.81 / 0.85 / 0.86 / 0.87).

## Related

- [[peaks-loop-24h-ai-programmer-positioning]] — core 24h AI programmer positioning this satisfies.
- [[2026-06-28-full-auto-boundary]] — full-auto = commit-end, Job is full-auto by construction.
- [[2026-06-27-auto-compact-design]] — auto-compact is the *passive* rescue inside `single` mode; rotating mode is the *active* answer.
```

- [ ] **Step 2: Commit**

```bash
git add .peaks/memory/peaks-loop-job-introduction.md
git -c user.name=SquabbyZ -c user.email=601709253@qq.com commit -m "docs(memory): sediment peaks-loop-job-introduction (v1.0 ship state)"
```

- [ ] **Step 3: Regenerate memory index.json**

Run:
```bash
peaks memory extract --project "$(pwd)" --artifact .peaks/_runtime/$(ls -1 .peaks/_runtime | tail -1)/txt/handoff.md --dry-run --json 2>&1 | tail -10
```
If the dry-run regenerates index.json correctly, the rest of the project memory layer is consistent.

(If a `txt/handoff.md` from this session is not on disk, that's OK — the index.json regeneration can run with `--artifact <any-existing-artifact>` as a smoke check. The important part is the file is on disk + committed.)

---

## M7 done → release

Outputs:
- Version bump 3.0.3 → 3.1.0
- CHANGELOG entry
- `.peaks/memory/peaks-loop-job-introduction.md` sedimented

Final verification gate: ALL 14 ACs pass:

| AC | Where verified |
|---|---|
| AC-1 | M3.1 / M3.2 unit tests |
| AC-2 | M1.1 unit tests + M2 zod validation |
| AC-3 | M4.3 SKILL.md prose + M6.2 E2E |
| AC-4 | M6.2 strict-block E2E |
| AC-5 | M6.2 cross-cycle E2E |
| AC-6 | M6.2 (env-var simulation) |
| AC-7 | M4.3 SKILL.md + future fuzzer |
| AC-8 | M2.2 orchestrator tests |
| AC-9 | M2.2 best-effort tests |
| AC-10 | M7.2 regression suite |
| AC-11 | M4.1 rotation + M6.2 E2E |
| AC-12 | M2.2 single-mode tests + override-journal |
| AC-13 | M5.1 wrapper + M6.3 leak test |
| AC-14 | M3.2 --watch + M5.3 statusline |

Release artifact: `peaks@3.1.0` published (user-initiated `npm publish` per the existing full-auto boundary).
