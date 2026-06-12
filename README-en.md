# Peaks

**English** | [简体中文](./README.md)

[![npm version](https://img.shields.io/npm/v/peaks-cli.svg)](https://www.npmjs.com/package/peaks-cli)
[![GitHub repo](https://img.shields.io/badge/GitHub-SquabbyZ%2Fpeaks--cli-181717?logo=github)](https://github.com/SquabbyZ/peaks-cli)

Peaks is a **cross-AI-IDE workflow-gating CLI + skill family** — it turns project governance, workflow planning, controlled execution, QA verification, and change traceability into a reusable engineering process. The `peaks` CLI is the stable cross-IDE backbone (gates, JSON contracts, irreversible side effects); the skill / hook / config layer is rendered into each IDE's native format.

> **Supported IDEs**
> - ✅ **Claude Code** (shipped, primary): 11 `peaks-*` skills + `.claude/settings.json` PreToolUse hook; agent team is dogfooded in this IDE
> - ⚠️ **Trae** (adapter shipped, real-Trae unverified): the slim `IdeAdapter` is registered in the slice #1 registry (`hookEvent` / `toolMatcher` / `envVar` are 1.x assumptions, **not verified on real Trae**); real Trae integration dogfood is a follow-up slice
> - 📋 **Codex / Cursor / Qoder / Tongyi Lingma, and more** (on the roadmap)

> **Positioning**: you **work with skills**; the CLI is the cross-IDE quality assurance layer.
>
> Our goal: let the LLM exercise full judgment in each step — peaks provides an auditable SOP guardrail at process boundaries and accumulates project-level memory and usage experience, so the AI IDE and the LLM grow to know your project better the more you use them.

## Installation

```bash
npm install -g peaks-cli
```

After install, Peaks registers its 11 built-in `peaks-*` skills into the adapted AI IDE (today: Claude Code). Invoke them by name in any conversation.

### 2.0 new: one-key upgrade (1.x → 2.0)

If you already have peaks-cli 1.x installed, running `npm install -g peaks-cli` is all you need. The postinstall hook auto-detects the 1.x state in your project and migrates `.claude/rules/`, `~/.peaks/config.json`, `.gitignore`, etc. to the 2.0 layout (every step writes a timestamped backup first). After the upgrade, `git status` will surface the 2.0 tracked artifacts (`.peaks/standards/`, `.peaks/memory/*.md` durable memories, `.peaks/PROJECT.md`, opt-in markers).

```bash
# Manual fallback (CI with --ignore-scripts, or PEAKS_SKIP_AUTO_UPGRADE=1):
peaks upgrade --to 2.0 --auto --project .
```

> Full 8-step contract + rollback path: [`docs/UPGRADING-2.0.md`](./docs/UPGRADING-2.0.md).

### 2.0 new: ocr second-opinion code review (soft-optional)

peaks-cli 2.0 ships Alibaba's [Open Code Review](https://github.com/alibaba/open-code-review) (`@alibaba-group/open-code-review`) as a **required dependency**, augmenting `peaks-rd`'s Gate B3 with a **second opinion**: peaks-rd's own LLM review + ocr's specialized review, merged into `.peaks/<session-id>/rd/code-review.md`.

The LLM endpoint config is **user-maintained inside peaks-cli's own config** (peaks-cli does **NOT** auto-configure, does **NOT** write `~/.opencodereview/config.json`, does **NOT** invoke `ocr config set`):

```bash
# 1) Print the JSON snippet to paste (read-only — does not write anything):
peaks code-review config-template --json

# 2) Paste the snippet into ~/.peaks/config.json under "ocr.llm",
#    replace <your-api-key>. Alternatively, set keys one at a time:
#    peaks config set --key ocr.llm.url --value '<url>' etc.

# 3) Verify readiness (peaks-rd also runs this automatically):
peaks code-review detect-ocr --json
```

peaks-cli never touches your LLM token / URL — that is yours. The config lives at `peaksConfig.ocr.llm`; peaks-rd injects it as **env vars** (`OCR_LLM_URL` / `OCR_LLM_TOKEN` / `OCR_LLM_MODEL` / `OCR_USE_ANTHROPIC` / `OCR_LLM_AUTH_HEADER`) when spawning the ocr subprocess — that is ocr's highest-priority config path, so peaks-cli never has to materialise `~/.opencodereview/config.json`.

Soft-fail policy: missing package, missing binary, or missing config never blocks peaks-rd — it simply omits the second opinion and proceeds with the LLM-only review. Full integration contract: [`skills/peaks-rd/references/ocr-integration.md`](./skills/peaks-rd/references/ocr-integration.md).

## 5-minute onboarding

In an adapted AI IDE conversation, **just ask the AI to use a skill by name**. The skill takes over the rest of the flow:

```text
peaks-solo add OAuth callback to the login page      # first explicit peaks-solo use; project root = the IDE's current cwd
peaks-prd  define goals, non-goals, and acceptance criteria for the invitation feature
peaks-rd   analyze the smallest refactor slice and risks for this change
peaks-qa   design tests and regression checks for this change
peaks-ui   design the login page interaction and visual approach
peaks-sc   record change impact, artifact retention, and commit boundaries
peaks-txt  generate a context capsule for the current module with key decisions
peaks-sop  turn my "publish a post" flow into a gated SOP
```

First time? Two layers: **you do 2 steps, peaks handles the rest**.

**What you do (2 steps):**

1. Open an adapted AI IDE inside your project directory: `cd /path/to/your-project && <your IDE command, e.g. claude>` — so the IDE knows the project root
2. In the IDE, say: **`peaks-solo do X for me`** (X = a need description, e.g. "add OAuth callback to the login page")
   - The LLM picks a mode based on the task and project; to be explicit, write `peaks-solo full-auto X` / `peaks-solo swarm X` / `peaks-solo strict X`

**Then peaks handles the rest:**

- Runs `peaks workspace init` (creates `.peaks/` on first run) → `peaks scan archetype` → writes `.peaks/<session-id>/rd/project-scan.md`
- For complex tasks coordinates PRD → RD → UI → QA → SC → TXT; for simple tasks runs in solo full-auto mode without phase-by-phase pauses
- While the workflow runs, use `peaks-solo-status` to see where you are; if interrupted, use `peaks-solo-resume` to continue
- At the end, keeps every intermediate artifact under `.peaks/<session-id>/` and writes the durable facts into `.peaks/memory/`

Want a quick status check? Ask the AI to run:

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
| `peaks-solo-resume` | **Continue the unfinished slice** — detects the in-flight gate and surfaces a resume option (saves 3-5k tokens vs re-reading artifacts) | "继续完成刚才的", "resume the unfinished slice" |
| `peaks-solo-status` | **Where are we now** — 5-CLI snapshot table (presence + session + dashboard + request + memory) | "现在到哪了", "show me the dashboard" |
| `peaks-solo-test` | **Run the project's test suite** — detects the test runner from `package.json` (vitest / jest / mocha / pytest / ...) and runs with the project's native command, then summarises pass/fail | "跑测试", "run the tests" |

### Two basic ways to use Peaks

**1. Let `peaks-solo` orchestrate (the common case)**

`peaks-solo` is the product entry point. **Most scenarios use it** — just tell it what to do and it coordinates the PRD / UI / RD / QA / SC / TXT chain by itself. **The default mode is not hardcoded** — the LLM proactively recommends one of assisted / full-auto / swarm / strict based on task complexity and project state; to be explicit, write the mode in the invocation:

```text
peaks-solo do X for me              # default (not hardcoded — LLM picks based on task and project); X = a need description; the project path is the IDE's current cwd
peaks-solo full-auto do X           # explicit full-auto: end-to-end
peaks-solo swarm do X               # explicit swarm: maximize sub-agent parallelism (for larger tasks)
peaks-solo strict do X              # explicit strict: strictest gates
```

The 3 `peaks-solo-*` wrapper skills are lightweight variants of solo (not separate roles):

- `peaks-solo-resume` — continue an in-flight slice
- `peaks-solo-status` — see where you are
- `peaks-solo-test` — run the project's test suite

**2. Invoke a single role skill directly (advanced)**

Only when you want to do **one phase** of the workflow yourself (e.g. write a PRD, do an architecture analysis, run regression) without the full pipeline:

| Skill | What you use it for | When to reach for it |
|---|---|---|
| `peaks-prd` | Author / edit a PRD (goals, non-goals, preserved behavior, acceptance) | You want to define the requirements yourself, no full solo run |
| `peaks-rd` | Architecture analysis + minimum-slice planning + risk | You want a tech analysis, not code |
| `peaks-qa` | Test cases + regression matrix + acceptance evidence | You want tests only, no full solo |
| `peaks-ui` | Visual direction + interaction design + design-system constraints | UI design only, no implementation |
| `peaks-sc` | Impact scope + commit boundaries + retention strategy | Just record the change, don't trigger full flow |
| `peaks-txt` | Context capsule + decision records | Just compress knowledge, no full flow |
| `peaks-sop` | Turn any workflow (not just dev) into a gated SOP | Define / register your own SOP |

**3 solo wrappers + 7 role skills + 1 solo orchestrator = 11 skills in the family.** In daily use, 1 skill (`peaks-solo`) covers ≥90% of needs.

## Agent team

`peaks` dispatches an agent team for you — `peaks-solo` / `peaks-rd` / `peaks-qa` / `peaks-ui` send peer sub-agents to isolated sandboxes to write PRDs, do architecture analysis, run tests, and design UIs, while the main LLM only sees each sub-agent's metadata (path + size + summary).

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
peaks workspace reconcile --project <repo> --json  # 4-tier heuristic to re-point to the canonical session; sweep orphan session dirs (dry-run by default; --apply to delete)
peaks scan archetype --project <repo> --json       # detect project archetype (greenfield / legacy-frontend / ...)
peaks scan libraries --project <repo> --json       # enumerate deps + parse major; supports monorepo
peaks request init/show/transition                 # state machine for prd/rd/qa/sc requests
peaks session list/info/title/rotate               # session metadata; `rotate` drops the binding so the next peaks call auto-generates a fresh session
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

## License

MIT License. See [LICENSE](LICENSE).
