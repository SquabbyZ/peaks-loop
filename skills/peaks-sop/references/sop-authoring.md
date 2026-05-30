# SOP Authoring Reference

Concrete reference for the `peaks-sop` skill: manifest shape, gate cookbook, the
interview → generate → debug loop, and security notes. The skill drives the
`peaks sop` CLI on the user's behalf — this file is the detail behind that.

## Manifest shape (`.peaks/sops/<sop-id>/sop.json`)

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
| there must be NO leftover markers | invert by treating a `fail` as your gate: `grep` passes when the pattern is FOUND, so to require "no FIXME" pair it with a command gate like `["sh","-c","! grep -r FIXME src"]` (requires `--allow-commands`) |
| tests must pass | `{ "type": "command", "run": ["npm", "test"] }` (requires `--allow-commands`) |
| a build must succeed | `{ "type": "command", "run": ["npm", "run", "build"] }` (requires `--allow-commands`) |
| a command must FAIL to pass the gate | add `"expectExitZero": false` to the command check |

Gate verdicts:

- `pass` — the condition is met.
- `fail` — evaluated, condition not met (e.g. file missing, pattern absent, command exited wrong).
- `blocked` — could not evaluate: path escaped the project root, target file unreadable, command not permitted (`--allow-commands` missing) or failed to spawn / timed out.

## Interview → generate → debug loop

1. **Interview.** Ask: what are the ordered stages of this workflow? For each stage, what must be true before you're allowed to enter it? Translate "must be true" into file-exists / grep / command checks.
2. **Scaffold.** `peaks sop init --id <id> --name "<name>" --project <repo> --apply --json`. This writes a starter `sop.json` + `SKILL.md`.
3. **Write the real manifest.** Replace the scaffold's example phases/gates with the interviewed ones by editing `sop.json` directly.
4. **Lint loop.** `peaks sop lint --id <id> --project <repo> --json` → read findings → fix in `sop.json` → re-lint until `ok:true`. Add `--allow-commands` when the SOP uses command gates.
5. **Gate test.** `peaks sop check --id <id> --gate <gate-id> --project <repo> --json` for each gate, in both the good state (expect `pass`) and a bad state (expect `fail`/`blocked`). This is how the user gains confidence the gate does what they meant.
6. **Dry-run the flow.** `peaks sop advance --id <id> --to <phase> --project <repo> --dry-run --json` — confirms a failing gate truly blocks the phase, without recording anything.
7. **Register.** `peaks sop register --id <id> --project <repo> --json` (preview with `--dry-run` first). Now the SOP is enumerable in the registry and can be set as the active skill via presence.

## Security notes (always surface to the user)

- `command` gates run user-defined commands. They are refused unless the user explicitly passes `--allow-commands` to `lint` / `register` / `check` / `advance`. Tell the user a SOP needs `--allow-commands` and what the command does before running it.
- Commands run with an argv array (no shell, no injection), a timeout cap, and cwd pinned to the project root. The command executable itself is not sandboxed — the trust boundary is whoever authored the SOP, the same as an npm script or Makefile target.
- `file-exists` / `grep` paths are confined inside the project root; an out-of-bounds path returns `blocked`, never reads outside the project.
- Side-effecting commands (`init` / `register` / `advance`) support `--dry-run` to preview without writing.

## Bypassing a blocked advance

If the user must move forward despite a failing gate (e.g. a hotfix), advancement can be bypassed explicitly:

```bash
peaks sop advance --id <id> --to <phase> --project <repo> --allow-incomplete --reason "<why>" --json
```

In assisted/strict mode this also requires `--confirm`, and each SOP has a bypass cap. Always record a real reason — the bypass is logged in the SOP's history.
