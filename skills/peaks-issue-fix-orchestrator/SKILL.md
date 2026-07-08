---
name: peaks-issue-fix-orchestrator
description: End-to-end orchestrator that surveys open issues in a target repo, classifies them by difficulty, mines reference merged-PRs, fixes each issue with real commits (with Repository + AI-modified declaration), writes normalized PR description files, and emits a one-line submit script. Use when the user wants to drive a "fix N open issues and prepare PRs" run on an upstream repo (any language; primarily Python + TypeScript). Reuses Loop Engineering primitives: 4-layer asset model, Darwin ratchet, karpathy-engineered red lines, Human-NL-Choice-Only. Triggers on `/peaks-issue-fix-orchestrator`, "fix 30 issues", "dogfood on <repo>", "open-issue sweep on <repo>".
---

# peaks-issue-fix-orchestrator

peaks-issue-fix-orchestrator is the **user-facing skill** that turns a natural-language "dogfood on this repo, fix 30 open issues" request into a reproducible batch fix run. The LLM orchestrates the survey, classification, reference-PR mining, per-batch fix+commit, per-branch relocation, normalized PR body authoring, and submit-script emission. The user only describes a target and picks among a few multi-choice options.

## Loop Engineering role

peaks-issue-fix-orchestrator is a **non-crystallizing orchestrator**. It does **NOT** create `loop_release` / `bee_release` / `crystallization_event` rows in the local SkillHub. Its durable artifact is the git history + the PR body files written inside the **target repo** (the upstream the user wants to fix). A user may optionally run `peaks asset crystallize` AFTER a successful dogfood to capture the orchestrator's workflow as a Loop Engineering asset — but that is a separate, post-run step owned by `peaks-maker`, not this skill.

This non-crystallizing shape is deliberate: the value of a dogfood run lives in the target repo's commits + PRs, not in peaks-loop's own asset pool. Crystallizing the orchestrator itself would conflate "I shipped 28 PRs upstream" with "I want this run to become a reusable skill" — two different user intents, kept on two different timelines.

Reference: the karpathy-engineered red lines that govern every Loop-Engineering-participating peaks-* skill live at `.peaks/standards/loop-engineering-guidelines.md`. peaks-issue-fix-orchestrator honors `RL-1` (Human-NL-Choice-Only), `RL-2` (security-critical-path ban), `RL-3` (AI-modified declaration), and `RL-8` (peaks-code domain boundary — this skill is a code-domain orchestrator).

---

## When to use

Concrete triggers:

- The user says `/peaks-issue-fix-orchestrator` or `peaks issue-fix-orchestrator`.
- "Dogfood on `<owner>/<repo>`" or "open-issue sweep on `<owner>/<repo>`".
- "Fix 30 (or N) open issues" / "prepare PRs for the top open issues" / "ship PRs against upstream".
- A team wants to drive a `simple + medium + hard` difficulty-banded issue sweep on a Python or TypeScript upstream (e.g. NousResearch/hermes-agent, FastAPI, anything in the `good-first-issue`-friendly band).

## When NOT to use

The rubric-banned surfaces — this skill MUST refuse these targets:

- **OAuth / auth / secrets / token / credential-pool** paths (e.g. `tools/mcp_oauth.py`, `agent/auth/*`, anything that mutates a `.env` / keyring / token cache).
- **Agent-loop critical paths**: `agent/conversation_loop.py`, `agent/tool_guardrails.py`, `agent/error_classifier.py` retry-loop interaction.
- **Model router / inference-classifier** surfaces that gate the retry loop.
- **Prompt-cache** surfaces (cache key invalidation logic, cache TTL, OTel propagation that touches the cache).
- **Multi-subsystem refactors** that touch >3 modules or introduce a new public API surface.
- **macOS-only / Windows-only** candidates — replaced with cross-platform alternatives before commit (RL-7).
- Anything that requires a **touch to a security-critical hot path** (auth, secrets, prompt cache, agent loop, model router, tool dispatcher).

If the only available candidates fall in these surfaces, the skill surfaces the skip list with reasons and asks the user to expand the issue source list — it does not bypass the rubric.

---

## Inputs (NL or choice only — RL-1)

The skill accepts exactly **four** trigger forms. Every form resolves via `AskUserQuestion` multi-choice or free-form NL; the user never types a CLI verb or hand-authors JSON.

1. **`user_explicit count`** — "fix 30 issues". The user names the integer. LLM picks the first N after classification.
2. **`difficulty bucket sizes`** — "10 simple + 10 medium + 10 hard". The user picks bucket sizes via multi-choice (`[10/10/10]`, `[5/10/15]`, `[15/5/10]`, `[20/10/0]`).
3. **`scope-bounded count`** — "fix every OpenRouter-credential bug" or "fix every memory-provider bug". LLM filters survey to the user's NL filter, then takes all matching candidates.
4. **`survey-only`** — "just survey, no commits". LLM produces only `01-issue-survey.md` + the rubric skip list; no commits, no PRs.

The user also provides: (a) the upstream `<owner>/<repo>` (NL — "hermes-agent", "FastAPI", etc.); (b) the working directory on disk (LLM derives from `peaks workspace init`); (c) optional `max-diff-lines` cap (default 30).

---

## Default runbook

The 6-step procedure the LLM must follow on every run.

### 1. Anchor + skill marker

```bash
peaks workspace init --project <repo>
peaks skill presence:set peaks-issue-fix-orchestrator
```

### 2. Survey

Three pages of `GET /repos/<owner>/<repo>/issues?state=open&per_page=100` via the public REST API (no auth required). Save the raw JSON to `<plan>/raw/page-1.json`, `raw/page-2.json`, `raw/page-3.json`, plus a per-issue summary table at `<plan>/01-issue-survey.md` Section A.

### 3. Classify

Bucket candidates into 10 simple + 10 medium + 10 hard by the rubric (file scope, blast radius, surface area). Replace any platform-only candidate (macOS-only / Windows-only) with the next available cross-platform alternative — document the swap in `01-issue-survey.md` Section E. List 5+ explicitly-skipped issues with reasons in `01-issue-survey.md` Section D.

### 4. Mine reference PRs

Search the upstream for closed/merged PRs similar to each candidate via `GET /search/issues?q=is:pr+is:merged+<topic>`. Capture per candidate: PR# + title + file paths touched + a 1-line "mimic strategy". Save to `<plan>/02-reference-pr-summary.md`. Cache the raw responses in `raw/ref-pr-<issue>.json` so re-runs do not re-hit the rate limit.

### 5. Fix + commit (per-batch)

Dispatch to sub-agents in three batches: **simple**, **medium**, **hard**. Each sub-agent returns a list of commit SHAs + per-issue file paths. Each commit body MUST include:

```text
fix(<scope>): <short title> (#<NNNNN>)

Repository: https://github.com/<owner>/<repo>
AI-modified: yes
Modifying tool: peaks-loop / peaks-issue-fix-orchestrator
Session: <ISO date>
Reference PR(s): <PR list>

<1-2 paragraph body>

Closes #<NNNNN>
```

- **Author identity** = local gitconfig `user.name` / `user.email`. Must NOT be overridden to an AI name.
- **No** `Co-Authored-By: Claude / Anthropic / MiniMax` trailer — CLAUDE.md red rule.
- Tests: if the touched area has a test, run it before commit; if not, add one. Capture test output in the per-issue PR body.

### 6. Relocate commits to per-issue branches

For each committed fix, cut a per-issue branch from the upstream HEAD and cherry-pick the commit. Example (substitute the real upstream HEAD for `2c0820c9f`):

```bash
git checkout -b fix/<NNNNN>-<slug> 2c0820c9f
git cherry-pick <sha>
git checkout main
```

Then reset `main` to upstream HEAD (do NOT push `--force`). `git log <upstream-HEAD>..main` must be empty at end of run (RL-8).

---

## PR body format

Each PR description file follows the normalized 11-section shape:

```markdown
# fix(<scope>): <short title> (#<NNNNN>)

## Summary
<1-paragraph description of the issue and the user-visible fix>

## Root cause / Scope
<1-paragraph: file(s) + class/function + the path through the bug>

## Fix
<1-paragraph: the change, with code-block snippet if short>

## Tests
<test file paths + a 1-line description of what each test asserts>

## Reference
<the merged PR(s) we mimicked + a 1-line "why this is a good mimic">

**Repository:** https://github.com/<owner>/<repo>
**AI-modified:** yes
**Branch:** fix/<NNNNN>-<slug>
**Issue:** Closes #<NNNNN>

```bash
gh pr create --repo <owner>/<repo> \
  --base main \
  --head <user>:<branch> \
  --title "fix(<scope>): <short title> (#<NNNNN>)" \
  --body-file <plan>/prs/<NNNNN>.md
```
```

Output path: `<repo>/.peaks/_runtime/<sessionId>/peaks-issue-fix-orchestrator/prs/<NNNNN>.md`. One file per issue.

---

## Submit script

A one-line shell script iterates the N `(issue, branch)` pairs and runs `gh pr create` for each. Pre-flight guards:

- `git log --oneline -1 main` must equal the upstream HEAD (refuses to push dirty main).
- `gh auth status` must succeed.

Write to `<repo>/.peaks/_runtime/<sessionId>/peaks-issue-fix-orchestrator/push-all-prs.sh` with a `#!/usr/bin/env bash` shebang, `set -euo pipefail`, and a per-PR call:

```bash
gh pr create --repo <owner>/<repo> \
  --base main \
  --head <user>:<branch> \
  --title "fix(<scope>): <short title> (#<NNNNN>)" \
  --body-file "<plan>/prs/<NNNNN>.md"
```

Append each PR URL to `<repo>/.peaks/_runtime/<sessionId>/peaks-issue-fix-orchestrator/push-all-prs.log`.

---

## Red lines (karpathy 4-section form)

Each red line is written in the karpathy 4-section form (Failure modes / Rewrite / Self-check / Out-of-scope). The skill refuses to advance past any red line violation.

### RL-1 — Human-NL-Choice-Only

**Failure modes.** User is asked to hand-fill JSON or type a CLI verb; user pushed into schema decisions; user accepts opaque recommendations by default.

**Rewrite.** Every user input is either an `AskUserQuestion` multi-choice pick or free-form NL. The LLM runs the CLI. Forbidden: `peaks issue-fix-orchestrator survey`, `peaks issue-fix-orchestrator submit`, `peaks issue-fix-orchestrator fix`.

**Self-check.** Did any step require the user to type a verb? Is every choice expressible in NL? Does every recommendation include an evidence brief? Does the skill still gate every CLI invocation through the LLM?

**Out-of-scope.** Machine-driven CI flows; emergency security gates (LLM + red lines take over; user is informed in NL).

### RL-2 — No commit on a security-critical path

**Failure modes.** A "fix" touches OAuth, secrets, auth, agent loop, model router, tool dispatcher, prompt cache. The rubric-ban list leaks into the run.

**Rewrite.** Survey-banned list is explicit in `01-issue-survey.md` Section D. Forbidden file paths: `tools/mcp_oauth.py`, `agent/auth/*`, `agent/conversation_loop.py`, `agent/tool_guardrails.py`, `agent/error_classifier.py`, `*/prompt_cache*`, `*/token_cache*`.

**Self-check.** Does the candidate's file-path list intersect the banned set? Does the fix mutate any auth/secret/credential-pool keyring? Does the change touch a retry-loop classifier?

**Out-of-scope.** Documentation-only changes to those files (they are banned entirely, doc or not).

### RL-3 — AI-modified declaration

**Failure modes.** Commit silently authored by an LLM with no marker; `Co-Authored-By: <AI name>` trailer sneaks in; future readers cannot tell which commits are AI-modified.

**Rewrite.** Every commit body contains literal lines `Repository: …`, `AI-modified: yes`, `Modifying tool: peaks-loop / peaks-issue-fix-orchestrator`, `Session: <ISO date>`. Forbidden trailers: `Co-Authored-By: Claude`, `Co-Authored-By: Anthropic`, `Co-Authored-By: MiniMax`.

**Self-check.** Does `git show -s <sha> | grep -E 'Repository:|AI-modified:'` return both lines? Is the trailer set empty of AI names?

**Out-of-scope.** Squash merges that preserve only the merged message — the LLM re-applies the body when relocating.

### RL-4 — Reference PR required

**Failure modes.** A fix is invented from whole cloth with no analogue in the upstream history; the fix lands a new pattern that has not survived upstream review.

**Rewrite.** Each candidate has 1-2 reference PRs documented in `02-reference-pr-summary.md` with a 1-line "mimic strategy". The fix follows the reference's pattern, not a novel design.

**Self-check.** Is there a reference PR# listed in `02-reference-pr-summary.md` for this candidate? Does the diff mirror the reference's approach (file, class, helper)? Is the reference PR actually merged (not just closed)?

**Out-of-scope.** Brand-new features with no analogue upstream — those are out of scope for this skill.

### RL-5 — Test before commit

**Failure modes.** A fix lands without a regression test; a fix breaks an existing test; the touched area has a test suite and the LLM never ran it.

**Rewrite.** If the touched area has a test, run it before commit. If not, add one. Captured test output is pasted in the per-issue PR body under `## Tests`.

**Self-check.** Did the test command exit 0? Did the new test fail without the fix (proves the test catches the bug)? Is the test file path listed in the PR body?

**Out-of-scope.** Pure-documentation fixes with no behavior change (RL-5 is satisfied vacuously).

### RL-6 — One commit per issue

**Failure modes.** Fixup commits, squashed histories, multi-issue commits, ambiguous 1:1 mapping between issue → branch → commit → PR.

**Rewrite.** The submit script maps 1:1 issue → branch → commit → PR. Each branch has exactly 1 commit on top of the upstream HEAD. No `--amend`, no `git reset --soft` + re-commit cycles, no squash.

**Self-check.** Does `git log <upstream-HEAD>..<branch>` show exactly 1 commit? Does the commit body mention exactly 1 issue number in `Closes #<N>`?

**Out-of-scope.** Multi-issue umbrella PRs — those go through `peaks-rd`, not this skill.

### RL-7 — Cross-platform candidates only

**Failure modes.** A macOS-only or Windows-only candidate slips through; the fix is platform-locked and useless to other users.

**Rewrite.** Platform-only candidates (`macos-only`, `windows-only`, `pulseaudio-bridge`, `terminal.app-*`, `wsl-*`) are replaced with cross-platform alternatives before commit. The replacement is explicit in `01-issue-survey.md` Section E.

**Self-check.** Does the candidate's `os` label intersect the platform-only set? If yes, is there a replacement listed in Section E? Does the replacement touch zero platform-specific subsystems?

**Out-of-scope.** Genuinely platform-bound issues that have no cross-platform analogue — those are deferred, not fixed.

### RL-8 — `main` is never polluted

**Failure modes.** Fix commits land on `main`; an accidental `git push origin main` pollutes upstream; the user's fork diverges from the upstream HEAD.

**Rewrite.** All dogfood work lands on per-issue branches cut from the upstream HEAD. `main` is reset to upstream HEAD at end of run. `git log <upstream-HEAD>..main` is always empty.

**Self-check.** Is `main` at the upstream HEAD SHA? Is the per-issue branch's only parent the upstream HEAD? Did the script ever `git push origin main`?

**Out-of-scope.** Squash-merge back into `main` on the user's local fork — that is the user's choice, not this skill's.

---

## Boundaries

What this skill MUST NOT do:

- **Push without explicit user confirmation** — the submit script is written but not run by default.
- **Force-push** (`git push --force`, `git push --force-with-lease`) to any branch.
- **Edit upstream history** (no interactive rebase, no `git filter-branch`, no commit signing on someone else's behalf).
- **Write to security-critical paths** (OAuth, secrets, agent loop, model router, prompt cache — see RL-2).
- **Change the user identity** in git (no `git config user.name "Claude"`, no `git -c user.email=...` override).
- **Add `Co-Authored-By: <AI>` trailers** — CLAUDE.md red rule.
- **Hand-author JSON or SKILL.md on the user's behalf** when the user is just describing a target.
- **Create a `loop_release` / `bee_release` / `crystallization_event`** in peaks-loop's own SkillHub (this is a non-crystallizing orchestrator; see "Loop Engineering role").

---

## Audit (reproducibility)

The 5-line verification block the user can run after a dogfood session:

```bash
git -C <repo> log --oneline -1 main                                  # must be upstream HEAD
git -C <repo> log --oneline <upstream-HEAD>..main                    # must be empty
git -C <repo> branch --list | grep -c '^  fix/'                      # must equal N
ls <repo>/.peaks/_runtime/<sessionId>/peaks-issue-fix-orchestrator/prs | wc -l   # must equal N
git -C <repo> show -s fix/<branch> | grep -E 'Repository:|AI-modified:'   # every commit must have both
```

If any line returns an unexpected value, the run has been mutated externally; the per-issue PR body files + the `00-FINAL-AUDIT.md` are the source of truth.

---

## First-class outputs

The skill produces the following files for the user to verify:

- `<repo>/.peaks/_runtime/<sessionId>/peaks-issue-fix-orchestrator/01-issue-survey.md` — survey + classification + skip list + replacement table.
- `<repo>/.peaks/_runtime/<sessionId>/peaks-issue-fix-orchestrator/02-reference-pr-summary.md` — per-candidate reference PRs + mimic strategy.
- `<repo>/.peaks/_runtime/<sessionId>/peaks-issue-fix-orchestrator/03-replacement-candidates.md` — macOS-only / Windows-only swap log.
- `<repo>/.peaks/_runtime/<sessionId>/peaks-issue-fix-orchestrator/00-FINAL-AUDIT.md` — final audit (per-issue, per-concern).
- `<repo>/.peaks/_runtime/<sessionId>/peaks-issue-fix-orchestrator/prs/<NNNNN>.md` — N normalized PR description files (one per issue).
- `<repo>/.peaks/_runtime/<sessionId>/peaks-issue-fix-orchestrator/push-all-prs.sh` — the one-line submit script (NOT run by default).
- `<repo>/.peaks/_runtime/<sessionId>/peaks-issue-fix-orchestrator/raw/page-{1,2,3}.json` — cached GitHub API responses.
- `<repo>/.peaks/_runtime/<sessionId>/peaks-issue-fix-orchestrator/raw/ref-pr-<issue>.json` — cached reference PR responses.
- N `fix/<NNNNN>-<slug>` branches on the user's local fork, each with exactly 1 commit on top of the upstream HEAD.