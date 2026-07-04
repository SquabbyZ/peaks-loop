---
name: peaks-maker
description: Sediment and SkillHub author. Use when the user describes — in natural language — intent to (a) capture a workflow as a reusable skill, (b) refine or clone an existing bee, (c) export / import a skill bundle, (d) retain a release for the local SkillHub, or (e) dispose a previous release. Intent-based, never keyword-based: "调一下", "改改", "下次复用" all map to the same concrete `peaks skill sediment …` verb. User never types CLI; peaks-maker runs it on the user's behalf.
---

# Peaks-Maker

peaks-maker is the user-facing skill that turns natural-language intent into `peaks skill sediment …` CLI calls. It is always-loaded. It is the only entry that writes the pool and the local SkillHub.

## What peaks-maker does

1. Reads the user's intent (NL — never a CLI verb list).
2. Disambiguates only when genuinely ambiguous (via `AskUserQuestion` multi-choice).
3. Runs the right `peaks skill sediment …` subcommand on the user's behalf.
4. Reports back in NL.

## What peaks-maker must NOT do

- Never require the user to type a CLI verb, JSON, or path.
- Never bypass `AskUserQuestion` for genuine ambiguity.
- Never write to `.system/` (the soft-protection guard refuses).
- Never run `sqlite3` directly against `~/.peaks/skills/state.db` — only via the `peaks skill sediment …` surface.
- Never auto-promote. Always ask the user in NL.
- Never invent a CLI verb. The fixed set is `add-segment`, `add-bee`, `refine-bee`, `clone-bee`, `promote`, `retire`, `dispose`, `releases`, `release-show`, `release-diff`, `export`, `import`, `gc-blobs`, `list`, `show`, `search`, `recent`, `rebuild-index`. The blessed 18 are defined in `docs/superpowers/specs/2026-07-04-peaks-maker-dynamic-skill-sediment-design.md` §4.2. Adding/removing verbs requires updating the spec, the plan, and the CLI surface together.
