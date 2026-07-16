---
name: 2026-07-17-d-019-migrations-not-copied-RESOLVED
description: D-019 fix landed (commit pending; 4.0.0-beta.14). SkillHub SQLite migrations now reach the published tarball end-to-end: copy-templates.mjs includes .sql + package.json files[] whitelist includes dist/**/*.sql. Tarball verified to contain all 6 migrations.
metadata:
  type: project
  date: 2026-07-17
  sessionId: 2026-07-16-session-651c20
  targetRelease: 4.0.0-beta.14
  driftStatus: RESOLVED
  driftSeverity: BLOCKER FOR PUBLISH (was breaking downstream consumers)
  followUpDrift: none
---

# D-019 migrations not copied to dist/ — RESOLVED (4.0.0-beta.14)

**Date:** 2026-07-17
**Session:** 2026-07-16-session-651c20
**Commit:** pending
**Target release:** `4.0.0-beta.14`
**Verdict:** ✅ **D-019 RESOLVED** (full end-to-end)

## What was wrong

`src/services/skillhub/migrations/*.sql` (the SkillHub SQLite schema) was not
present in the published `peaks-loop` tarball. Symptom: downstream consumers
running `npm install peaks-loop` and then `peaks skill sediment <verb>`
would hit `no such table: bee_release` because `openStateDb()` opened a
schema-less database.

Root cause: TWO missing pieces, neither alone was sufficient:

1. **`scripts/copy-templates.mjs`** only copied `.md` files from
   `src/services/workspace/templates/project-scan/`. It did not have a
   target block for `src/services/skillhub/migrations/` with `.sql`
   extension. → migrations never reached `dist/`.

2. **`package.json` `"files"` whitelist** included only
   `dist/cli/index.js` + `dist/**/*.js | .d.ts | .md`. Even after step 1
   (migrations in `dist/`), the npm pack whitelist would filter them
   out of the tarball.

In-process vitest tests did NOT catch this because vitest uses tsx +
source tree directly (bypasses both `dist/` and the npm pack whitelist).

## What changed

### `scripts/copy-templates.mjs`

Added a new target block for migrations:
```js
const targets = [
  {
    src: join(packageRoot, 'src/services/workspace/templates/project-scan'),
    dest: join(packageRoot, 'dist/services/workspace/templates/project-scan'),
    extensions: ['.md']
  },
  {
    // D-019: SkillHub SQLite migrations must reach the published tarball
    // so `openStateDb()` can apply the schema on first run.
    src: join(packageRoot, 'src/services/skillhub/migrations'),
    dest: join(packageRoot, 'dist/services/skillhub/migrations'),
    extensions: ['.sql']
  }
];
```

Build output now confirms: `copy-templates: .../skillhub/migrations -> .../skillhub/migrations (+6 files)`.

### `package.json` `"files"` whitelist

Added `dist/**/*.sql`:
```json
"files": [
  "bin/peaks.js",
  "dist/cli/index.js",
  "dist/**/*.js",
  "dist/**/*.d.ts",
  "dist/**/*.md",
  "dist/**/*.sql",  // ← ADDED
  ...
]
```

### `package.json` + `src/shared/version.ts`

Bumped `4.0.0-beta.13` → `4.0.0-beta.14`. CLI_VERSION regenerated.

### `CHANGELOG.md`

Added `4.0.0-beta.14 — RELEASED (D-019: copy-templates.mjs + package.json files[])`.

## Verification (ALL PASS)

| Check | Result |
|---|---|
| `pnpm build` | exit 0; `copy-templates: ...skillhub/migrations (+6 files)` ✅ |
| `ls dist/services/skillhub/migrations/` | 6 files: `001-initial.sql` ... `006-crystallization-event.sql` ✅ |
| `npm pack --pack-destination .pack-cache` | exit 0; tarball 30MB ✅ |
| `tar -tzf .pack-cache/peaks-loop-4.0.0-beta.14.tgz \| grep skillhub/migrations` | 6 files present in tarball ✅ |
| Tarball `package.json` `version` | `4.0.0-beta.14` ✅ |
| Regression suite | **287/287 PASS** ✅ |

## AC verdict

**27/27 AC unchanged** (D-019 is build/packaging fix, no AC change).

## Files changed (3)

```
M  scripts/copy-templates.mjs          # added migrations target block
M  package.json                        # version + files[] whitelist
M  src/shared/version.ts               # CLI_VERSION regenerated
M  CHANGELOG.md                        # beta.14 entry
```

## Drift table update

| ID | Status | Notes |
|---|---|---|
| D-001..D-013, D-015..D-018 | unchanged | |
| **D-018** | RESOLVED | state.db path fix (beta.13) |
| **D-019** | **RESOLVED** | migrations + files[] whitelist fix (beta.14) |
| D-017 | observation-only | |

**Total active OPEN drifts:** 0. All architectural / packaging issues closed.

## Why D-019 needed TWO changes, not one

This was a 2-step root cause. Initial instinct was to fix only
`copy-templates.mjs` (add `.sql` target). Testing the tarball showed
the migrations were still missing because `package.json` `files[]`
whitelist filtered them out. This is a common "two-bug-in-series"
pattern: each fix unmasks the next. Future copy-template additions
should ALWAYS add the corresponding `dist/**/*.ext` to `package.json`
`files[]` whitelist.

## Hard rules carried forward

- D-001..D-013, D-015..D-018 (closed). D-017 (observation-only).
- **D-020 (NEW, anti-pattern rule):** Whenever `scripts/copy-templates.mjs`
  adds a new file extension or source directory, **MUST also add the
  corresponding `dist/**/*.ext` glob to `package.json` `"files"` whitelist.**
  The whitelist is a separate filter from the copy step; missing either
  results in a broken published tarball. Verified against this D-019
  fix: copy-templates ran successfully + produced files in `dist/`, but
  those files were filtered out at pack time because the whitelist
  didn't include `dist/**/*.sql`.

## What changed for downstream consumers

- **npm install peaks-loop**: `state.db` schema is now correctly initialized
  on first `peaks skill sediment <verb>` call. No more
  `no such table: bee_release`.
- **ice-cola consumer**: no change needed; ice-cola is a downstream npm
  consumer that was previously at risk of the D-019 bug. beta.14 fixes
  the risk retroactively.
- **In-process tests** (vitest + tsx): no change; tests were always
  green because they bypass `dist/`.

## Next gate

User runs `npm publish --tag beta --otp=<6位OTP码>` for 4.0.0-beta.14.

**Pre-publish sanity** (recommended):
```bash
peaks --version                                         # 4.0.0-beta.14
node bin/peaks.js skill sediment releases test 2>&1     # should succeed (no missing-table error)
PEAKS_HOME=/tmp/sanity-check node bin/peaks.js skill sediment releases test 2>&1
ls /tmp/sanity-check/.peaks/skills/state.db             # should exist with non-zero size
```

If the `peaks skill sediment releases test` returns success (not
`no such table: bee_release`), D-019 is fully resolved end-to-end and
the tarball is safe to publish.

How to apply: any new session reading this file knows D-019 is RESOLVED
via a 2-step fix (`copy-templates.mjs` + `package.json` `files[]`), and
that future template additions need to coordinate BOTH layers.