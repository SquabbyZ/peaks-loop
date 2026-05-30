---
name: peaks-sop
description: Authoring skill for user-defined SOPs (standard operating procedures) in Peaks. Use when a user wants to create, edit, debug, or register their own workflow — ordered phases plus gates that block advancement — by describing it in natural language instead of hand-writing JSON or memorizing CLI commands.
---

# Peaks-Cli SOP Authoring

Peaks-Cli SOP turns a natural-language workflow description into a validated, registered custom SOP, then helps the user debug it until each gate behaves as intended. The user describes the process in plain language; this skill drives the `peaks sop` CLI on their behalf — they never have to hand-write `sop.json` or remember the command sequence.

## Skill presence (MANDATORY first action)

Before any analysis or tool call, immediately run:

```bash
peaks skill presence:set peaks-sop --project <repo> --mode <mode> --gate startup
```

On the first presence:set in a project, ensure the out-of-band status bar is installed so the user can see Peaks is orchestrating:

```bash
peaks statusline install --project <repo>   # idempotent; skips if already installed
```

Read persistent project memory via CLI:

```bash
peaks project memories --project <repo> --json
```

Then display: `Peaks-Cli Skill: peaks-sop | Peaks-Cli Gate: startup | Next: <one short action>`. Update with `peaks skill presence:set peaks-sop --project <repo> --mode <mode> --gate <gate>` when gates change. When the SOP is registered and the user is satisfied, run `peaks skill presence:clear --project <repo>`.

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
| `grep` | `file` + `pattern` | the regex matches in the file |
| `command` | `run` (argv array) + `expectExitZero` | the command exits as expected |

`command` gates run user-defined processes and are **refused by default** — they require explicit `--allow-commands`, run with no shell (argv array, no injection), a timeout, and cwd pinned to the project. Always tell the user when a SOP needs `--allow-commands` and why.

## Default runbook

The default sequence this skill executes on the user's behalf. The natural-language → generate → debug loop IS this runbook.

```bash
# 0. confirm this skill's own runbook integrity, then announce presence
peaks skill runbook peaks-sop --json
peaks skill presence:set peaks-sop --project <repo> --gate startup

# 1. interview the user, then scaffold the SOP (preview first, then apply)
peaks sop init --id <sop-id> --name "<human name>" --project <repo> --json
peaks sop init --id <sop-id> --name "<human name>" --project <repo> --apply --json

# 2. write the phases/gates from the interview into .peaks/sops/<sop-id>/sop.json
#    (edit the manifest directly — the user described it in natural language)

# 3. DEBUG LOOP: lint, fix the reported findings, re-lint until clean
peaks sop lint --id <sop-id> --project <repo> --json
peaks sop lint --id <sop-id> --project <repo> --allow-commands --json   # when the SOP uses command gates

# 4. test each gate behaves as intended (pass / fail / blocked)
peaks sop check --id <sop-id> --gate <gate-id> --project <repo> --json

# 5. dry-run the flow to confirm gates block/allow the right phases
peaks sop advance --id <sop-id> --to <phase> --project <repo> --dry-run --json

# 6. register the SOP (preview, then apply) so it joins presence/statusline
peaks sop register --id <sop-id> --project <repo> --dry-run --json
peaks sop register --id <sop-id> --project <repo> --json
peaks sop registry --project <repo> --json

# 7. hand the SOP to the user; clear presence when done
peaks skill presence:clear --project <repo>
```

### Transition verification gates (MANDATORY — run the command, see the output)

You cannot declare a SOP ready from memory. Each gate below is a command you **MUST run** and whose output you **MUST see**.

**Peaks-Cli Gate A — the manifest lints clean before register:**
```bash
peaks sop lint --id <sop-id> --project <repo> --json
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
