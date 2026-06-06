---
name: peaks-ide
description: Orchestrate peaks-cli's IDE-aware behavior (hooks + statusline + handle) for a user's specific IDE. Detects the current state (which IDE the user is on, what peaks has already installed), plans the install / switch / status / uninstall actions, and invokes the existing peaks CLI primitives. Triggers on `/peaks-ide`, "set up peaks for my IDE", "switch peaks to Trae", "what did peaks install", "uninstall peaks hooks". Sits between the user and `peaks hooks install` / `peaks statusline install` / `peaks hook handle` — those are the CLI primitives; this skill is the user-facing surface.
---

# Peaks-Cli IDE Setup (peaks-ide)

`peaks-ide` is the **user-facing surface** for everything peaks-cli does that's IDE-aware. It does NOT introduce new CLI commands. It orchestrates the existing CLI primitives — `peaks hooks install`, `peaks statusline install`, `peaks hook handle` — based on the user's intent and the IDE the user is on.

**Why this exists (dev-preference red line):** "skill is primary, CLI is auxiliary." The behavior that only an LLM in a skill prompt would use ("detect which IDE the user is on", "plan the migration steps", "ask the user before destructive actions") lives in this SKILL.md, not in a new `peaks <cmd>`. The CLI commands stay as atomic primitives the skill composes.

**Slice #2 scope:** the first version supports Trae (alongside Claude Code, the only other adapter in slice #2's registry). Cursor / Codex / Qoder / Tongyi Lingma will land in slice #3+ — the skill will pick them up automatically because the underlying auto-detect (`peaks detectIdeFromContext`) iterates over `listAdapterIds()` and registers them as the registry grows.

## Skill presence (MANDATORY first action)

```bash
peaks skill presence:set peaks-ide --project <repo> --mode <mode> --gate startup
peaks project memories --project <repo> --json  # load durable memory
```

The presence marker tells the global peaks status line that peaks-ide is orchestrating. The memory read pulls forward the slice #1 contract: `peaks <cmd> --project <path>` is the canonical project-root source; `process.env[adapter.envVar]` (e.g. `CLAUDE_PROJECT_DIR`, `TRAE_PROJECT_DIR`) is the env-var override for auto-detect.

## Step 1: detect current state

The skill's first move is to **read**, not to ask. Build a complete picture of the user's IDE environment before any AskUserQuestion.

```bash
# 1. What adapters are registered? (slice #2 ships with claude-code + trae)
peaks project dashboard --project <repo> --json

# 2. Is the user on Claude Code, Trae, or something else?
#    Check the cwd for adapter-specific directories:
ls -la <repo>/.claude 2>/dev/null && echo "claude-code detected"
ls -la <repo>/.trae 2>/dev/null && echo "trae detected"

# 3. Are peaks hooks already installed? For each candidate, read settings.json:
#    claude: <root>/.claude/settings.json
#    trae:   <root>/.trae/settings.json
peaks hooks status --project <repo> --json 2>/dev/null
peaks statusline status --project <repo> --json 2>/dev/null
```

The skill composes a 1-2 sentence **state summary** before asking anything:

> "I see you're on **Trae** (`.trae/` exists in the project root). peaks hooks are **not installed** yet. peaks statusline is **not installed** either. The `peaks hook handle` runtime is available as a CLI primitive — you don't need to install it separately; what needs installing is the settings.json entries that point to it."

The user gets a complete picture without having to answer any question. The next step only fires AskUserQuestion if intent is genuinely ambiguous.

## Step 2: AskUserQuestion (only if intent is ambiguous)

If the user typed `/peaks-ide` without context, the skill's intent is genuinely ambiguous. The four canonical intents are:

| Option | What it does |
|---|---|
| First-time install | Run `peaks hooks install` + `peaks statusline install` for the detected IDE |
| Switch to a different IDE | Detect current install, uninstall from old IDE, install on new IDE (e.g. Claude → Trae) |
| Show current status | Just print the state summary from Step 1; no side effects |
| Uninstall peaks hooks | Run `peaks hooks uninstall` + `peaks statusline uninstall` for the detected IDE |

**Default option is "Show current status"** — the cheapest action, and the user gets useful output even if they didn't know what they wanted. AskUserQuestion is the ONLY place this skill asks anything. All destructive paths (Switch, Uninstall) gate on user confirmation here.

## Step 3: plan & preview (dry-run)

Before any side effect, the skill prints the exact CLI invocations it will run. This is the "see before you leap" step.

```
Plan: First-time install for Trae (.trae/ detected in project root)

  1. peaks hooks install --project <repo>
     → writes a beforeToolCall hook entry to <root>/.trae/settings.json
       that points to `peaks hook handle --project "${TRAE_PROJECT_DIR}"`

  2. peaks statusline install --project <repo>
     → writes a statusLine field with command `peaks statusline`

  3. (no third command — `peaks hook handle` is the runtime; once the
     settings.json entries point to it, the user's Trae will invoke it
     on every PreToolUse event)

Verification: after install, re-run `peaks hooks status --project <repo>`
             to confirm the entries are present.

Proceed? (Y/n)
```

The plan MUST be human-readable. Don't run a side effect until the user confirms.

## Step 4: execute

For each step in the plan, invoke the CLI primitive. The skill does NOT call out to a hidden script — it runs the actual peaks CLI commands, so the user sees the same output they'd see typing the command themselves.

```bash
# Example: first-time Trae install
peaks hooks install --project <repo>
peaks statusline install --project <repo>

# After each command, check the exit code. If non-zero, STOP and report
# the failure to the user. The skill does NOT auto-rollback; the user
# decides what to do next.
```

For destructive paths (Switch, Uninstall), the skill uses a **transactional pattern**: it captures the current state, runs the destructive CLI, then runs the install CLI; if any step fails, it reports the partial state and lets the user decide.

## Step 5: audit log

Every successful execution writes one JSON line to `.peaks/_runtime/<sid>/ide-onboard.log`:

```json
{"timestamp":"2026-06-06T19:55:00Z","intent":"first-time-install","detected_ide":"trae","cli_invocations":["peaks hooks install --project <repo>","peaks statusline install --project <repo>"],"outcome":"success","session_id":"2026-06-06-session-22f08c"}
```

The audit log is **machine-readable** (so `peaks project dashboard` can read it and surface "you installed peaks for Trae on 2026-06-06") and **human-readable** (so the user can `cat` it to see the install history). The skill does NOT write the log file itself — it delegates to `peaks project dashboard` (which knows the canonical log path) or to a thin helper if the log writer needs to live in the skill.

## Boundaries

`peaks-ide` may:

- detect the current IDE (cwd + env var + settings.json)
- ask the user via AskUserQuestion (Step 2 only)
- preview the CLI invocations (Step 3)
- execute existing peaks CLI commands (Step 4)
- write a single line to the audit log (Step 5)

`peaks-ide` must NOT:

- introduce new `peaks <cmd>` CLI commands (dev-preference red line: "Default-no on new CLI commands")
- bypass the user's confirmation on destructive paths (Switch / Uninstall)
- write the settings.json directly (the CLI primitives own that)
- run other peaks skills (peaks-solo, peaks-qa, etc.) — those are separate skills with their own scopes
- handle multi-IDE scenarios in slice #2 (e.g. "I use Claude at work and Trae at home" — the registry is single-IDE per session; a future slice could add multi-IDE)

## Reference: the CLI primitives the skill composes

- `peaks hooks install` / `peaks hooks uninstall` / `peaks hooks status` — adapter-driven; auto-detects IDE from env / stdin / cwd
- `peaks statusline install` / `peaks statusline uninstall` / `peaks statusline status` — same
- `peaks hook handle` — the runtime handler; not installed, just invoked
- `peaks project dashboard --json` — surfaces the current state summary
- `peaks skill runbook` — surfaces the peaks-ide skill body for inspection

## Next-step references

- The slice #1 RD artifact at `.peaks/_runtime/<sid>/rd/requests/002-2026-06-06-peaks-ide-skeleton.md` documents the slim `IdeAdapter` shape that the skill is built on.
- The slice #2 PRD at `.peaks/_runtime/<sid>/prd/requests/002-2026-06-06-trae-adapter-and-peaks-ide-skill.md` documents the 13 ACs this skill is part of.
- The slice #2 RD artifact (in flight) documents the implementation contract.
