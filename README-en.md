# Peaks

Peaks is a **family of skills for Claude Code** — it turns project governance, workflow planning, controlled execution, QA verification, and change traceability into a reusable engineering process.
The CLI is the engine those skills call into: it owns the **gates, the JSON contracts, and the irreversible side effects**.

> **One-line positioning**: you **work with SKILLs**; the CLI is the machine-level backing that keeps the skills trustworthy.

## Installation

```bash
npm install -g peaks-cli
```

After install, Peaks registers its 8 built-in `peaks-*` skills into Claude Code. Invoke them by name in any conversation.

## 5-minute onboarding

In a Claude Code conversation, **just ask Claude to use a skill by name**. The skill takes over the rest of the flow:

```text
peaks-solo end-to-end governance of /path/to/your-project
peaks-prd  define goals, non-goals, and acceptance criteria for the invitation feature
peaks-rd   analyze the smallest refactor slice and risks for this change
peaks-qa   design tests and regression checks for this change
peaks-ui   design the login page interaction and visual approach
peaks-sc   record change impact, artifact retention, and commit boundaries
peaks-txt  generate a context capsule for the current module with key decisions
peaks-sop  turn my "publish a post" flow into a gated SOP
```

First time? Follow these four steps:

1. In Claude Code, say: **`peaks-solo analyze /path/to/your-project`**
2. The skill auto-runs: `peaks workspace init` → `peaks scan archetype` → writes `.peaks/<session-id>/rd/project-scan.md`
3. Describe the change you want; the skill drives PRD → RD → UI → QA → SC → TXT in order
4. At the end, the skill keeps every intermediate artifact under `.peaks/<session-id>/` and writes the durable facts into `.peaks/memory/`

Want a quick status check? Ask Claude to run:

```bash
peaks -V                # version
peaks                   # quickstart + installed-skill count
peaks doctor --json     # environment / skills / config one-shot check
peaks skill doctor --json
peaks project dashboard --project . --json   # current project dashboard
```

## Skills at a glance

| Skill | What you use it for | Typical scenario |
|------|--------------------|------------------|
| `peaks-solo` | **End-to-end orchestration entrypoint.** Coordinates `prd / rd / ui / qa / sc / txt` automatically | Full-cycle dev, PRD-to-ship, batched cross-slice iterations |
| `peaks-prd` | Turn fuzzy product intent into a **verifiable PRD** (goals, non-goals, preserved behavior, acceptance) | Requirements, refactor goal definition, PRD authoring |
| `peaks-rd` | Engineering analysis, refactor planning, execution contracts, risk assessment | Technical analysis, minimal slices, risk review, refactor planning |
| `peaks-ui` | UI/UX interaction and visual direction, design system constraints | Page design, interaction flows, prototypes, UI regression |
| `peaks-qa` | Test design, coverage, regression matrices, acceptance evidence | Test cases, regression matrix, acceptance checks, browser E2E |
| `peaks-sc` | Change control, commit boundaries, artifact retention, rollback evidence | Impact records, rollback evidence, change-control |
| `peaks-txt` | Context capsules, decision records, knowledge compression | Module understanding, key-decision capture, retros |
| `peaks-sop` | **Turn your own workflow into a gated SOP** (not dev-only) | Content publishing, compliance checklists, data pipelines, ops runbooks, personal procedures |

### Three common workflows

**New feature, end-to-end**

```text
peaks-prd  →  peaks-ui (if UI)  →  peaks-rd  →  peaks-qa  →  peaks-sc
```

**Refactor an existing project**

```text
peaks-txt (compress the current state)     →  peaks-prd (clarify the goal)  →
peaks-rd  (split into minimal slices)      →  peaks-qa  (regression matrix) →
peaks-solo (orchestrate end-to-end)        →  peaks-sc  (change evidence)
```

**Fix a bug**

```text
peaks-rd (repro + root cause)  →  peaks-qa (failing test + acceptance)  →
write the code (failing test first)  →  peaks-sc
```

## How it works: skills first, CLI as gates

The `peaks <cmd>` CLI is **not your daily driver**. It exists for three machine-level reasons only:

1. **Explicit opt-in for irreversible side effects** (e.g. `peaks sop init --apply`, `peaks openspec archive --apply`) — actions that must not happen on the LLM's discretion.
2. **Structured JSON contracts** (`peaks request show ... --json`, `peaks scan archetype ... --json`) — let a skill read a machine-verdict to gate its next decision.
3. **Invokable from hooks / CI / scripts** (`peaks hooks install`, `peaks gate enforce`) — the layer that turns "satisfy these gates before X" from prose into enforcement.

The mental model: **SKILL = the workflow's brain**; **CLI = the workflow's joints**.

### CLI commands you will *see* skills call

You don't need to memorize these — but they're the bones you'll hear referenced when a skill runs:

```bash
peaks workspace init --project <repo> --json       # create the .peaks/ workspace (once per session)
peaks scan archetype --project <repo> --json       # detect project archetype (greenfield / legacy-frontend / ...)
peaks request init/show/transition                 # state machine for prd/rd/qa/sc requests
peaks sop init/lint/check/advance/register         # your custom SOP lifecycle
peaks hooks install --project <repo>               # install a PreToolUse hook for gates
peaks project dashboard --project <repo> --json    # one-shot project view
peaks project memories --project <repo> --json     # read durable facts from .peaks/memory/
```

For the full list, run `peaks --help`.

## Custom SOPs (turn your workflow into a gated flow)

> **Skill entry point**: the `peaks-sop` skill.
> Tell Claude "turn my 'publish a post' flow into a gated SOP" and it will guide you through defining phases, setting gates, debugging, and registering — no JSON to hand-write.

The built-in `peaks-*` skill family covers the common case. But many real workflows are **domain-specific, ordered, and require checkable conditions before advancing** — that's what a SOP (Standard Operating Procedure) expresses.

The `peaks-sop` skill turns any such flow into a **gated workflow**:

| Domain | Example phases | Gate idea |
|--------|----------------|-----------|
| Content / publishing | draft → edit → publish | `file-exists` the draft; `grep` no `TODO`/`TKTK`; `command` runs a spell/word-count check |
| Compliance / approval | prepare → review → sign-off | `file-exists` `approval.md`; `grep` the doc contains "Approved" |
| Data pipeline | raw → cleaned → validated | `command` runs a validator script that exits 0 |
| Onboarding / ops | request → provision → done | `file-exists` each checklist artifact; `command` verifies a config |
| Software release (typical, not the only case) | draft → review → ship | `file-exists` `CHANGELOG.md`; `grep` source for no `FIXME`; `command` runs tests |
| Personal procedure | any repeatable steps | whatever "don't forget step X" means, expressed as a file/grep/command |

### Gate types

| Type | Meaning | Example |
|------|---------|---------|
| `file-exists` | File exists → pass | `CHANGELOG.md` exists |
| `grep` (+ `absent`) | Regex matches in file → pass; with `absent: true` it inverts ("must not contain X") | "post body has no `TODO`" |
| `command` | Run a command, judge by exit code (refused by default; needs `--allow-commands`) | run `npm test` |

### The killer feature: un-bypassable gates

CI only blocks at **merge time**; `CLAUDE.md` rules rely on the agent's **goodwill**. SOPs do what neither can: **stop an irreversible action mid-conversation, against the agent itself**.

```jsonc
// sop.json
"guards": [ { "phase": "publish", "bash": "git +push" } ]
```

```bash
peaks hooks install --project <repo>   # explicit opt-in: writes one PreToolUse entry
```

After that, when the agent tries `git push` while a publish gate is failing, Claude Code receives `permissionDecision: "deny"` — the command is blocked **before any permission check, even under `--dangerously-skip-permissions`**. Satisfy the gate and it passes; for emergencies use `peaks gate bypass --sop <id> --phase <phase> --reason "<why>"` (one-shot, capped per project per SOP, reason audited).

> **Two definition layers, execution per-project.** A SOP definition (`sop.json` + registrable `SKILL.md`) can live in the **global** layer `~/.peaks/sops/` (your personal cross-project SOPs — default for `init`/`lint`/`register`) or the **project** layer `<repo>/.peaks/sops/` (committed into the repo, team-shared — pass `--project <repo>`). The **project layer wins** over global for the same id. Run-state (current phase, history) is always per-project at `<project>/.peaks/sop-state/<sop-id>/`. `check` / `advance` take `--project` to say which project to evaluate against and which definition layer wins.

## Project layout (the peaks-cli repo itself)

```text
skills/        # 8 SKILL.md files (peaks-solo / -prd / -rd / -qa / -ui / -sc / -txt / -sop)
src/cli/       # CLI engine (commands/, services/, hooks/, memory/, sop/, scan/, ...)
bin/peaks.js   # entry point
docs/          # design docs
openspec/      # internal OpenSpec change proposals
```

## License

MIT License. See [LICENSE](LICENSE).
