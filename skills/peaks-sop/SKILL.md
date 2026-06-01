---
name: peaks-sop
description: Authoring skill for user-defined SOPs (standard operating procedures) in Peaks. Use when a user wants to create, edit, debug, or register their own gated workflow — ordered phases plus gates that block advancement until conditions are met — by describing it in natural language instead of hand-writing JSON or memorizing CLI commands. DOMAIN-AGNOSTIC: not just software/release flows — equally for content publishing, compliance and approval checklists, data pipelines, onboarding, ops runbooks, or any personal repeatable procedure, wherever "don't enter the next stage until X is true" applies and X is checkable via a file, file content, or a command.
---

# Peaks-Cli SOP Authoring

Peaks-Cli SOP turns a natural-language workflow description into a validated, registered custom SOP, then helps the user debug it until each gate behaves as intended. The user describes the process in plain language; this skill drives the `peaks sop` CLI on their behalf — they never have to hand-write `sop.json` or remember the command sequence.

**This is a general workflow-gating tool, not a developer-only tool.** A SOP is any repeatable process with ordered stages where you must not skip ahead until conditions are met. Software release is just one example; content publishing, compliance/approval checklists, data validation pipelines, employee onboarding, ops runbooks, and personal procedures are all first-class — often the more valuable use. When you interview the user, do not assume code: ask about *their* process in *their* domain.

## What to tell the user BEFORE running any command

This skill helps you create, test, and enforce a repeatable workflow (a "SOP")
with gates that physically block advancement until conditions are met. It works
for ANY domain — content publishing, compliance, onboarding, data pipelines,
software releases, personal procedures.

Before you run `peaks skill presence:set` or any other setup command, tell the
user (in your own words, one or two sentences):

  "I'll help you turn your process into a Peaks SOP — ordered stages plus gates
   that make sure you never skip a step. I'll interview you about your workflow,
   generate the definition, test it, and register it. Ready?"

If the user has never used Peaks before, offer a 30-second demo:

  "Want me to create a quick demo SOP first? It takes 30 seconds — I'll
   scaffold one, show you how a gate blocks, then we can replace it with your
   real workflow."

When they accept, use `demo-sop` as the id (NOT `peaks-sop` — the `peaks-` prefix
is reserved), name it "Demo SOP", make two phases (draft → done), one gate
(file-exists README.md), then run the full init→lint→check→register→hooks
install flow so they see the whole thing. Then offer to replace it with their
real process.

## Skill presence (MANDATORY first action — run AFTER telling the user what you're doing)

If the user invoked this skill directly ("peaks-sop") without mentioning a
specific project, assume `--project .` (current directory). If they are NOT in
the middle of a multi-skill peaks-solo/prd/rd/qa pipeline, skip `statusline
install` — the status bar is for long-running orchestrations; a standalone SOP
authoring session does not need it.

```bash
peaks skill presence:set peaks-sop --project <repo> --mode <mode> --gate startup
peaks project memories --project <repo> --json
```

Then display: `Peaks-Cli Skill: peaks-sop | Peaks-Cli Gate: startup | Next: <one short action>`. Update gates with `peaks skill presence:set peaks-sop --project <repo> --mode <mode> --gate <gate>` when they change. When the SOP is registered and the user is satisfied, run `peaks skill presence:clear --project <repo>`.

## Responsibilities

- interview the user to turn a natural-language workflow into ordered **phases** and the **gates** that guard entry into each phase;
- generate a valid SOP manifest (`sop.json`) and the registrable `SKILL.md` via the CLI — never make the user hand-author JSON;
- run the lint → fix → re-lint debug loop until the manifest is clean;
- test each gate (pass/fail/blocked) and dry-run advancement so the user sees the SOP behave before committing;
- register the SOP so it joins skill presence / statusline like a built-in skill;
- explain the three gate types and the security posture of command gates.

## What a SOP is (explain this to the user)

A SOP is an **ordered list of phases** plus **gates** bound to phases. A gate that does not pass blocks advancement into its phase — this is how "don't drop steps" applies to the user's own workflow. The SOP lives at `.peaks/sops/<sop-id>/` (manifest `sop.json` + a registrable `SKILL.md`). Gate checks come in three types:

| type | fields | passes when |
|------|--------|-------------|
| `file-exists` | `path` | the file exists (path pinned inside the project) |
| `grep` | `file` + `pattern` (+ `absent`) | the regex matches in the file — or, with `absent: true`, does NOT match |
| `command` | `run` (argv array) + `expectExitZero` | the command exits as expected |

Prefer **`grep` with `absent: true`** for any "must not contain X" gate (no leftover `TODO`, no placeholder, no unresolved marker). It is a pure-text check — no `--allow-commands`, cross-platform, no shell. Reach for a `command` gate only when the check genuinely needs to run a program.

`command` gates run user-defined processes and are **refused by default** — they require explicit `--allow-commands`, run with no shell (argv array, no injection), a timeout, and cwd pinned to the project. Always tell the user when a SOP needs `--allow-commands` and why.

### Where SOP files live (two definition layers, per-project execution)

A SOP *definition* (manifest + SKILL.md) can live in two layers:
- **Global** `~/.peaks/sops/<sop-id>/` — your personal SOPs, reusable across every project. `init` / `lint` / `register` default here (no `--project`).
- **Project** `<project>/.peaks/sops/<sop-id>/` — **committed into the repo**, so a teammate who clones it gets the SOP (and, with the hook installed, is enforced). Pass `--project <repo>` to `init` / `lint` / `register` to use this layer.

The **project layer takes precedence** over global for the same id. Execution reads see the merged view (project wins). A SOP's *run-state* (current phase, history) is always **per-project**: `<project>/.peaks/sop-state/<sop-id>/`. `check` / `advance` take `--project` (default: current directory) to say which project the gates evaluate against, whose progress advances, and which definition layer wins.

`advance` also enforces **phase order**: you may re-enter the current phase, step back, or move to the immediately-next phase, but not skip ahead — a forward jump returns `SOP_PHASE_SKIP` (bypassable, like a gate, with `--allow-incomplete --reason`).

### Where SOPs apply (lead with the user's domain, not code)

The three gate primitives are domain-neutral, so the same engine governs very different workflows:

| domain | phases (example) | gate idea |
|--------|------------------|-----------|
| content / publishing | draft → edit → publish | `file-exists` the draft; `grep` no `TODO`/`TKTK`; `command` runs a spell/word-count check |
| compliance / approval | prepare → review → sign-off | `file-exists` `approval.md`; `grep` the doc contains "Approved" |
| data pipeline | raw → cleaned → validated | `command` runs a validator script that exits 0 |
| onboarding / ops | request → provision → done | `file-exists` each checklist artifact; `command` verifies a config |
| personal procedure | any repeatable steps | whatever "don't forget step X" means, expressed as a file/grep/command |

The one boundary to explain: a gate must reduce to **a file existing, text matching in a file, or a command's exit code**. A purely human-judgment gate ("did the editor approve?") is expressed by reifying it into a signal — e.g. require an `approved.md` file, or that a status file contains "approved". The `command` gate is the universal adapter for anything scriptable.

## Un-bypassable enforcement (optional, opt-in)

By default a SOP gate only blocks the `peaks sop advance` command — nothing forces the agent through it. To make a gate **physically un-bypassable**, a SOP can declare **guards** that bind a concrete irreversible Bash action to a phase, and the user installs a PreToolUse hook:

```jsonc
// in sop.json
"guards": [ { "phase": "publish", "bash": "git +push" } ]
```
Meaning: running a Bash command matching `git +push` IS entering the publish phase, so publish's gates must pass first. Then:

```bash
peaks hooks install --project <repo>     # explicit, opt-in; writes one PreToolUse entry
```

Now when the agent tries `git push` while the publish gate fails, Claude Code receives `permissionDecision: "deny"` and the command is blocked **before any permission check — it holds even under `--dangerously-skip-permissions`**. CI only blocks at merge; CLAUDE.md instructions are advisory; this blocks in-conversation and cannot be skipped.

- `bash` is a **JS regex inside JSON** — escape backslashes (`"git\\s+push"`) or just use `"git +push"`. `peaks sop lint` rejects an invalid regex (`GUARD_INVALID_PATTERN`).
- Emergency override: `peaks gate bypass --sop <id> --phase <phase> --reason "<why>"` records a **one-shot** token consumed by the next blocked command (capped per project per SOP, reason audited).
- Trust: enforcement **fails open** — any internal error allows the command (a Peaks bug never bricks Claude Code); only a real gate failure denies. Installing the hook is an explicit user command; this skill never writes `settings.json` itself.
- `peaks hooks status` / `peaks hooks uninstall` manage the hook.

> Team enforcement: register the SOP into the **project layer** (`peaks sop init/register --project <repo>`) so the definition is committed in the repo. A teammate who clones it — even with an empty global `~/.peaks` — is enforced by the same gates once they install the hook. (A SOP that lives only in your global `~/.peaks` enforces only on your machine.)

## Default runbook

The default sequence this skill executes on the user's behalf. The natural-language → generate → debug loop IS this runbook.

```bash
# self-check (required by doctor; no user-visible effect)
peaks skill runbook peaks-sop --json

# 1. interview the user FIRST (before any scaffold): what are the ordered stages?
#    For each stage, what must be true before entering it? Translate answers into
#    file-exists / grep / grep-absent / command gates.

# 2. scaffold the SOP based on the interview (preview first, then apply)
#    definitions are global (~/.peaks/sops) — init/lint/register take no --project
peaks sop init --id <sop-id> --name "<human name>" --json
peaks sop init --id <sop-id> --name "<human name>" --apply --json

# 3. write the phases/gates from the interview into ~/.peaks/sops/<sop-id>/sop.json
#    (edit the manifest directly — the user described it in natural language)

# 4. DEBUG LOOP: lint, fix the reported findings, re-lint until clean
peaks sop lint --id <sop-id> --json
peaks sop lint --id <sop-id> --allow-commands --json   # when the SOP uses command gates

# 5. test each gate behaves as intended (pass / fail / blocked) against a project
peaks sop check --id <sop-id> --gate <gate-id> --project <repo> --json

# 6. dry-run the flow to confirm gates + phase order block/allow the right phases
peaks sop advance --id <sop-id> --to <phase> --project <repo> --dry-run --json

# 7. register the SOP (preview, then apply) so it joins presence/statusline
peaks sop register --id <sop-id> --dry-run --json
peaks sop register --id <sop-id> --json
peaks sop registry --json

# 8. (optional) make a gate un-bypassable: declare guards in sop.json, then install the hook
peaks hooks install --project <repo>
peaks hooks status --project <repo>
#    emergency one-shot override when a guarded action must proceed despite a failing gate:
peaks gate bypass --sop <sop-id> --phase <phase> --reason "<why>" --project <repo>

# 9. hand the SOP to the user; clear presence when done
peaks project memories:extract --session-id <session-id> --project <repo> --json  # extract durable memories
peaks skill presence:clear --project <repo>
```

### Transition verification gates (MANDATORY — run the command, see the output)

You cannot declare a SOP ready from memory. Each gate below is a command you **MUST run** and whose output you **MUST see**.

**Peaks-Cli Gate A — the manifest lints clean before register:**
```bash
peaks sop lint --id <sop-id> --json
# Expected: ok:true. If ok:false, fix the findings and re-lint — do NOT register a SOP that does not lint.
```

**Peaks-Cli Gate B — gates behave as intended before handing off:**
```bash
peaks sop check --id <sop-id> --gate <gate-id> --project <repo> --json
# Confirm each gate returns the verdict the user expects (pass on the good state, fail/blocked otherwise).
```

## Debugging guidance

When `sop lint` reports findings, fix them in `sop.json` and re-lint — common findings: duplicate gate id, gate bound to an undefined phase, missing check fields, or a command gate without `--allow-commands`. When `sop check` returns `blocked`, the check could not be evaluated (path escaped the project, target file unreadable, command not permitted or failed to spawn) — distinct from `fail` (evaluated, condition not met). Use `sop advance --dry-run` to confirm the blocking behaves before any real advance.

Concrete manifest reference, gate cookbook, and the debug loop: `references/sop-authoring.md`.

## Boundaries

Do not implement the user's business code, run their real release, or modify runtime configuration. This skill authors and validates the SOP definition; the SOP's gates then govern the user's own workflow. `command` gates execute user-defined commands only with explicit `--allow-commands` consent. Do not register a SOP that does not lint clean.
