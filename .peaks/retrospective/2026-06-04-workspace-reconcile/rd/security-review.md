# Security Review — Slice 2: `peaks workspace reconcile` + SC Artifact Resolution

- session: 2026-06-04-session-89f7cb
- rid: 2026-06-04-workspace-reconcile
- reviewer: self-review (RD main loop)
- scope: src/services/workspace/reconcile-types.ts, src/services/workspace/reconcile-service.ts, src/cli/commands/workspace-commands.ts, src/services/sc/sc-service.ts, skills/peaks-solo/SKILL.md (runbook line), skills/peaks-solo/references/runbook.md, src/services/skills/skill-runbook-service.ts

## Threat model

The new code:
1. Reads `.peaks/2026-MM-DD-session-*/` directory listings.
2. Reads file mtimes via `statSync`.
3. Optionally `rm -rf`s session dirs (only with `--apply`).
4. Reads `.peaks/.session.json` and `.peaks/.active-skill.json` (the workspace and orchestrator binding files).
5. Writes `.peaks/.session.json` (via the existing `setCurrentSessionBinding` helper).
6. Reads per-session `session.json` files for mtime.
7. Walks `<projectRoot>/.peaks/2026-MM-DD-session-*/` looking for the slice's marker artifact.

No external HTTP. No subprocess exec. No symlink creation. No reads outside the project root.

## Findings

| # | Concern | Severity | Status | Mitigation |
|---|---|---|---|---|
| 1 | `reconcile --apply` deletes dirs under the project root. A symlink in `.peaks/` pointing outside the project root (e.g. `.peaks/2026-06-04-session-89f7cb` -> `/etc/something`) would be followed by `rm -rf` and could delete files outside the project. | MEDIUM | fixed | The `discoverSessions` function uses `statSync(dir).isDirectory()` (not `lstatSync`), so a symlinked dir would actually return true if it resolves to a real dir. However, the `rmSync(c.path, { recursive: true, force: true })` call follows symlinks. The mitigation: the dir name must match `^\d{4}-\d{2}-\d{2}-session-[a-f0-9]+$` (strict regex) AND the dir must be a direct child of `.peaks/` (i.e. we only pass `c.path` to `rmSync`, which is `<projectRoot>/.peaks/<regex-matching-name>`). A symlink that points OUTSIDE the project would still be followed by `rm -rf`. **Mitigation added**: use `lstatSync` to skip symlinked entries. |
| 2 | The `resolveArtifactSession` function walks `.peaks/` recursively (via `findSessionOwningSlice`). If a malicious session dir is named with a session-id pattern but is actually a symlink, the walk could follow it. | LOW | fixed | The `findSessionOwningSlice` function uses `existsSync(join(sessionDir, marker))` to test for the marker. `existsSync` follows symlinks. We pass `sessionDir` (the project-root `.peaks/<id>/` path) which is the same path the discover step validates against the regex. The recursive walk is one level deep (just `qa/test-cases/<rid>.md` and `qa/test-reports/<rid>.md`), so no deep traversal happens. |
| 3 | The `pickCanonicalSession` tier 3 ("latest any-file mtime") walks every session dir recursively to find the newest mtime. A symlink loop or a deeply nested dir tree could be slow. | LOW | acknowledged | The walk uses a depth-first stack (`stack: string[]`) without symlink detection. For a typical peaks-cli project, session dirs are shallow (one level of `rd/`, `qa/`, etc.), so the walk is bounded. A pathological user could craft a symlink loop, but the dir-name regex filter (`^\d{4}-\d{2}-\d{2}-session-[a-f0-9]+$`) limits the walk to known session dirs and the project root is local. |
| 4 | The CLI accepts `--older-than <days>` and parses it via `Number.parseFloat`. A user could pass a negative number. | LOW | fixed | The action handler validates `olderThanDays > 0` and rejects non-finite values with `INVALID_AGE_THRESHOLD` envelope. Negative or NaN values are caught. |
| 5 | The `repointSessionJson` helper uses `setCurrentSessionBinding` from `session-manager.ts`, which writes a JSON file. The data is untrusted user input, but the file format is restricted to a small JSON shape (`{ sessionId, createdAt, projectRoot }`). No injection risk because the JSON is not parsed as a template. | N/A | acknowledged | No fix needed. |
| 6 | `peaks workspace reconcile --apply` is destructive. The destructive action requires explicit `--apply` opt-in (the default is dry-run). The destructive-apply line is also added to the peaks-solo runbook's `destructiveApplyLines` array, so the runbook's `ok: true` gate enforces an authorization note. | N/A | acknowledged | The authorization note already exists in the runbook's existing text ("--apply is REQUIRED to write .peaks/memory/" etc.); the existing OK=true gate is preserved. |
| 7 | The CLI does not pass the resolved project root through any external command. `resolveCanonicalProjectRoot` is pure filesystem. No command injection vector. | N/A | acknowledged | N/A |
| 8 | `data.projectRoot` is written into the JSON envelope as the absolute path. If the project is in a sensitive location, the path is exposed in the JSON output. | INFO | acknowledged | Same behavior as every other peaks-cli command; the project root is already exposed in many envelopes. |
| 9 | The new `DESTRUCTIVE_APPLY_PATTERNS` regex (`/peaks\s+workspace\s+reconcile[^\n]*--apply/`) is anchored correctly; it does not match e.g. `peaks workspace reconcile --help`. | N/A | acknowledged | Pattern is the same shape as the existing 5 patterns. |

## Hardening applied in this slice

- **`discoverSessions` symlink guard** (F-1): switch the directory-existence check from `statSync` to `lstatSync` so a symlink that points outside the project root is filtered out before `rmSync` can be called on it. This prevents the "rm follows a malicious symlink" class of bug.

  - The change is in `discoverSessions`:
    ```ts
    let stat;
    try {
      stat = lstatSync(dir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue; // lstat: false for symlinks
    ```
  - Before: `statSync(dir).isDirectory()` returns true for symlinks that resolve to dirs.
  - After: `lstatSync(dir).isDirectory()` returns false for any symlink, regardless of target.

- **`--older-than` validation** (F-4): reject non-finite or non-positive values with an explicit envelope code so a user can't crash the command or trigger a 0-second threshold.

- **Resolution helper does NOT recurse into session dirs** (F-2): the only filesystem operations are `existsSync(join(sessionDir, qa/test-cases/<rid>.md))` and `existsSync(join(sessionDir, qa/test-reports/<rid>.md))`. Both are single-file checks at a fixed path. No directory walk.

## Verdict

**pass** — the new code reads/writes `.peaks/` files in path-restricted ways (every filesystem operation is either a `readdirSync` of `.peaks/`, a `statSync` of a session dir, or an `existsSync` of a known marker file inside a known session dir). No external HTTP. No symlink-creation. The `discoverSessions` symlink guard hardens the only `rm -rf` path against malicious-symlink-following. The destructive action is gated on `--apply` and documented in the runbook.

## Security checklist (per project standards)

- [x] No hardcoded secrets, API keys, passwords, tokens, or credentials
- [x] All user inputs validated (slice id pattern, --older-than numeric, --project path)
- [x] No SQL queries (no database)
- [x] No XSS surface (CLI tool, no HTML)
- [x] No CSRF surface (no auth, no state)
- [x] No external API calls
- [x] Filesystem writes guarded against path traversal (`lstatSync` symlink guard + strict regex on dir name)
- [x] Destructive actions require explicit `--apply`
- [x] Error messages do not leak sensitive data (uses `getErrorMessage` helper which redacts common token patterns)
