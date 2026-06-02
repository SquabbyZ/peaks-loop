# Peaks-Cli dev preference: skill is primary, CLI is auxiliary

> Source: project-local preference, captured 2026-06-02 from the user.
> Scope: applies to every iteration and bug-fix on the peaks-cli repo, and to any project that uses peaks-cli skills.
> Reading: read this before opening a new CLI command or routing a new feature through a CLI surface.

## Rule

When designing or modifying a peaks-cli feature, default to the **skill-first** design:

- The user flow lives in the skill's `SKILL.md` (e.g. `peaks-solo`, `peaks-txt`, `peaks-rd`, `peaks-qa`, `peaks-sc`, `peaks-prd`, `peaks-sop`).
- CLI commands are **invoked by the skill prompt** when they are the right primitive: a side effect that must be atomic, a gate that must be machine-enforced, a probe that needs structured JSON, or a backstop that prevents the LLM from skipping a step.
- **Do not open new CLI commands** just because "the LLM might need this" — if the LLM is the only consumer, encode the behaviour in the skill prompt.

A new CLI command is justified only when at least one of these is true:

1. The action must be invokable from a hook / script / CI (e.g. `peaks hooks install`, `peaks sc validate`).
2. The action must produce a structured (JSON) response that the skill reads back to gate a downstream decision (e.g. `peaks request show ... --json`, `peaks scan archetype ... --json`).
3. The action is a destructive side effect that needs an explicit `--apply` opt-in (e.g. `peaks openspec archive --apply`, `peaks memory extract --apply`).

If none of (1)(2)(3) holds, route the change into the relevant skill's `SKILL.md` instead.

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

When the answer is "1 yes, 2+3 no", **do not** add the CLI command. When 2 or 3 is yes, the CLI is the right surface.

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
