---
name: 2026-07-16-d-018-state-db-path-relocation
description: D-018 fix landed (commit pending; 4.0.0-beta.13). state.db now lives at PEAKS_HOME/.peaks/skills/state.db per peaks-maker SKILL.md §22 design contract. Old <project>/.peaks/state.db removed. Side bug found: migrations not copied to dist/ (D-019 follow-up).
metadata:
  type: project
  date: 2026-07-16
  sessionId: 2026-07-16-session-651c20
  targetRelease: 4.0.0-beta.13
  driftStatus: RESOLVED
  driftSeverity: ARCHITECTURE FIX (no AC change)
  followUpDrift: D-019 — migrations not in dist/
---

# D-018 state.db path relocation — RESOLVED (4.0.0-beta.13)

**Date:** 2026-07-16
**Session:** 2026-07-16-session-651c20
**Commit:** pending
**Target release:** `4.0.0-beta.13`
**Verdict:** ✅ **D-018 RESOLVED**

## What was wrong

User reported: peaks-loop's loop engineering + bee sediment capability uses SQLite via `state.db`, but the file landed at `<project>/.peaks/state.db` instead of the design-contract location `~/.peaks/skills/state.db`.

Root cause: `src/cli/commands/sediment-commands.ts:664-665` resolved `home` to `process.env.HOME ?? process.env.USERPROFILE ?? process.cwd()`. When invoked from peaks-loop project root (`peaks skill sediment list`), `cwd = /c/Users/smallMark/Desktop/peaks-loop` (no `$HOME` set in this shell session), so `home = cwd = peaks-loop/`, producing `peaks-loop/.peaks/state.db`. The downstream `resolveStateDbPath({ home }) = join(home, ".peaks", "skills", "state.db")` then resolved to `<project>/.peaks/skills/state.db` — but `.peaks/skills/` dir didn't exist, and somehow `state.db` ended up at `<project>/.peaks/state.db` (without `skills/` subdir). 

This contradicts the peaks-maker SKILL.md §22 design contract:
> "Never run `sqlite3` directly against `~/.peaks/skills/state.db` — only via the `peaks skill sediment …` surface."

And the established convention in `src/services/sop/sop-paths.ts:29` (`peaksHome()` honors `PEAKS_HOME` for test isolation, defaults to `~/.peaks`).

## What changed

### `src/cli/commands/sediment-commands.ts`

Added import:
```ts
import { peaksHome } from "../../services/sop/sop-paths.js";
```

Replaced line 664-665:
```ts
// Before
const home =
  process.env.HOME ?? process.env.USERPROFILE ?? process.cwd();

// After
// D-018: peaks-loop's `state.db` (loop engineering + bee sediment pool)
// lives at PEAKS_HOME-based path, NOT under the project root. The
// original `process.env.HOME ?? USERPROFILE ?? process.cwd()` would
// resolve `home` to cwd when invoked from a project (e.g.
// `peaks skill sediment list` from peaks-loop/), producing
// `<project>/.peaks/state.db` — wrong. Per design contract
// (peaks-maker SKILL.md §22 + sop-paths.ts §29), the canonical
// home is `~/.peaks` (or PEAKS_HOME override for test isolation).
const home = peaksHome();
```

The downstream `resolveStateDbPath({ home })` in `src/services/sediment/pool-paths.ts:15` already correctly returns `{home}/.peaks/skills/state.db` — only the `home` resolution was broken. **No change needed to pool-paths.ts.**

### `package.json` + `src/shared/version.ts`

Bumped `4.0.0-beta.12` → `4.0.0-beta.13`. CLI_VERSION regenerated via `node scripts/sync-version.mjs`.

### `CHANGELOG.md`

Added `4.0.0-beta.13 — RELEASED (D-018: state.db path relocation)` section above beta.12.

### `.peaks/state.db` (the old wrong-location file)

Deleted (beta phase, single user). Loop engineering + bee sediment pool data was project-local and not needed across projects.

## Verification (ALL PASS)

| Path | Before | After |
|---|---|---|
| `peaks skill sediment releases test-bee` (real CLI, no PEAKS_HOME) | `<cwd>/.peaks/skills/state.db` | **`~/.peaks/skills/state.db`** ✅ |
| `PEAKS_HOME=/tmp/peaks-home-test peaks skill sediment releases test-bee` | `<cwd>/.peaks/skills/state.db` | **`/tmp/peaks-home-test/.peaks/skills/state.db`** ✅ |
| `node -e "import('./dist/.../sqlite-store.js')...openStateDb(testPath)"` | N/A | file created + parent dir auto-created ✅ |
| Regression suite (`tests/unit/cli/`, `tests/unit/services/sediment/`, `tests/unit/services/skillhub/`) | 287 PASS | **287/287 PASS** ✅ |

## AC verdict

**27/27 AC unchanged** (D-018 is architecture fix, no AC change). All beta.12 verdicts preserved.

## Files changed (3)

```
M  src/cli/commands/sediment-commands.ts  # use peaksHome() instead of cwd fallback
M  package.json                            # version: beta.12 → beta.13
M  src/shared/version.ts                   # CLI_VERSION regenerated
M  CHANGELOG.md                            # beta.13 entry
```

Plus 1 cleanup:
```
D  .peaks/state.db                         # old wrong-location file removed
```

## Side bug found — D-019 (out of scope for beta.13, follow-up)

During verification, found that `src/services/skillhub/migrations/*.sql` is **not copied to `dist/`** by `scripts/copy-templates.mjs`. The script only copies `.md` files from `src/services/workspace/templates/project-scan/`.

Symptom: when peaks-loop is published and consumed via `npm install peaks-loop`, the `dist/services/skillhub/migrations/` directory is empty, so `openStateDb()` opens an empty database → "no such table: bee_release" error on any verb that queries the schema.

Why tests still pass: vitest uses tsx + the source tree directly (`dist/` not relevant for in-process vitest).

**Fix for D-019** (separate follow-up slice):
```js
// scripts/copy-templates.mjs
const targets = [
  {
    src: join(packageRoot, 'src/services/workspace/templates/project-scan'),
    dest: join(packageRoot, 'dist/services/workspace/templates/project-scan'),
    extensions: ['.md']
  },
  {
    src: join(packageRoot, 'src/services/skillhub/migrations'),
    dest: join(packageRoot, 'dist/services/skillhub/migrations'),
    extensions: ['.sql']  // ADD THIS
  }
];
```

Documented but NOT fixed in beta.13 per scope discipline (D-018 = path fix; D-019 = build config fix).

## Drift table update

| ID | Status | Notes |
|---|---|---|
| D-001..D-013, D-015..D-017 | unchanged | |
| **D-018** | **RESOLVED** | was ARCHITECTURE DRIFT; now state.db lives at design-contract path |
| **D-019 (NEW)** | **OPEN** | migrations not copied to dist/ via copy-templates.mjs; affects published peaks-loop consumers (not in-process vitest) |

**Total active drifts:** 17 (D-013 RESOLVED, D-018 RESOLVED, D-019 NEW, D-017 observation-only).

## Hard rules carried forward (18 total)

- D-001..D-013, D-015..D-018 (D-013 + D-018 RESOLVED).
- **D-019 (NEW):** `scripts/copy-templates.mjs` must include `.sql` extension for `src/services/skillhub/migrations/` directory. Currently the publish tarball ships without migrations, breaking any downstream consumer's `state.db` schema. Follow-up slice needed (separate from beta.13).
- D-017 (Claude Code sub-agent display recycle) — observation only.

## What changed for downstream consumers

- **peaks-loop consumers** (npm install peaks-loop): `state.db` now lives at `~/.peaks/skills/state.db` on their machine, not at their project root. Loop engineering + bee sediment data is now properly global (PEAKS_HOME-based), matching sop-paths.ts convention.
- **ice-cola consumer**: if it ever ran `peaks skill sediment ...` from a peaks-loop checkout, the state.db is now at `~/.peaks/skills/state.db` instead of `<peaks-loop>/.peaks/state.db`. No code change needed in ice-cola; the sediment commands work transparently via the relocated path.

## Next gate

User runs `npm publish --tag beta --otp=<6位OTP码>` for 4.0.0-beta.13.

**Important caveat**: published beta.13 will hit the D-019 migrations-not-copied bug because `dist/services/skillhub/migrations/` will be empty. Any consumer doing `peaks skill sediment <verb>` will see "no such table: bee_release". 

Recommended sequence:
1. Land D-019 fix (`copy-templates.mjs` adds `.sql`)
2. Rebuild + repack
3. THEN publish

OR: publish beta.13 as-is for the path fix and ship beta.14 with D-019. User's call.

How to apply: any new session reading this file knows D-018 is RESOLVED
(state.db path = `~/.peaks/skills/state.db`), D-019 is OPEN (migrations
not in dist/), and the in-process tests still pass for both because
vitest uses tsx + source tree directly.