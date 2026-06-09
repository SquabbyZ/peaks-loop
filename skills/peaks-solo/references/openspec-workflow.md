# OpenSpec Lifecycle for Peaks Solo

Peaks Solo orchestrates RD, QA, and SC. When the target repository uses OpenSpec, Solo must drive the full lifecycle through the Peaks CLI so each role works against the same stable surface.

> **Slice #016 (2026-06-09)**: this document used to live at `openspec-mcp-workflow.md` and contained a section on the `peaks mcp *` lifecycle. The MCP subsystem was retired in slice #016; that section is gone. The OpenSpec lifecycle described below is unchanged.

## OpenSpec change lifecycle

```text
peaks openspec render   →  RD authors a change pack (dry-run, then --apply)
peaks openspec validate →  Solo gates RD output before slicing starts
peaks openspec show     →  any role reads parsed proposal/tasks state
peaks openspec to-rd    →  RD projects the pack into refactor slice input
                          SC projects it into commit boundary candidates
peaks openspec validate →  QA gates the final state before sign-off
peaks openspec archive  →  Solo moves the change under changes/archive/<id>/
```

Rules Solo applies:

- `render --apply` is the only Peaks-managed way to write a change pack. Other roles must not hand-edit `openspec/changes/**`.
- `validate` is run twice per change in a refactor flow: once before slicing (RD entry gate) and once before archive (QA exit gate). Both must end with `data.valid === true`.
- `archive --apply` is the lifecycle terminator; Solo only invokes it after QA acceptance and SC commit.

## Refactor workflow wiring

For `peaks-solo refactor` runs against a repository with `openspec/`:

1. RD entry gate — `peaks openspec validate <id>` must pass and `peaks openspec to-rd <id>` must return `acceptance.length > 0`.
2. Each slice must reference one OpenSpec tasks section as its commit boundary (per `references/openspec-commit-boundaries.md` in peaks-sc).
3. QA exit gate — re-run `peaks openspec validate <id>` after implementation; record the result in the QA validation report.
4. Archive — `peaks openspec archive <id> --apply` only after QA passes the exit gate and SC closes the final commit.

If the consuming LLM needs an MCP server for docs lookup or research (e.g. Context7), it checks its own tool list for `mcp__<server>__*` and tells the user the install command if absent. peaks-cli is no longer in the install path; the LLM is the executor, the IDE is the dispatcher.

## Boundary

Solo must not write `openspec/changes/**` or `~/.claude/settings.json` directly. Every mutation goes through the CLI commands above. The CLI returns stable envelopes; Solo captures them as artifact links rather than re-explaining their content in the handoff.

---

# Step 0.5 — OpenSpec first-run opt-in (conditional)

> Body of `### Peaks-Cli Step 0.5`. After the workspace is anchored, before project scan, Solo checks whether
the project already has an `openspec/` directory. The lifecycle
(`render → validate → show → to-rd → validate → archive`) only applies
when `openspec/` exists; without it, RD/QA/SC silently skip the
openspec-aware paths and you lose change-proposal tracking, commit
boundaries from `tasks.md`, and the historical archive.

To make that opt-in visible instead of silent, Solo runs:

```bash
# 1. Detect whether the project already has openspec/.
ls <repo>/openspec/changes 2>&1
# 2. If absent, ask the user once — only on the first Solo run in this
#    project. The decision is sticky: write it to .peaks/.peaks-openspec-opt-in.json
#    so subsequent Solo invocations do not re-ask.
test -f <repo>/.peaks/.peaks-openspec-opt-in.json || \
  echo "{\"enabled\": <bool>}" > <repo>/.peaks/.peaks-openspec-opt-in.json
```

**AskUserQuestion** (only when `openspec/` is absent and the opt-in
file is missing):

| Option | What it does |
|---|---|
| Enable OpenSpec for this project (Recommended) | Run `peaks openspec init --project <repo> --apply`. After that, every Solo run uses the change-proposal lifecycle for the same project. |
| Skip for now | Do nothing. Solo proceeds without openspec; the question is re-asked on the next first-run detection. |
| Never ask again for this project | Write `{enabled: false, sticky: true}`. Solo stops asking. The user can re-enable later by removing `.peaks/.peaks-openspec-opt-in.json` and re-running. |

The first option is the recommended default because it gives Solo the
full change-proposal lifecycle (proposal / tasks / design / specs
deltas, archive on ship, commit boundaries from `tasks.md`). It costs
only a single scaffolded directory and pays back the first time the
project needs a real review trail.

If the user picks "Enable", the only required follow-up is to make
sure `openspec/changes/` is added to git (it is part of the project
repo, not a tool-managed artefact). Solo does not run `git add` for
the user; that is the user's commit boundary.
