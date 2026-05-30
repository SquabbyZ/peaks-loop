# Peaks

Peaks is a CLI tool and skill family for Claude Code that turns project governance, workflow planning, controlled execution, QA verification, and change traceability into a reusable engineering process.

## Installation

```bash
npm install -g peaks-cli
```

After installation, Peaks registers its bundled skills into Claude Code so you can invoke them directly in conversation.

Verify installation:

```bash
peaks --help
peaks skill list --json
```

## Using Skills

In Claude Code, start a workflow by typing a skill name followed by a natural language description:

```text
peaks-solo end-to-end development from PRD to implementation for /path/to/project
peaks-prd define product goals, non-goals, and acceptance criteria for the invitation feature
peaks-rd analyze the smallest refactor slice and risks for this change
peaks-qa design tests and regression checks for this change
peaks-ui design the login page interaction and visual approach
peaks-sc record change impact, artifact retention, and commit boundaries
peaks-txt generate a context capsule for the current module with key decisions
```

Choose the skill that matches the task:

| Skill | Purpose | Typical Use |
|------|------|----------|
| `peaks-solo` | End-to-end orchestration entrypoint | Full-cycle development, PRD to production |
| `peaks-prd` | Product goals, non-goals, acceptance criteria | Requirements gathering, refactor goal definition |
| `peaks-ui` | UI/UX, interaction, and visual constraints | Page design, interaction flows, prototypes |
| `peaks-rd` | Engineering analysis, refactor planning, execution contracts | Technical analysis, minimal slices, risk assessment |
| `peaks-qa` | Tests, coverage, and regression verification | Test design, regression matrices, acceptance checks |
| `peaks-sc` | Change traceability, commit boundaries, artifact retention | Impact records, rollback evidence |
| `peaks-txt` | Context capsules, decision records, knowledge compression | Module understanding, key decision capture |

### Common Workflows

**New feature from scratch:**

1. `peaks-prd` — define feature goals, user value, acceptance criteria, and non-goals
2. `peaks-rd` — identify the smallest implementation slice and affected modules
3. `peaks-ui` — add interaction and visual design (for UI-related tasks)
4. `peaks-qa` — define new tests and regression tests
5. `peaks-solo` — end-to-end orchestrated execution

**Refactoring an existing project:**

1. `peaks-txt` — generate a context capsule to understand the current module
2. `peaks-prd` — define refactor goals, non-goals, and acceptance criteria
3. `peaks-rd` — analyze project structure, tests, scripts, key modules, and risks
4. `peaks-qa` — define regression matrix and coverage gates
5. `peaks-solo` — end-to-end orchestrated execution
6. `peaks-sc` — record impact, retention, and boundary

**Fixing a bug:**

1. Reproduce or locate the bug
2. `peaks-rd` — produce root cause, fix strategy, and regression risk
3. `peaks-qa` — define failing test cases and acceptance conditions
4. Add a failing test first, then apply the minimal fix
5. `peaks-sc` — record impact range and boundaries

### Environment Check

Before using skills, verify your environment:

```bash
peaks doctor --json
peaks skill doctor --json
```

## Custom SOPs (user-authored workflow gates)

Beyond the built-in `peaks-*` skill family, the `peaks sop` command group lets you define **your own SOP**: an ordered set of phases plus gates bound to those phases. A gate that doesn't pass blocks advancement into its phase — applying "don't drop steps" to your own workflow.

**This is a general workflow-gating tool, not a developer-only one.** It fits any process with ordered stages where you must not move ahead until checkable conditions are met — content publishing, compliance/approval checklists, data-validation pipelines, onboarding, ops runbooks, personal procedures. A software release is just one example; non-engineering workflows are often the more valuable use.

> Easier path: use the **`peaks-sop` skill** — describe your process in natural language and let the LLM generate, debug, and register the SOP for you, with no JSON to hand-write or commands to memorize. The CLI below is the engine it drives.

### Un-bypassable gates (the killer feature)

CI only blocks at **merge time**; rules in `CLAUDE.md` rely on the agent's **goodwill**. Peaks does what neither can: stop an irreversible action **mid-conversation, against the agent itself**.

Declare a **guard** on a phase (binding a Bash command to it), then install a PreToolUse hook:

```bash
# in sop.json: bind "publish" to git push, and require the post to be TODO-free
#   "gates":  [{ "id":"no-todo","phase":"publish",
#               "check":{ "type":"grep","file":"posts/current.md","pattern":"TODO","absent":true } }]
#   "guards": [{ "phase":"publish","bash":"git +push" }]
peaks hooks install --project .        # explicit opt-in; writes one PreToolUse entry
```

Now when the agent tries `git push` while a TODO remains, Claude Code receives `permissionDecision: "deny"` and the command is blocked **before any permission check — it holds even under `--dangerously-skip-permissions`**. Satisfy the gate and it passes; for emergencies, `peaks gate bypass --sop <id> --phase <phase> --reason "<why>"` allows it once (capped per project per SOP, reason audited).

Enforcement **fails open**: any internal Peaks error allows the command (a bug never bricks your Claude Code) — only a real gate failure denies. Installing the hook is an explicit user command; the skill never writes `settings.json`. Manage it with `peaks hooks status` / `peaks hooks uninstall`.

**Definition global, execution per-project.** A SOP definition (`sop.json` + registrable `SKILL.md`) lives in the global `~/.peaks/sops/<sop-id>/` — author it once and reuse it across every project. Run-state (current phase, history) is per-project at `<project>/.peaks/sop-state/<sop-id>/`, so the same SOP tracks independent progress in each project. `init`/`lint`/`register`/`registry` operate on the global definition and take **no `--project`**; `check`/`advance` take `--project` (default: current directory) to say which project to run against.

```bash
# 1. Scaffold a SOP into ~/.peaks/sops (preview by default; --apply writes files)
peaks sop init --id team-release --name "Team Release" --apply --json

# 2. Validate the manifest (unique gate ids, valid phases, complete check fields)
peaks sop lint --id team-release --json

# 3. Register into the global gate registry (--dry-run to preview)
peaks sop register --id team-release --json

# 4. List every custom gate in the registry (built-in peaks-* gates never appear)
peaks sop registry --json

# 5. Evaluate a single gate against a project (returns pass / fail / blocked)
peaks sop check --id team-release --gate changelog --project . --json

# 6. Advance to a phase — its gates must pass AND it can't skip ahead, or it's blocked
peaks sop advance --id team-release --to ship --project . --json
```

Example `sop.json`:

```json
{
  "id": "team-release",
  "name": "Team Release",
  "phases": ["draft", "review", "ship"],
  "gates": [
    { "id": "changelog", "phase": "ship", "check": { "type": "file-exists", "path": "CHANGELOG.md" } },
    { "id": "no-fixme", "phase": "review", "check": { "type": "grep", "file": "src/index.ts", "pattern": "FIXME", "absent": true } },
    { "id": "tests", "phase": "ship", "check": { "type": "command", "run": ["npm", "test"] } }
  ]
}
```

Gate checks support three types:

| Type | Fields | Meaning |
|------|--------|---------|
| `file-exists` | `path` | File exists → pass |
| `grep` | `file` + `pattern` (+ `absent`) | Regex matches in file → pass; with `absent: true` it inverts — passes when the pattern is NOT found ("must not contain X": pure text, no `--allow-commands`, cross-platform) |
| `command` | `run` (argv array) + `expectExitZero` | Run a command, judge by exit code |

For the very common "no leftover TODO / placeholder / unresolved marker" gate, prefer `grep` with `absent: true` over a `command` gate.

Security constraints:
- `command` gates run user-defined commands and are **refused by default**; you must pass `--allow-commands` to evaluate them. Commands run as an argv array (no shell, no injection surface), with a timeout cap and cwd pinned to the project root.
- `file-exists` / `grep` paths are confined inside the project root; out-of-bounds paths return `blocked`.
- Side-effecting commands (init/register/advance) all support `--dry-run` preview without writing.
- `advance` also enforces **phase order**: you may stay or step back, but not skip ahead — a forward jump returns `SOP_PHASE_SKIP`.
- When advancement is blocked (gate or phase skip), bypass explicitly with `--allow-incomplete --reason "<why>"` (bypasses both); in assisted/strict mode `--confirm` is also required, and each SOP has a per-project bypass cap.

## License

MIT License. See [LICENSE](LICENSE).
