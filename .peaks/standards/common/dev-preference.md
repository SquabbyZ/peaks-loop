# Peaks-Loop dev preference (2.0 canonical)

> Project-local preference, captured from the 1.x install + re-rendered with the 2.0 vocabulary.
> Scope: applies to every iteration, adjustment, fix, or tweak on this project.
> Reading: read this **before** opening a new CLI command or routing a new feature through a CLI surface.

## Rule 1 — Skill-first, CLI-auxiliary

When designing or modifying a peaks-loop feature, default to the **skill-first** design. CLI commands are **invoked by the skill prompt** when they are the right primitive: a side effect that must be atomic, a gate that must be machine-enforced, a probe that needs structured JSON, or a backstop that prevents the LLM from skipping a step. Behaviour only an LLM in a skill prompt would use lives **in the relevant skill's SKILL.md**, not as a new CLI command. See `.claude/rules/common/dev-preference.md` for the decision template.

## Rule 2 — Dogfood on every adjustment

**Every adjustment, iteration, or fix-problem operation must be dogfood-tested in the current project before the work is declared complete.** No exceptions for "it's a small change", "just a comment update", or "just a SKILL.md line". The unit test suite is a subset of "current effect"; the dogfood is the full set. If a change passes unit tests but breaks a CLI command, the change is a regression.

## Rule 3 — Commits belong to the human

**No AI co-author trailer.** The commit is the human's. **Identity is global gitconfig only** (`~/.gitconfig`). Do not set, override, or shadow `user.name` / `user.email` at the repo level, via env vars, or via `git -c user.*=...`. The commit's recorded author and committer must both equal the global identity.
