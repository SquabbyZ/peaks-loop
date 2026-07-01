---
name: gateguard-vs-peaks-qa-fact-forcing-conflict
description: When peaks-qa edits .peaks/_runtime/<sid>/qa/requests/*.md via Edit/Write and gateguard-fact-force is installed, the LLM gets a 4-fact questionnaire that does not apply. peaks-loop is NOT the source of the hook. Doctor has a new check.
metadata:
  type: project
---

> Source: peaks-loop repo, observed 2026-06-10 by user `smallMark` while a colleague `yuanyuan` was running peaks-loop 1.3.9 in `react-prompt-editor`. Captured as a project memory so future LLM sessions don't waste context re-diagnosing the same Image-style error.
> Scope: applies to any project that uses peaks-loop skills AND has the `gateguard-fact-force` (ECC_GATEGUARD) hook installed in `~/.claude/settings.json` or project `.claude/settings.json`. Reading: read this **before** editing any `.peaks/_runtime/<sid>/qa/requests/*.md` file, AND when the LLM reports an `[Fact-Forcing Gate]` error from a PreToolUse hook.

## What the user actually saw (the Image)

```text
Error: [Fact-Forcing Gate]
Before editing /Users/yuanyuan/Desktop/react-prompt-editor/src/components/PromptEditor/Node.tsx, present these facts:
  1. List ALL files that import/require this file (use Grep)
  2. List the public functions/classes affected by this change
  3. If this file reads/writes data files, show field names, structure, and date format
  4. Quote the user's current instruction verbatim
Present the facts, then retry the same operation.
```

This is **NOT** a peaks-loop error. Three pieces of evidence:

1. `grep -rni "Fact-Forcing\|FactForcing\|fact-forcing\|factForcing"` over `src/ skills/ .claude/ dist/ node_modules/` and the entire git history (all branches, all commits, all stashes) returns **zero hits** in this repo.
2. `peaks gate enforce` real deny output is the `Blocked by Peaks gate(s): SOP "<id>" phase "<phase>": <gates>. ... peaks gate bypass --sop ... --phase ... --reason "..."` format from `src/services/sop/gate-enforce-service.ts:121` — zero overlap with the Image's text.
3. `peaks hook handle` (`src/cli/commands/hook-handle.ts:90`) only acts on `toolName === 'Bash'`. Edit / Update / Write / Read all go straight to `formatDecisionResponse(ide, 'allow')`. The peaks hook **cannot** fire on Edit, so the Image's "Before editing" message is by construction **not** peaks.

The Image is from the `gateguard-fact-force` hook in **ECC_GATEGUARD** (third-party), installed in `~/.claude/settings.json` or `<project>/.claude/settings.json`. It fires on `Edit|Write|MultiEdit` matchers and demands a 4-fact questionnaire before allowing the edit.

## Why the 4 facts do not apply to peaks-qa envelopes

`peaks-qa` writes `.peaks/_runtime/<sid>/qa/requests/*.md` and other `.peaks/**` artifacts via:

- `peaks request init --apply` (CLI-writes, not LLM-Edit) — does NOT trigger gateguard
- `peaks workflow plan read|refresh|detect-trigger` — same
- LLM `Edit` / `Update` to the same file (e.g. to add a verdict, append an acceptance check, paste a CLI command) — **does** trigger gateguard

For a markdown QA envelope, the 4 questions collapse to:

| # | Question | Answer for a `.peaks/.../qa/requests/*.md` |
|---|---|---|
| 1 | List ALL files that import/require this file | **none** — `grep` returns 0 hits; QA envelopes are not imported by any code |
| 2 | List the public functions/classes affected | **none** — QA envelopes are not source code, no exported symbols |
| 3 | If this file reads/writes data files, show field names | **n/a** — QA envelopes are pure markdown reports, no structured data read/write |
| 4 | Quote the user's current instruction verbatim | **already in the conversation context** — but the hook forces a re-quote, which the LLM cannot always do |

So the hook fires on every Edit of a QA envelope, asks 4 inapplicable questions, the LLM answers, the Edit retries, and the workflow stalls. This is the silent-stall failure mode the user reported.

## How peaks-loop responds (slice 026 design + impl)

The chosen scope was deliberately minimal — peaks-loop is **not** the source, so it shouldn't be patched. Concretely:

1. **A new doctor check** — `integration:gateguard-peaks-conflict` in `src/services/doctor/doctor-service.ts:476-545`. Probe reads `~/.claude/settings.json` + project `.claude/settings.json`, scans PreToolUse entries for `gateguard` / `fact-force` / `fact_force` needles, returns ok:false when detected without a `.peaks/**` skip. Probe is injected via `options.gateguardProbe` so tests don't depend on real `~/.claude/`. Test coverage: 5 cases (no gateguard / gateguard without skip / gateguard with skip / uninitialized project / project-only hook) — all green.
2. **Schema extension** — `schemas/doctor-report.schema.json` pattern now accepts `integration:<target>` ids; `doctor-self:check-id-pattern` self-check still passes for the new id.
3. **SKILL.md pre-flight** — `skills/peaks-qa/SKILL.md` will gain a top-of-skill "If you see `[Fact-Forcing Gate]` mid-edit, run `ECC_DISABLED_HOOKS=pre:edit-write:gateguard-fact-force` first" red line. (Pending edit in this slice.)
4. **Memory** — this file. Future LLM sessions, when they see the Image, will match the keyword `gateguard` and skip the 30-minute "is this peaks-loop?" rabbit hole.

## Short-term workaround (use this until the gateguard author ships a fix)

```bash
# Disable the gateguard-fact-force hook for the current shell
ECC_DISABLED_HOOKS="pre:edit-write:gateguard-fact-force"
# OR turn off the whole gateguard system
ECC_GATEGUARD=off
```

Both env vars are read by the gateguard binary, not peaks-loop. peaks-loop's `peaks gate enforce` is unaffected.

## Long-term fix (ask the gateguard author to ship a skip-list)

```javascript
// hook-side pseudo-code
if (tool_input.file_path.startsWith(`${process.cwd()}/.peaks/`)) {
  // .peaks/ is peaks-loop + LLM internal product, not user production code
  return;
}
```

The gateguard author is **not** the peaks-loop maintainer — peaks-loop cannot ship a fix to gateguard's source. The fix must land in the gateguard repo. Until then, peaks-loop's doctor check warns the user at `peaks doctor` time so they can pre-emptively set `ECC_DISABLED_HOOKS`.

## How to apply (for future LLM sessions / agents)

1. **If you see `[Fact-Forcing Gate]` while editing a file under `.peaks/_runtime/...`**: it is gateguard, not peaks. Suggest `ECC_DISABLED_HOOKS=pre:edit-write:gateguard-fact-force` to the user and continue. Do **not** debug peaks-loop gate-enforce / hook-handle code.
2. **If the user reports the same error in a different project**: still gateguard, still not peaks. Cross-check the file path is `.peaks/**` and the user has gateguard installed.
3. **If `peaks doctor --json` shows `integration:gateguard-peaks-conflict: ok=false`**: surface the workaround env var, do **not** patch peaks-loop to also fire on Edit/Write (would be a regression — peaks-loop's hook is intentionally Bash-only per `gate-enforcement-hook.md` memory).
4. **If the user asks "can peaks-loop fix the gateguard error?"**: answer **no** — gateguard is out of repo. The peaks-loop surface for this is the doctor check, not a CLI bypass.

## Why this is additive, not a replacement

The `gate-enforcement-hook.md` memory covers peaks-loop's own Bash gate. This file covers the **non-peaks** hook that sometimes shadows it on Edit/Write. The two are independent: peaks-loop's gate still denies Bash commands when an SOP guard matches; gateguard still demands facts on Edit/Write. Dogfood on the current repo: `peaks doctor --json` shows `integration:gateguard-peaks-conflict: ok=true` because the local `~/.claude/settings.json` has no gateguard entry.
