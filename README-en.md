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

## License

MIT License. See [LICENSE](LICENSE).
