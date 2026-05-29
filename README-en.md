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

Artifacts live in `.peaks/sops/<sop-id>/`, containing `sop.json` (structured manifest) and a registrable `SKILL.md`.

```bash
# 1. Scaffold a SOP (preview by default; --apply writes files)
peaks sop init --id team-release --name "Team Release" --project . --apply --json

# 2. Validate the manifest (unique gate ids, valid phases, complete check fields)
peaks sop lint --id team-release --project . --json

# 3. Register into the workspace gate registry (--dry-run to preview)
peaks sop register --id team-release --project . --json

# 4. List every custom gate in the registry (built-in peaks-* gates never appear)
peaks sop registry --project . --json

# 5. Evaluate a single gate (returns pass / fail / blocked)
peaks sop check --id team-release --gate changelog --project . --json

# 6. Advance to a phase — its gates must all pass, or the move is truly blocked
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
    { "id": "no-fixme", "phase": "review", "check": { "type": "grep", "file": "src/index.ts", "pattern": "FIXME" } },
    { "id": "tests", "phase": "ship", "check": { "type": "command", "run": ["npm", "test"] } }
  ]
}
```

Gate checks support three types:

| Type | Fields | Meaning |
|------|--------|---------|
| `file-exists` | `path` | File exists → pass |
| `grep` | `file` + `pattern` | Regex matches in file → pass |
| `command` | `run` (argv array) + `expectExitZero` | Run a command, judge by exit code |

Security constraints:
- `command` gates run user-defined commands and are **refused by default**; you must pass `--allow-commands` to evaluate them. Commands run as an argv array (no shell, no injection surface), with a timeout cap and cwd pinned to the project root.
- `file-exists` / `grep` paths are confined inside the project root; out-of-bounds paths return `blocked`.
- Side-effecting commands (init/register/advance) all support `--dry-run` preview without writing.
- When advancement is blocked, bypass explicitly with `--allow-incomplete --reason "<why>"`; in assisted/strict mode `--confirm` is also required, and each SOP has a bypass cap.

## License

MIT License. See [LICENSE](LICENSE).
