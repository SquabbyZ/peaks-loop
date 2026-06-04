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
