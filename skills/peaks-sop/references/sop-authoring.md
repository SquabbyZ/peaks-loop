# SOP Authoring Reference

Concrete reference for the `peaks-sop` skill: manifest shape, gate cookbook, the
interview → generate → debug loop, and security notes. The skill drives the
`peaks sop` CLI on the user's behalf — this file is the detail behind that.

## Where files live

SOP **definitions** are global and reusable across projects:
`~/.peaks/sops/<sop-id>/sop.json` (+ `SKILL.md`). `init` / `lint` / `register` /
`registry` operate on this global location and take **no `--project`**. A SOP's
**run-state** is per-project: `<project>/.peaks/sop-state/<sop-id>/state.json`.
`check` / `advance` take `--project` (default: current directory) — that says
which project the gate paths resolve against and whose progress advances. One
authored SOP, many projects, independent progress.

## Manifest shape (`~/.peaks/sops/<sop-id>/sop.json`)

```json
{
  "id": "team-release",
  "name": "Team Release",
  "description": "Gates that must pass before we ship a release.",
  "phases": ["draft", "review", "ship"],
  "gates": [
    { "id": "changelog", "phase": "ship", "check": { "type": "file-exists", "path": "CHANGELOG.md" } },
    { "id": "no-fixme", "phase": "review", "check": { "type": "grep", "file": "src/index.ts", "pattern": "FIXME" } },
    { "id": "tests", "phase": "ship", "check": { "type": "command", "run": ["npm", "test"] } }
  ]
}
```

Rules the lint enforces (so generate the manifest to satisfy them):

- `id` — lowercase kebab, starts alphanumeric; must NOT collide with the reserved `peaks-` / `peaks` namespace; must match the directory name.
- `phases` — at least one; no duplicates.
- each gate `id` — lowercase kebab, unique within the SOP.
- each gate `phase` — must be one of the declared `phases`.
- each gate `check` — a known type with its required fields present.

## Gate cookbook

| intent | check |
|--------|-------|
| a file must exist before a phase | `{ "type": "file-exists", "path": "CHANGELOG.md" }` |
| a doc must contain a marker | `{ "type": "grep", "file": "README.md", "pattern": "## Release notes" }` |
| there must be NO leftover markers | `{ "type": "grep", "file": "post.md", "pattern": "TODO", "absent": true }` — passes only when the pattern is absent. Pure text, no `--allow-commands`, cross-platform. Prefer this over a `! grep` command gate. |
| tests must pass | `{ "type": "command", "run": ["npm", "test"] }` (requires `--allow-commands`) |
| a build must succeed | `{ "type": "command", "run": ["npm", "run", "build"] }` (requires `--allow-commands`) |
| a command must FAIL to pass the gate | add `"expectExitZero": false` to the command check |

Gate verdicts:

- `pass` — the condition is met.
- `fail` — evaluated, condition not met (e.g. file missing, pattern absent, command exited wrong).
- `blocked` — could not evaluate: path escaped the project root, target file unreadable, command not permitted (`--allow-commands` missing) or failed to spawn / timed out.

## Cross-domain examples (SOPs are not just for code)

The release example above is one domain. The same engine governs any gated workflow — often the higher-value use. Lead the interview with the user's own domain.

**Content publishing** (`~/.peaks/sops/blog-publish/sop.json`):

```json
{
  "id": "blog-publish",
  "name": "Blog Publish",
  "phases": ["draft", "edit", "publish"],
  "gates": [
    { "id": "draft-exists", "phase": "edit", "check": { "type": "file-exists", "path": "posts/current.md" } },
    { "id": "no-placeholders", "phase": "publish", "check": { "type": "grep", "file": "posts/current.md", "pattern": "TODO|TKTK", "absent": true } }
  ]
}
```

Note `no-placeholders` uses `grep` with `absent: true` — "must not contain a placeholder" — so it needs no `--allow-commands` and works on any OS. This is the single most common non-engineering gate.

**Compliance / approval** (`~/.peaks/sops/vendor-approval/sop.json`):

```json
{
  "id": "vendor-approval",
  "name": "Vendor Approval",
  "phases": ["submitted", "reviewed", "approved"],
  "gates": [
    { "id": "review-notes", "phase": "reviewed", "check": { "type": "file-exists", "path": "vendors/acme/review.md" } },
    { "id": "signed-off", "phase": "approved", "check": { "type": "grep", "file": "vendors/acme/review.md", "pattern": "Status:\\s*Approved" } }
  ]
}
```

**Data pipeline** (`~/.peaks/sops/dataset-release/sop.json`):

```json
{
  "id": "dataset-release",
  "name": "Dataset Release",
  "phases": ["raw", "cleaned", "validated"],
  "gates": [
    { "id": "schema-valid", "phase": "validated", "check": { "type": "command", "run": ["python", "scripts/validate.py", "data/cleaned.csv"] } }
  ]
}
```

These reuse the same three gate types — only the phases and the file/command targets differ. A human-judgment step ("the editor approved") is reified into a file/grep signal (an `approval.md` file, or a status line matching "Approved"), as shown above.

## Interview → generate → debug loop

1. **Interview.** Ask: what are the ordered stages of this workflow? For each stage, what must be true before you're allowed to enter it? Translate "must be true" into file-exists / grep / command checks. For "must NOT contain X", reach for `grep` + `absent: true`.
2. **Scaffold.** `peaks sop init --id <id> --name "<name>" --apply --json`. Writes a starter `sop.json` + `SKILL.md` into the global `~/.peaks/sops/<id>/` (no `--project`).
3. **Write the real manifest.** Replace the scaffold's example phases/gates with the interviewed ones by editing `sop.json` directly.
4. **Lint loop.** `peaks sop lint --id <id> --json` → read findings → fix in `sop.json` → re-lint until `ok:true`. Add `--allow-commands` when the SOP uses command gates.
5. **Gate test.** `peaks sop check --id <id> --gate <gate-id> --project <repo> --json` for each gate, in both the good state (expect `pass`) and a bad state (expect `fail`/`blocked`). `--project` is the project the gate paths resolve against (default: current directory).
6. **Dry-run the flow.** `peaks sop advance --id <id> --to <phase> --project <repo> --dry-run --json` — confirms a failing gate (or a forward phase skip) truly blocks, without recording anything.
7. **Register.** `peaks sop register --id <id> --json` (preview with `--dry-run` first). Now the SOP is enumerable in the global registry and can be set as the active skill via presence.

## Security notes (always surface to the user)

- `command` gates run user-defined commands. They are refused unless the user explicitly passes `--allow-commands` to `lint` / `register` / `check` / `advance`. Tell the user a SOP needs `--allow-commands` and what the command does before running it.
- Commands run with an argv array (no shell, no injection), a timeout cap, and cwd pinned to the project root. The command executable itself is not sandboxed — the trust boundary is whoever authored the SOP, the same as an npm script or Makefile target.
- `file-exists` / `grep` paths are confined inside the project root; an out-of-bounds path returns `blocked`, never reads outside the project.
- Side-effecting commands (`init` / `register` / `advance`) support `--dry-run` to preview without writing.

## Bypassing a blocked advance

If the user must move forward despite a failing gate **or a forward phase skip** (e.g. a hotfix that skips review), advancement can be bypassed explicitly:

```bash
peaks sop advance --id <id> --to <phase> --project <repo> --allow-incomplete --reason "<why>" --json
```

`--allow-incomplete` bypasses both the gate checks and the phase-order check. In assisted/strict mode this also requires `--confirm`, and each SOP has a per-project bypass cap. Always record a real reason — the bypass is logged in that project's SOP history.
