# Upgrading to peaks-cli 2.0

> **TL;DR for typical users:** `npm i -g peaks-cli@2.0` does everything
> automatically. This document is the manual fallback for when the
> postinstall is skipped (CI with `--ignore-scripts`, environments with
> `PEAKS_SKIP_AUTO_UPGRADE=1`, air-gapped installs, etc.).

---

## One-key path (recommended)

```bash
npm i -g peaks-cli@2.0
```

In your project directory (where you previously ran 1.x), the
postinstall hook runs `peaks upgrade --to 2.0 --auto` if it detects
a 1.x project state. You will see:

```
✓ Detected 1.x peaks-cli project at <project-root>
  → auto-upgraded to 2.0 (N signals resolved)
  Run `peaks audit red-lines --project .` to verify.
```

You're done. Commit the new files that surface in `git status`.

---

## Manual path

If the auto-upgrade was skipped or you want explicit control:

```bash
# 1. Install 2.0 (suppress auto-upgrade if you want to inspect first)
PEAKS_SKIP_AUTO_UPGRADE=1 npm i -g peaks-cli@2.0

# 2. Run the umbrella explicitly
peaks upgrade --to 2.0 --auto --project .
```

The umbrella is **idempotent and soft-fail per sub-step** — partial
failures don't abort the whole upgrade. The result envelope reports
`passedCount` / `failedCount` / `skippedCount` and writes a forensic
record to `.peaks/memory/upgrade-2.0-<YYYY-MM-DD>.md` either way.

---

## What the umbrella does (8 sub-steps)

The umbrella sequences eight operations against your project root:

| # | Step | Underlying CLI | What it does |
|---|---|---|---|
| 0 | `ensure-preferences` | _in-process_ | Writes `.peaks/preferences.json` with the 2.0 default schema if absent. Preserves existing user overrides. This is the file the 1.x detector keys off — without it the detector keeps flagging your project. |
| 0.5 | `gitignore-migrate` | _in-process_ | Detects wholesale `.peaks` / `.peaks/` / `/.peaks` / `/.peaks/` rules in your `.gitignore`, removes them, and appends the canonical 2.0 granular block. Backs up the original to `.gitignore.peaks-2.0-backup-<ISO>`. |
| 1 | `config-migrate` | `peaks config migrate --apply` | Moves per-project fields (`economyMode`, `swarmMode`, headroom, etc.) from `~/.peaks/config.json` to `<project>/.peaks/preferences.json`. Slims `~/.peaks/config.json` to `{ "version": "2.0.0" }`. |
| 2 | `standards-migrate` | `peaks standards migrate --from-claude-rules --apply` | Thins every `.md` under `.claude/rules/` to a 2-line pointer; backs up the originals under `.claude/rules/.peaks-2.0-backup-<ISO>/`; scaffolds `.peaks/standards/{common,typescript}/`. |
| 3 | `memory-extract` | `peaks memory extract --apply` | Walks `skills/`, `.claude/skills/`, `CLAUDE.md`, and `.claude/rules/` for `<!-- peaks-memory:start -->` blocks; writes extracted blocks to `.peaks/memory/<slug>.md`. |
| 4 | `hooks-install` | `peaks hooks install` | Wires the gate-enforcement hook into `.claude/settings.json` (and per-IDE equivalents). |
| 5 | `skill-sync` | `peaks skill sync --all` | Symlinks the skill family across all 8 supported IDE platforms. |
| 6 | `audit-verify` | `peaks audit red-lines` | Runs the L2 audit catalog to verify the upgrade left no red-line regressions. |
| 7 | `write-record` | _in-process_ | Writes `.peaks/memory/upgrade-2.0-<YYYY-MM-DD>.md` with the per-step result table + audit before/after snapshots. |

Each sub-step has its own `--dry-run` mode if you want to preview
without writing. Run any of them manually before the umbrella to
inspect.

---

## What changes in your project tree

### Files created

- `.peaks/preferences.json` — per-project settings (2.0 schema).
- `.peaks/standards/{common,typescript}/*.md` — canonical project
  rules, replacing the 1.x `.claude/rules/` source of truth.
- `.peaks/memory/upgrade-2.0-<YYYY-MM-DD>.md` — forensic upgrade
  record (per-installation; in `.gitignore`).

### Files modified

- `.claude/rules/**/*.md` → 2-line pointer to `.peaks/standards/`.
- `.gitignore` → granular `.peaks/` block (only `_runtime/`,
  `_dogfood/`, `_sub_agents/`, `audit/`, `system/`, `runtime/`,
  `preferences.json`, `memory/upgrade-2.0-*.md` ignored).
- `.claude/settings.json` (and per-IDE equivalents) → gate-enforcement
  hook installed.
- `~/.peaks/config.json` → slimmed to `{ "version": "2.0.0" }`.

### Files backed up

- `.claude/rules/.peaks-2.0-backup-<ISO>/` — verbatim copy of the
  pre-thinning `.claude/rules/` tree.
- `.gitignore.peaks-2.0-backup-<ISO>` — verbatim copy of the
  pre-migration `.gitignore`.
- `~/.peaks/config.json.peaks-2.0-backup-<ISO>` — verbatim copy of
  the pre-slim global config.

All backups carry an ISO-timestamp suffix so re-running the upgrade
multiple times never overwrites a prior backup.

---

## After the upgrade

1. **Inspect `git status`.** New tracked artifacts (`.peaks/standards/`,
   `.peaks/memory/<durable>.md`, `.peaks/PROJECT.md`, opt-in markers,
   the thinned `.claude/rules/*.md` pointers, the new `.gitignore`)
   need to be reviewed and committed.

2. **Verify the L2 audit:**

   ```bash
   peaks audit red-lines --project . --json
   ```

   `totalRedLines` and `cliBacked` should be ≥ the pre-upgrade values.

3. **Verify the 1.x detector no longer flags your project:**

   ```bash
   peaks upgrade --detect-1x --project . --json
   ```

   `data.isOneX` should be `false`. If it's still `true`, check the
   `signals` array for the remaining 1.x markers.

4. **Read your project's new `.peaks/memory/upgrade-2.0-<YYYY-MM-DD>.md`** —
   it carries the per-sub-step exit codes, audit snapshots, and any
   `nextActions` the umbrella emitted (e.g., "removed stale wholesale
   .peaks rule(s)", backup paths).

---

## Rollback

The 2.0 upgrade is non-destructive — every overwriting operation
writes a timestamped backup first. To roll back manually:

```bash
# 1. Restore .claude/rules/
rm -rf .claude/rules/common .claude/rules/typescript .claude/rules/javascript
mv .claude/rules/.peaks-2.0-backup-<ISO>/* .claude/rules/

# 2. Restore .gitignore
mv .gitignore.peaks-2.0-backup-<ISO> .gitignore

# 3. Restore ~/.peaks/config.json
mv ~/.peaks/config.json.peaks-2.0-backup-<ISO> ~/.peaks/config.json

# 4. Remove 2.0 scaffolds
rm -rf .peaks/standards
rm -f .peaks/preferences.json
rm -f .peaks/memory/upgrade-2.0-*.md

# 5. Pin back to a 1.x release
npm i -g peaks-cli@1.4.2
```

---

## Troubleshooting

### "Artifact path must stay inside the project root" during memory-extract

Fixed in 2.0.0. Update via `npm i -g peaks-cli@latest`.

### Detector still says `isOneX: true` after upgrade

Fixed in 2.0.0. The umbrella now ensures `.peaks/preferences.json`
exists. Re-run the umbrella:

```bash
peaks upgrade --to 2.0 --auto --project .
```

### `git status` shows no new tracked files after upgrade

Your `.gitignore` likely has a wholesale `/.peaks/` rule that 2.0.0
auto-migrates. If you're on a pre-2.0.0-final build, manually replace
`/.peaks/` with the canonical block from `gitignore-migrate-service.ts`.

### Windows `peaks slice check` fails with ENOENT

Fixed in 2.0.0. The slice-check now resolves local `node_modules/.bin/`
binaries directly instead of going through `npx`.

### CI installs without postinstall

```bash
npm i -g peaks-cli@2.0 --ignore-scripts  # skip postinstall
peaks upgrade --to 2.0 --auto --project .  # run umbrella explicitly
```

Or use the env-var opt-out:

```bash
PEAKS_SKIP_AUTO_UPGRADE=1 npm i -g peaks-cli@2.0
peaks upgrade --to 2.0 --auto --project .
```

---

## Reference

- Two paired tenets driving the 2.0 design:
  `.peaks/memory/peaks-cli-tenet-one-key-completion.md`
- Skill-first / CLI-auxiliary architecture:
  `.claude/rules/common/dev-preference.md`
- Full CHANGELOG: `CHANGELOG.md`
- Real-world dogfood report (ice-cola, the first project that
  shipped 2.0 surfacing 4 release-blocker bugs): see commits
  `ec6f674..9fa9818` in develop.
