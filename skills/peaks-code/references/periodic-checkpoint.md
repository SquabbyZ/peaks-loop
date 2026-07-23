# Step N: periodic checkpoint — trigger table + field reference

## Cadence guidance

The LLM is the only one that knows when context pressure is high. Step N
gives the LLM a clear trigger table and a field reference so it can call
`peaks session checkpoint` at the right moments without user action. The
CLI is idempotent and self-pruning (max 10 retained) so the LLM can
checkpoint as often as it wants.

## Trigger table

| Trigger                                | `--reason`         |
|----------------------------------------|--------------------|
| Every 20 tool calls (LLM keeps a counter; **hard-coded — do NOT override**) | `periodic` (default) |
| After each PRD/RD/QA/TXT artifact published | `artifact-written` |
| LLM notices context getting full       | `context-fill`     |
| User says "save" / "pause"             | `user-pause`       |
| User closes the session                | `user-close`       |

> **Slice 2026-06-24-efficiency-4p-bundle / G1 (P0.1) — frequency lock**:
> The `--reason periodic` row above is hard-locked at **20 tool calls**.
> The threshold is a textual contract between SKILL.md (line 79) and
> this reference doc; the LLM runner is expected to fire
> `peaks session checkpoint --reason periodic` once every 20 tool calls
> (i.e. on each 20-call mark, not "approximately every 20"). The CLI
> does **not** expose a `--periodic-every <n>` override flag — the
> cadence is owned by the skill, not the CLI. Any patch that relaxes
> this must update both files in lockstep or fail the
> `tests/unit/code/checkpoint-periodic-frequency.test.ts` guard.

## Checkpoint CLI contract

`peaks session checkpoint [--reason <r>] [--session-id <sid>] [--project <path>] [--current-plan <text>] [--open-questions <list>] [--recent-decisions <list>] [--recent-artifact-paths <list>] [--git-status <text>] [--skills-active <list>] [--todo-state <list>] [--json]`

- `<list>` options accept newline-separated values (one per line).
- `<sid>` defaults to the canonical binding from `.peaks/_runtime/session.json` (`peaks session info --active`).
- The CLI writes `.peaks/_runtime/<sid>/checkpoints/<iso>.json` with all 11 documented fields.
- Idempotent: any number of checkpoints may exist; the oldest beyond 10 are auto-pruned by mtime.

## Field reference

| Field | Source |
|-------|--------|
| `sessionId` | canonical binding (resolved via `peaks session info --active`) |
| `lastActivity` | read from `.peaks/_runtime/<sid>/session.json.lastActivity`; falls back to `createdAt` if missing |
| `currentPlan` | `--current-plan` flag (one-line slice summary) |
| `openQuestions` | `--open-questions` flag (newline list) |
| `recentDecisions` | `--recent-decisions` flag (newline list) |
| `recentArtifactPaths` | `--recent-artifact-paths` flag (newline list) |
| `gitStatus` | `--git-status` flag (one `git status --short` output) |
| `skillsActive` | `--skills-active` flag (newline list of peaks skill names) |
| `todoState` | `--todo-state` flag (newline list of todo lines) |
| `reason` | `--reason` flag (one of the 5 documented values) |
| `createdAt` | stamped at writeCheckpoint() invocation |

## Skill recommendations

- After every major artifact write: `peaks session checkpoint --reason artifact-written --recent-artifact-paths <list> --recent-decisions <list>`.
- Every 20 tool calls (LLM keeps a counter; locked at 20 per slice 2026-06-24-efficiency-4p-bundle / G1): `peaks session checkpoint --reason periodic`.
- When user says "save" / "pause" / "checkpoint": `peaks session checkpoint --reason user-pause --current-plan <text>`.

## Checkpoint edge cases

- **No canonical session**: CLI throws `NO_ACTIVE_SESSION`; LLM should call `peaks workspace init` first.
- **Invalid reason**: CLI throws `INVALID_REASON`; LLM retries with one of the 5 documented values.
- **Idempotent**: running checkpoint twice in a row produces two distinct files (different `<iso>` filenames). No state corruption.

## Checkpoint IDE note

This step is strictly IDE-agnostic. The LLM calls the peaks CLI; no IDE-specific tools or paths are involved.

## Companion surface — auto-compact (zero-pause)

When the runner crosses the v2.13.0 auto-compact thresholds (0.85 pre-compact / 0.95 red-line), `peaks session checkpoint` is NOT enough on its own — the LLM must also fire `peaks compact auto` to drive the capability-first control plane. See:

- `peaks compact auto` — the capability-first control plane entry (Task 1.6, design §11.1)
- `.peaks/memory/2026-06-27-auto-compact-design.md` — zero-human-intervention design rationale

The two surfaces compose: `peaks session checkpoint` persists the context state, `peaks compact auto` collapses the runner's window via the capability-first control plane. The LLM fires both in the 0.85–0.95 zone; ≥ 0.95 is a synchronous hard-stop that the control plane handles automatically.