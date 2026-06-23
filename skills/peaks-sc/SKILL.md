---
name: peaks-sc
description: Source control, sync, and change-control skill for Peaks. Use when a workflow needs change impact, artifact retention, commit boundaries, GitHub artifact repository pointers, sync state, or rollback evidence.
---

# Peaks-Cli SC

Peaks-Cli SC records how product, RD, QA, code, and artifacts move together.

## Scope directory (slice 10 — read scopeDir from envelope)

The canonical scope dir for this request is provided as `envelope.data.scopeDir` (absolute path). Write all change-id-scoped files under that path. **NEVER** construct paths like `.peaks/<changeId>/...` from frontmatter — the path has already been resolved by the CLI.

## Skill presence (MANDATORY first action)

Before any analysis or tool call, immediately run:

```bash
peaks skill presence:set peaks-sc --project <repo> --mode <mode> --gate startup
```

On the first presence:set in a project, ensure the out-of-band status bar is installed so the user can see at a glance that Peaks is orchestrating — it renders the active skill in Claude Code's terminal status line, independent of model output:

```bash
peaks statusline install --project <repo>   # idempotent; skips if already installed
```

Read persistent project memory via CLI (durable, LLM-authored memories):

```bash
peaks project memories --project <repo> --json
```

This returns durable memories from `.peaks/memory` — decisions, conventions, modules, and rules captured in past sessions. Filter with `--kind <decision|convention|module|rule|reference|project>`. (`.peaks/PROJECT.md` is a human-readable session timeline only.)
Then display: `Peaks-Cli Skill: peaks-sc | Peaks-Cli Gate: startup | Next: <one short action>`. Update with `peaks skill presence:set peaks-sc --project <repo> --mode <mode> --gate <gate>` when gates change. When the role's work ends, run `peaks skill presence:clear --project <repo>`.

## Responsibilities

- produce change-impact artifacts;
- record commit boundaries;
- ensure intermediate artifacts are retained locally first;
- track artifact repository pointers when external sync or git retention is explicitly authorized;
- record sync state and rollback points.

## Mandatory per-request artifact

Every SC invocation must write a change-control record at `.peaks/<id>/sc/change-control/<rid>.md` linking:

- impact evidence (`peaks sc impact` output);
- retention evidence (`peaks sc retention` output);
- validation result (`peaks sc validate` output);
- boundary record (`peaks sc boundary` output).

Solo reads this record before declaring the workflow complete.

## Refactor role

Each refactor slice must leave a traceable local artifact boundary in `.peaks/<session-id>/` by default. A git commit boundary containing code changes and PRD/RD/QA/TXT intermediate artifacts is required only when the user or active profile explicitly authorizes committing artifacts.

## GStack integration

Use gstack as a concrete source-control and release workflow reference for the `Ship → Reflect` stages:

- map `/ship` and `/land-and-deploy` concepts to Peaks-Cli commit boundaries, sync state, rollback points, and artifact retention;
- map checkpoint discipline to traceable code-plus-artifact slices;
- do not create PRs, merge, deploy, or mutate shared state unless the active Peaks-Cli workflow and user confirmation explicitly allow it.

## Project memory backup

Project `.peaks/memory` is the primary source for durable project memory. At approved checkpoints, use `peaks memory sync --project <path> --workspace <artifact-workspace> --apply` to back up the full project memory directory into the artifact repository workspace; do not treat the artifact backup as a second writable memory source.

## Commit boundary derivation

**Primary path — OpenSpec available:** When `openspec/changes/<id>/tasks.md` exists, derive commit boundaries from it:

- `peaks openspec to-rd <id> --project <repo> --json` returns `commitBoundaries[]`, one entry per tasks.md heading.
- Default to one commit per heading. Each commit message references the change-id and the section heading.
- If implementation produces diffs outside any todo, surface that as out-of-scope before closing SC.

**Fallback — OpenSpec missing:** When `openspec/` does not exist or `peaks openspec to-rd` fails:

- derive commit boundaries from the RD request artifact's slice spec and the current `git diff --stat`;
- group changed files by module or feature area, one commit per group;
- record in the change-control artifact that boundaries were derived from git diff, not OpenSpec, so downstream reviewers know the source.

Concrete rules: `references/openspec-commit-boundaries.md`.

## Default runbook

Use this sequence when SC owns the change-control pass for a refactor or release slice. SC never edits code or tests; it only records boundary evidence through the Peaks-Cli CLI.

```bash
# 0. Confirm SC's own runbook integrity before recording boundary evidence
# in:  none
# out: runbook version, presence set
peaks skill runbook peaks-sc --json
peaks skill presence:set peaks-sc --project <repo>  # show persistent skill presence every turn

# 1. Derive commit boundaries (OpenSpec preferred, git diff fallback)
# in:  change-id, repo path
# out: commitBoundaries[] or fallback git diff grouping
peaks openspec to-rd <change-id> --project <repo> --json

# 2. Inventory artifacts already produced by other roles for this session
# in:  repo path, session-id
# out: artifact list with paths and statuses
peaks artifacts status --project <repo> --json
peaks artifacts workspace --workspace <session-id> --json

# 3. Record change impact for the slice
# in:  change-id, module, file path
# out: impact record (JSON)
peaks sc impact --change-id <change-id> --module <module> --file <path> --json

# 4. Record retention evidence linking PRD / RD / QA artifacts
# in:  slice-id, artifact paths from other roles
# out: retention record (JSON)
peaks sc retention --slice-id <slice-id> --prd <prd-path> --rd <rd-path> --qa <qa-path> --json

# 5. Validate retention completeness
# in:  slice-id
# out: validation result (pass/fail + missing items)
peaks sc validate --slice-id <slice-id> --json

# 6. Record the commit boundary for the slice
# in:  slice-id, artifact path, code file path
# out: boundary record (JSON)
peaks sc boundary --slice-id <slice-id> --artifact <artifact-path> --code <code-file> --json

# 7. Sync memory and artifacts (requires explicit authorization)
# in:  repo path, workspace
# out: sync result or dry-run preview
peaks memory sync --project <repo> --workspace <workspace> --apply --json
peaks artifacts sync --workspace <workspace> --apply --json
peaks skill presence:clear --project <repo>                      # SC complete, remove presence indicator
```

The final two `--apply` calls require explicit authorization. Without it, default to `--dry-run` or omit the sync calls entirely and keep the boundary evidence local under `.peaks/<session-id>/`.

### Transition verification gates (MANDATORY — run the command, see the output)

You cannot declare SC complete from memory. Each gate below is a `ls` command you **MUST run** and whose output you **MUST see** before proceeding.

**Peaks-Cli Gate A — After impact + retention + validate + boundary:**
```bash
ls .peaks/<id>/sc/change-control/<rid>.md
# Expected output: .peaks/<id>/sc/change-control/<rid>.md
# "No such file" → STOP, write the change-control record first.
```

**Peaks-Cli Gate B — Before declaring SC complete (verify commit boundary is recorded):**
```bash
git log --oneline -5
# Expected: at least one recent commit whose message references the change-id or slice-id.
# No matching commit → STOP, the boundary was not recorded. Re-run steps 3-6.
```

## Boundaries

Do not implement code or test logic. Do not create GitHub repositories directly from the skill body. Use the Peaks-Cli CLI artifact commands.

Reference: `references/artifact-retention.md`.
