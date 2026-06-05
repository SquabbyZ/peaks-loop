# Peaks-Cli dev preference: skill is primary, CLI is auxiliary

> Source: project-local preference, captured 2026-06-02 from the user.
> Scope: applies to every iteration and bug-fix on the peaks-cli repo, and to any project that uses peaks-cli skills.
> Reading: read this before opening a new CLI command or routing a new feature through a CLI surface.

## Rule

When designing or modifying a peaks-cli feature, default to the **skill-first** design:

- The user flow lives in the skill's `SKILL.md` (e.g. `peaks-solo`, `peaks-txt`, `peaks-rd`, `peaks-qa`, `peaks-sc`, `peaks-prd`, `peaks-sop`).
- CLI commands are **invoked by the skill prompt** when they are the right primitive: a side effect that must be atomic, a gate that must be machine-enforced, a probe that needs structured JSON, or a backstop that prevents the LLM from skipping a step.
- **Default-no on new CLI commands.** This is a leaning, not a hard ban. The user has been explicit: "非必要不添加新的 CLI，不是卡死不添加新的 CLI" — the burden of justification sits on the proposer. See user auto-memory `feedback_peaks_skill_default_no_new_cli.md` for the operational form of this rule.

A new CLI command is justified only when at least one of these is true:

1. The action must be invokable from a hook / script / CI (e.g. `peaks hooks install`, `peaks sc validate`).
2. The action must produce a structured (JSON) response that the skill reads back to gate a downstream decision (e.g. `peaks request show ... --json`, `peaks scan archetype ... --json`).
3. The action is a destructive side effect that needs an explicit `--apply` opt-in (e.g. `peaks openspec archive --apply`, `peaks memory extract --apply`).
4. The action is a machine-enforced gate that prose cannot enforce (e.g. the SOP `peaks gate enforce` mechanism — without it the rule can be bypassed).

If none of (1)(2)(3)(4) holds, **do not add the CLI command**. Encode the behaviour in the relevant skill's `SKILL.md` instead. When 1 or 2 is yes, the CLI is the right surface; when 4 is yes, the CLI is the only way to honour the rule.

## Why

peaks-cli's product is the *skill family*. The CLI exists to make those skills trustworthy: a hook cannot enforce a gate that lives in prose, and a structured-JSON response cannot replace a prompt template. Conflating the two surfaces (e.g. shipping a new `peaks memory scan` because "the LLM needs to find blocks") collapses the difference between "primitives the skill composes" and "the product itself", and the LLM ends up orbiting CLI commands instead of running the workflow.

## Inverse rule (cross-reference)

When a skill's `SKILL.md` says something is **MANDATORY** / **BLOCKING** / "must not skip", there must be a CLI command (or hook) behind it that physically enforces the rule. Prose-only enforcement gets bypassed in practice. This is the converse of the rule above: skill-first for *workflow*, CLI-backed for *gates*.

See: `feedback_skill_red_lines_need_cli_backing.md` (auto memory).

## Decision template for PRs / commits

When proposing a new `peaks <cmd>`:

> I'm going to add `peaks <X>` to do <Y>. Answer in the PR body:
>
> 1. Is the only consumer an LLM in a skill prompt? If yes, encode in the skill instead.
> 2. Does this need to be invokable from a hook / script / CI? If yes, the CLI is justified.
> 3. Does the skill need a structured (JSON) response to gate a downstream decision? If yes, the CLI is justified.
> 4. Is this a machine-enforced gate that prose cannot enforce? If yes, the CLI is justified.

When the answer to (1) is "yes" and the answer to (2)(3)(4) is "no", **do not** add the CLI command. When (2), (3), or (4) is yes, the CLI is the right surface. This is a leaning, not a hard ban: the user has been clear that "非必要不添加新的 CLI，不是卡死不添加新的 CLI".

## Examples (in this repo)

| Command | Justified because |
|---|---|
| `peaks workspace init` | (3) destructive side effect with `--apply` + (2) JSON envelope that skills read back. |
| `peaks skill presence:set` | (2) writes the file skills read; (3) the active-skill marker is consumed by hooks. |
| `peaks request transition` | (1)+(2) the state machine CLI-enforces type-specific gates; skills read back the verdict. |
| `peaks memory extract` | (3) side effect (`--apply`) + (2) JSON envelope with `writtenFiles` / `extractedCount`. |
| `peaks openspec init` | (3) side effect + (2) JSON plan. Triggered by `peaks-solo` SKILL.md's first-run opt-in AskUserQuestion. |
| `peaks hooks install` | (1) must be invokable from a script / postinstall. |
| `peaks scan archetype` | (2) JSON envelope the entire peaks-* family reads back. |

---

# Peaks-Cli dev preference (additive): dogfood on every adjustment

> Source: project-local preference, captured 2026-06-04 from the user.
> Scope: applies to every iteration, adjustment, fix, or tweak on the peaks-cli repo (and to any project using peaks-cli skills). **Additive** — does NOT replace the rule above. The skill-first / CLI-auxiliary rule still applies; this one layers on top.
> Reading: read this **after** the skill-first rule above, before declaring any change "done".

## Rule

**Every adjustment, iteration, or fix-problem operation must be dogfood-tested in the current project before the work is declared complete.** No exceptions for "it's a small change", "just a comment update", "just a SKILL.md line", or "the test suite already passes". Dogfood is the gate, not a nice-to-have.

Concretely, this means:

1. **Adjustments** (refactors, performance tweaks, file splits, line-count rebalances): after the change, run the relevant CLI / skill on the current repo to prove the user-visible behavior is unchanged OR improved.
2. **Iterations** (subsequent revisions of the same artifact, e.g. "make the SKILL.md section shorter", "rename the helper", "extract a reference"): after the change, run the same dogfood you ran on the previous version, plus one more scenario that exercises the new edge case.
3. **Fix-problem operations** (bugfix, lint-pass, typecheck-fix, "fix the duplicate line", "fix the placeholder", "fix the bash quoting"): after the fix, run the original failing scenario PLUS at least one adjacent scenario that could share the same root cause.

The dogfood must be on **the current project** (the repo where the change landed), not on a synthetic fixture unless the current project is unavailable. If the change is in `skills/peaks-solo/SKILL.md`, the dogfood is `peaks skill runbook peaks-solo --json` + `peaks skill doctor --json` on this repo. If the change is in a service helper, the dogfood is the CLI command that consumes that helper on this repo.

## Why

The LLM is biased toward "the unit test passes, so it must work." But unit tests verify the **shape** of behavior, not the **effect** in the system the user actually uses. Three real failure modes this rule catches:

1. **Stale unit tests after a behavior change.** Slice 002 (`peaks-solo SKILL.md slim`) had the unit test for `skill-runbook-service.test.ts` pass with peaks-solo's runbook, but the runbook's *content* changed (the inline `## Default runbook` section became a 3-line pointer). The test only asserted `peaksCommandCount >= 20`, which passed against the new fallback resolution — but the test never asserted "the inline runbook is the source of truth". A dogfood on the live CLI (`peaks skill runbook peaks-solo --json`) would have caught any regression in the fallback's behavior.
2. **Lint fixes that hide the symptom.** A duplicate-line in `references/runbook.md` (slice 002 LLM extraction artifact) was caught by **code-review L-1**, not by `pnpm vitest run` (which only checks the `## Default runbook` section marker). Lint passes; user-facing artifact is still wrong. Dogfood would have caught the duplicate content even without the review.
3. **"Trivial" changes that aren't.** Slice 003 added ~80 lines to `skills/peaks-solo/SKILL.md`, taking it from 765 → 828 lines — over the 800-line cap. `pnpm vitest run` was green; `pnpm typecheck` was green. The CLI's `request transition` was the only thing that caught it. Dogfood of the SKILL.md on the live repo (e.g. `peaks project dashboard --json` which reads skill presence and runbook health) would have surfaced the cap-overrun before the gate rejected it.

The user's hard rule: "**严格要保证不能比当前的效果差**". The unit test suite is a subset of "current effect". The dogfood is the full set. If a change passes unit tests but breaks a CLI command, the change is a regression — even if the test suite is green.

## How to apply

For every code/skill/config change in this repo, do **all** of the following before declaring the change complete:

1. **Run the relevant test suite.** This is the **minimum**, not the only step. `pnpm vitest run` for source changes; the affected test file only for a 1-file tweak.
2. **Run `pnpm typecheck`.** Mandatory for any TypeScript change.
3. **Run the affected CLI command(s) on the current repo.** Examples:
   - Skill body change → `peaks skill runbook <name> --json` + `peaks skill doctor --json`
   - Project scan change → `peaks scan archetype --project <repo> --json`
   - Workspace change → `peaks workspace init --project <repo> --json` (on a temp dir, not the real one)
   - Memory / standards change → `peaks memory extract --dry-run --json` (or the relevant command's dry-run variant)
4. **Verify the CLI output matches the documented contract.** If the SKILL.md says "this command returns 30 peaks commands", the dogfood must show 30 (not 0, not 25).
5. **Run at least 2-3 scenarios** if the change has multiple code paths. A single "it works on my fixture" is not dogfood; "it works on scenario A, scenario B, and scenario C with the real fixture shapes" is.
6. **If the change introduces a strict no-op guarantee (e.g. "fresh session is zero-cost"), prove the no-op.** A `peaks skill runbook` invocation on a fresh session, then on the in-flight session — both must produce sensible output, and the fresh-session path must have the same number of CLI calls as before the change.

The dogfood output (the actual `peaks ...` command output) goes into the QA test report's `## Test execution` section. Not just "I ran it and it works" — the actual JSON or text the command returned.

## What does NOT count as dogfood

- `pnpm vitest run` only (no CLI invocation on the current repo)
- Running the new test file in isolation (no assertion that the test's fixture shapes match real-world fixture shapes)
- "I'll trust the unit test because it covers the branch" (the unit test is necessary but not sufficient)
- Synthesizing a fake `.peaks/<sid>/` and running the bash script (this is a **fixture test**, not dogfood; dogfood uses the current project's actual state)
- A passing `peaks doctor --json` on a totally different project (the rule is **the current project**)

## Cross-reference

- The unit-test gate (Gate C in `peaks-solo/SKILL.md` → `references/workflow-gates-and-types.md`) is the **floor**. Dogfood is the **ceiling**. The slice is complete when both pass.
- The "red lines need CLI backing" rule (`feedback_skill_red_lines_need_cli_backing.md`) is the converse: when the SKILL.md says MANDATORY, there must be a CLI/hook that enforces it. This rule (dogfood on every adjustment) is the converse: when the SKILL.md says "this CLI returns X", there must be a dogfood run that proves the CLI actually returns X.
- "Long-running validation" (`feedback_long_running_validation.md`) — keep dependent tests/builds foreground or visibly streaming progress, don't background them. Same spirit: don't pretend a change is done without watching the validation finish.

## Examples (in this repo)

| Change | Dogfood that caught (or would catch) a regression |
|---|---|
| `peaks-solo/SKILL.md` slim from 1071 → 765 lines (slice 002) | `peaks skill runbook peaks-solo --json` — would have caught the duplicate-line in the new `references/runbook.md` if the LLM extraction had been wrong |
| `peaks-solo/SKILL.md` add Step 0.7 (slice 003) | 6-scenario dogfood on real fixture shapes (fresh / RD-planning / QA-validation / TXT-handoff / complete / in-flight) — confirmed each classification matches the documented contract |
| `skill-runbook-service.ts` add `loadRunbookSection` fallback (slice 002) | `peaks skill runbook peaks-solo --json` returns `peaksCommandCount: 30` (would be 0 if the fallback silently dropped) |
| Any future SKILL.md line edit | `peaks skill doctor --json` (35 checks) + the affected `peaks skill runbook <name> --json` |

## Why this is additive, not a replacement

The skill-first rule above still governs **what** to build (skill > CLI). This rule governs **how to verify** what was built (dogfood on the current repo, not just unit tests on a fixture). They operate on different axes:

| | What to build | How to verify |
|---|---|---|
| skill-first rule | ✓ governs | (not addressed) |
| dogfood rule | (not addressed) | ✓ governs |

A slice can be skill-first (correct architecture) and still fail dogfood (e.g. the skill body is right but the CLI command it documents is wrong). Both rules must pass before the slice is declared complete.

---

# Peaks-Cli dev preference (additive): commits belong to the human, identity comes from global gitconfig

> Source: project-local preference, captured 2026-06-05 from the user.
> Scope: applies to every `git commit` produced in this repo (and to any project that uses peaks-cli skills). **Additive** — does NOT replace the skill-first rule or the dogfood rule above.
> Reading: read this before running `git commit`, before configuring any `peaks-*` automation that wraps `git commit`, and before adding any LLM-side commit-message generator.

## Rule

Two things, both non-negotiable:

1. **No AI co-author trailer.** Never append `Co-Authored-By: Claude ...` (or any other LLM — Codex, Gemini, Cursor, Copilot, etc.) to a commit message body. The commit is the human's. The git author is the human. The trailer is the human's. Period. The LLM that helped draft the body is implementation detail, not a co-author.
2. **Identity is global gitconfig only.** Every commit must be authored and committed as the user configured in `~/.gitconfig` (i.e. `git config --global user.name` / `user.email`). Do not set, override, or shadow `user.name` / `user.email` at the repo level (`.git/config`), via environment variables (`GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL`, `GIT_AUTHOR_DATE`, `GIT_COMMITTER_DATE`), or via `git -c user.name=... -c user.email=...`. Do not invoke `git commit --author=` or `--config user.*=`. The commit's recorded author and committer must both equal the global identity.

The same applies to automation that produces commits on the user's behalf: a peaks-* skill, a CI bot, a hook, or a `peaks-qa`/`peaks-rd` workflow step that ends in `git commit` must not introduce a different author/committer pair and must not add any AI trailer.

## Why

Two failure modes, both real, both already shipped on this repo:

1. **Trailer pollution.** Eight commits in main (between `a53c210` and `0357c92`, all in 2026-05 → 2026-06) shipped with a `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer. The git author was correct (`zhuhaifeng <18833527317@139.com>`, matching global gitconfig) but the body claimed an AI co-author. The trailer is misleading: it suggests the AI is a contributor to the project, which it is not. `git log --author="Claude"` / `--grep="Co-Authored-By: Claude"` pulls these into AI-attribution dashboards, audit reports, and contributor lists. The user has been clear: "严格要保证不能比当前的效果差" — historical commits must not claim co-authorship they did not earn, and future commits must not introduce new ones.
2. **Identity drift.** Setting per-repo `user.name` / `user.email` (or worse, env vars at the wrapper level) means a user with two machines, two accounts, or a stolen API key can produce commits that look like the wrong person. The global gitconfig is the single source of truth for "who is committing". Repos that silently fall back to env-var identity are repos where `git log` cannot be trusted.

The combination is what makes a repo auditable: every commit has the same human author, no commit claims an AI co-author, and the audit trail (`git log --format=fuller`) is identical on every machine the human works on.

## How to apply

Before any `git commit` invocation, do all of the following:

1. **Sanity-check the active identity.** Run `git config --global user.name` and `git config --global user.email`. Both must be non-empty and must match the user's real identity. If they are empty, **stop** and ask the user to set them — do not guess, do not fall back to env vars, do not write `user@localhost`.
2. **Diff against repo-level and env-level overrides.** Run `git config --list --show-origin | grep -E 'user\.(name|email)'`. The only line for `user.name` and `user.email` must come from `~/.gitconfig`. If `.git/config` or any env var is also set, the local value wins — the LLM must not commit until the override is removed.
3. **Re-verify before `git commit` (not just at session start).** Identity is cheap to re-check; a misconfigured commit is expensive to rewrite. Always run step 1 immediately before `git commit`, not just once at the top of the session.
4. **Do not let the LLM's commit-message template add a trailer.** When the LLM drafts a commit message, strip any AI co-author line it self-generated. Treat the trailer as a build artifact of the model's training, not a legitimate attribution.
5. **Do not introduce per-repo `user.*` overrides to "make a single commit work".** If a commit needs a different identity, the user must explicitly set the global identity (i.e. by editing `~/.gitconfig`), not the repo.
6. **When working in a worktree, the same rules apply.** Worktrees inherit `.git/config` from the main repo, and env vars still shadow gitconfig. Re-run step 2 in every worktree the LLM touches.

## What does NOT count as compliance

- `git config --list` showing the right values once at session start (env vars can be set later in the session)
- Setting `user.name` / `user.email` via `git -c user.name=... commit ...` "just for this one commit" (the override is still in the commit, even if not persisted)
- Adding a `Co-Authored-By: Claude` trailer and then stripping it via `git commit --amend` (the original commit object is gone, but the act of writing it in the first place is the violation)
- "I set GIT_AUTHOR_NAME=... in this shell so the CI bot can commit" (the env-var identity is what gets baked into the commit; this is the failure mode the rule prevents)
- A hook that injects a trailer automatically (the hook is the LLM in disguise; same rule applies)

## Cross-reference

- The skill-first / CLI-auxiliary rule (top of this file) and the dogfood rule (middle) govern **what** to build and **how to verify** it. This rule governs **how the human owns the resulting commit**. All three are additive; none replaces the others.
- The user's global CLAUDE.md already says "Attribution disabled globally via ~/.claude/settings.json" for the Claude-Code environment, but that is a Claude-Code-side disable, not a project-side preference. This rule makes the project-side preference explicit and applies to **any** tool that produces a commit, not just Claude Code.
- The `peaks` skills (peaks-solo, peaks-rd, peaks-qa, peaks-txt) that end in `git commit` MUST follow this rule. If a skill step says "commit the slice", the LLM must verify identity + scrub the trailer as part of that step, not as an afterthought.

## Examples (in this repo)

| Violation caught (or pre-empted) | What the LLM should do instead |
|---|---|
| 8 commits (`a53c210`, `f0fdc95`, `7f726c5`, `763b091`, `1b95505`, `aa2564f5`, `d8f72a8`, `0357c92`) shipped with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer | Do not add the trailer in the first place. Historical cleanup: 2026-06-05 rewrote those 8 commits with `git filter-branch --msg-filter`, preserving author (zhuhaifeng) and removing only the body trailer. Backup ref: `backup/pre-claude-strip-2026-06-05`. |
| `peaks-solo` ends with `git commit` after a 5-step slice; LLM drafts the message | LLM must (a) re-run `git config --global user.email` to confirm identity, (b) strip any AI trailer the LLM's template generated, (c) commit. No per-repo override, no env-var override. |
| A worktree was created with `git worktree add` and `.git/worktrees/<name>/config.worktree` got a stale `user.email` | LLM must `git config --unset user.email` in the worktree config (or refuse to commit) before producing a commit. The global identity must be the only identity. |
| CI bot is asked to commit a release tag from a peaks-sop step | The bot's commit must use the user's identity (read from `~/.gitconfig` or fail loudly), not a `github-actions[bot]@noreply.github.com` env-var identity. If the bot cannot use the user's identity, it must not commit — emit a "human must commit this manually" handoff instead. |

## Why this is additive, not a replacement

The previous two rules govern **what** to build (skill-first) and **how to verify** it (dogfood). This rule governs **who owns the commit** (the human, with their global identity) and **what the commit body must not claim** (no AI co-author). A slice can be skill-first and dogfood-passing and still violate this rule (e.g. the skill body is right, the dogfood passed, but the resulting commit has a `Co-Authored-By: Claude` trailer and was committed with a per-repo email override). All three rules must pass before the slice is declared complete.
