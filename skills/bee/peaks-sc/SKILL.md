---
name: peaks-sc
description: |
  Source control, sync, and change-control role for Peaks-Loop (LLM-only internal role;
  not user-invocable. Triggered by peaks-code via `peaks sub-agent dispatch --role sc`.)
  Use when a workflow needs change impact, artifact retention, commit boundaries,
  GitHub artifact repository pointers, sync state, or rollback evidence.
visibility: internal
---

<!-- peaks:loop-hygiene — generated block; keep byte-identical in every SKILL.md -->

## Loop hygiene (every turn — MANDATORY)

**Skill header.** While this skill is active, open every turn with
`Peaks-Loop Skill: <skill> | Peaks-Loop Gate: <gate> | Next: <one short action>`.
Every turn, not only the first — it is how the user knows which skill is driving.

**Context is this skill's own business.** Run `peaks skill presence --json` every turn and
read its `context` block. When `action` is `auto-fire`, `pre-compact`, or `red-line`,
run `peaks code auto-compact --project .` **yourself**, then continue. Tell the user the
ratio in one line if it helps, but never hand them the compaction step: asking the user to
run `/compact` is the regression the zero-pause contract forbids. This holds in **every
mode** — standard *and* 24h. The mode moves the threshold, never the obligation.

**Read before you edit.** Read a file before your first `Edit` / `Write` / `MultiEdit` on
it — the normal way to work here — for every path outside `.peaks/**` (source, tests, docs,
config); `.peaks/**` writes are exempt.

**Expect one denial per file anyway — and do NOT pre-empt it.** A `PreToolUse` gate (ECC's
"Fact-Forcing Gate") denies the FIRST edit a session makes to any given path, once, by
design. Reading does NOT prevent it: the gate keys on the path's first touch, not on whether
you read it. **Do not recite its four questions before every edit** — it asks when it wants
them, and reciting unprompted burns a round-trip per file for nothing. Answer only when a
denial actually arrives.

**When one does arrive:** a denial is not a failure and the tool is not broken — your edit
was NOT applied. State the facts it asks for (importers, affected API, data schemas if any,
the user's verbatim instruction), then retry the SAME operation. The retry is allowed. Do not
switch tools, do not give up, do not retry blindly. One more thing worth knowing: an idle gap
of ~30 minutes clears the gate's "already passed" list, so a file you cleared earlier can be
denied again after a long pause. That is the gate resetting, not you regressing.
<!-- /peaks:loop-hygiene -->
---

# Peaks-Loop SC

Peaks-Loop SC records how product, RD, QA, code, and artifacts move together.

## Slice planning first step

The first step in slice planning (before commit-boundary derivation below) is to invoke `peaks-slice-decompose` to produce a v2 topology. The decomposition envelope is the input to every later SC step (impact, retention, boundary). See [peaks-slice-decompose/SKILL.md](../peaks-slice-decompose/SKILL.md).

## Scope directory (slice 10 — read scopeDir from envelope)

The canonical scope dir for this request is provided as `envelope.data.scopeDir` (absolute path). Write all change-id-scoped files under that path. **NEVER** construct paths like `.peaks/_runtime/<sessionId>/...` from frontmatter — the path has already been resolved by the CLI.

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
Then display: `Peaks-Loop Skill: peaks-sc | Peaks-Loop Gate: startup | Next: <one short action>`. Update with `peaks skill presence:set peaks-sc --project <repo> --mode <mode> --gate <gate>` when gates change. When the role's work ends, run `peaks skill presence:clear --project <repo>`.

## Responsibilities

- produce change-impact artifacts;
- record commit boundaries;
- ensure intermediate artifacts are retained locally first;
- track artifact repository pointers when external sync or git retention is explicitly authorized;
- record sync state and rollback points.

## Mandatory per-request artifact

Every SC invocation must write a change-control record at `.peaks/_runtime/<sessionId>/sc/change-control/<rid>.md` linking:

- impact evidence (`peaks sc impact` output);
- retention evidence (`peaks sc retention` output);
- validation result (`peaks sc validate` output);
- boundary record (`peaks sc boundary` output).

Code reads this record before declaring the workflow complete.

## Refactor role

Each refactor slice must leave a traceable local artifact boundary in `.peaks/_runtime/<session-id>/` by default. A git commit boundary containing code changes and PRD/RD/QA/TXT intermediate artifacts is required only when the user or active profile explicitly authorizes committing artifacts.

## GStack integration

Use gstack as a concrete source-control and release workflow reference for the `Ship → Reflect` stages:

- map `/ship` and `/land-and-deploy` concepts to Peaks-Loop commit boundaries, sync state, rollback points, and artifact retention;
- map checkpoint discipline to traceable code-plus-artifact slices;
- do not create PRs, merge, deploy, or mutate shared state unless the active Peaks-Loop workflow and user confirmation explicitly allow it.

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

Use this sequence when SC owns the change-control pass for a refactor or release slice. SC never edits code or tests; it only records boundary evidence through the Peaks-Loop CLI.

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

The final two `--apply` calls require explicit authorization. Without it, default to `--dry-run` or omit the sync calls entirely and keep the boundary evidence local under `.peaks/_runtime/<session-id>/`.

### Transition verification gates (MANDATORY — run the command, see the output)

You cannot declare SC complete from memory. Each gate below is a `ls` command you **MUST run** and whose output you **MUST see** before proceeding.

**Peaks-Loop Gate A — After impact + retention + validate + boundary:**
```bash
ls .peaks/_runtime/<sessionId>/sc/change-control/<rid>.md
# Expected output: .peaks/_runtime/<sessionId>/sc/change-control/<rid>.md
# "No such file" → STOP, write the change-control record first.
```

**Peaks-Loop Gate B — Before declaring SC complete (verify commit boundary is recorded):**
```bash
git log --oneline -5
# Expected: at least one recent commit whose message references the change-id or slice-id.
# No matching commit → STOP, the boundary was not recorded. Re-run steps 3-6.
```

## Boundaries

Do not implement code or test logic. Do not create GitHub repositories directly from the skill body. Use the Peaks-Loop CLI artifact commands.

Reference: `references/artifact-retention.md`.

## L2 surface reference (post rid-l2-extended)

For slices that touch the L2 surface, the canonical CLIs are:
- `peaks worktree {spawn,renew,list,gc,lease-status,release}` — lease lifecycle (Part 1-2)
- `peaks sub-agent dispatch --isolation worktree|container` — auto-spawns a lease (Part 2.C + Part 8 contract)
- `peaks container {spawn,release}` — L4 container runtime (Part 12, docker)
- `peaks lease-metrics [--rate] [--all-sessions]` — per-kind counts + leak rate (Part 4-5)
- `peaks lease-stats` — project-wide summary (Part 6)
- `peaks cron {init,list,run}` + `peaks cron-scheduler start` — periodic lease gc (Part 14-15)
- `peaks audit red-lines --project .` — 119 catalog red-lines / 86 cli-backed enforcers / 51 discovered (Part 13)

Verify the surface (no need to re-derive):
1. `peaks audit red-lines --project .` reports `proseOnly: 0` for any shipped L2 surface.
2. `peaks lease-metrics --rate` after a clean run reports `estimatedLeaked: 0`.
3. `peaks worktree list` returns 0 active leases after a clean run.
