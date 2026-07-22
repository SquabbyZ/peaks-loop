---
"peaks-loop": patch
---

## 4.0.0-beta.21 — 2026-07-22 (ice-cola surface-check follow-ups)

This release bundles four bug fixes and one dependency-cleanup chore
surfaced during the 2026-07-22 ice-cola real-world full-surface test
of `peaks-loop@4.0.0-beta.20`. Each fix has a regression test in the
suite so it cannot silently come back.

### Bug fixes

- **standardsMissing UX (`fix(standards)`)** — `peaks workspace init`
  previously reported `standardsMissing.missing: true` with the
  remediation text "no project-local standards found" whenever the
  language overlay was empty, even when common was clearly populated
  (ice-cola shape: common/*.md + typescript overlay populated, but
  no javascript/ dir). The detector now distinguishes three states
  (`complete` / `common-missing` / `language-missing`) and the
  remediation text calls out the precise failing component.

- **`peaks statusline` default action (`fix(statusline)`)** — `peaks
  statusline` (no subcommand) was documented as "Run with no
  subcommand to render" but commander was printing usage instead of
  dispatching to the hidden `render` subcommand. The fix attaches
  a default `.action(...)` on the parent `statusline` command that
  delegates to a public `runDefaultStatuslineRender` body, and adds
  `--project <path>` to the parent so the default path inherits the
  project label.

- **release-pack test version pinning (`fix(release-tests)`)** —
  five `tests/unit/release/*.test.ts` files hard-coded `'4.0.0-beta.17'`
  and `'0.0.4'` literals. Root bumping from 4.0.0-beta.17 to
  4.0.0-beta.20 made three tests fail immediately, demonstrating the
  tests were carrying version knowledge the production code does not.
  Expectations now derive from the on-disk `package.json` instead,
  so future version bumps are a no-op for the suite.

- **`peaks preferences` unknown-key error (`fix(preferences)`)** —
  the prior error was `PREFERENCES_KEY_UNKNOWN: <key>` which forced
  the operator to look up valid keys elsewhere. All three sites
  (`get` / `set` / `reset`) now throw via a shared `unknownKeyError`
  helper that includes the sorted `ALLOWED_KEYS_LIST` inline.

### Chore

- **`chore(deps)`** — Migrate `onlyBuiltDependencies: [better-sqlite3]`
  out of `package.json#pnpm` (no longer read by pnpm 10.11+) into
  `.npmrc` as the canonical pnpm config key. Silences the per-package
  `WARN  The "pnpm" field in package.json is no longer read by pnpm`
  log line without changing install behavior.

### Validation

- `vitest tests/unit/standards/missing-standards-detector.test.ts` — 18/18
- `vitest tests/unit/cli/commands/statusline-default-render.test.ts` — 3/3
- `vitest tests/unit/release` — 20/20
- `vitest tests/integration/preferences-cli.test.ts` — 5/5
- `PEAKS_DRY_RUN=1 node scripts/release-pack.mjs` — 9/9 packages, zero WARN
