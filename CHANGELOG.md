# Changelog

All notable changes to peaks-cli are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.9.0] — 2026-06-25 — Path canonicalization + fan-out mandatory + test-tool-detection

**MINOR bump from 2.8.4** (supersedes the unpublished 2.9.1 / 2.9.2 intermediate work; those entries below are kept as historical context only).

### Features

- **Sub-agent fan-out is mandatory** (slice `2026-06-24-audit-5th-p2`): `preferences.fanout.defaultMode = 'serial'` opt-out removed. When the slice DAG has ≥ 2 leaves at one topological level, the orchestrator MUST use `peaks sub-agent dispatch --from-dag <dag-file> --batch-id <id>`. No preference, env-var, or CLI flag overrides this. `FANOUT_MODES = ['fan-out']` only; legacy `serial` values auto-migrate via `peaks preferences migrate --write`.
- **4-policy bundle (slice `2026-06-24-efficiency-4p-bundle`)**: (a) default fan-out via `--from-dag`; (b) periodic checkpoint frequency locked at 20 tool calls (no `~` approximation, no `--periodic-every` override); (c) Karpathy reviewer skipped for `config | docs | chore` request types (5-way review otherwise); (d) `swarmSpeculative.maxConcurrent` default bumped 2 → 3.
- **Test-tool-detection block** (slice `2026-06-24-test-tool-detection-injection`): Every sub-agent dispatched by Solo (`peaks-rd`, `peaks-qa`, `peaks-ui`, `peaks-txt`, `peaks-sc`, `peaks-general-purpose`, single + DAG) receives a hard "Test Tool Detection (mandatory)" block at the top of its prompt: read `package.json#scripts.test`, use project-local runner (`./node_modules/.bin/<runner>` or `pnpm test --`), NEVER `npx <runner>`. Wired at both `dispatch-commands.ts` and `dag-orchestrator.ts` chokepoints; envelope version bumped to `2.2.0`.

### Bugfixes — handoff path canonicalization (v1 + v2 + v3 + v4 + v5 + v6 + v7)

LLM was creating top-level `.peaks/_runtime/<change-id>/` siblings of `.peaks/_runtime/`, violating the 2.8.3 hard ban. Sweep across all surfaces:

- **v1 (`9893d3a`)**: 20 hardcoded `.peaks/_runtime/${changeId}/` template strings in the 5 render functions of `src/services/artifacts/artifact-templates.ts` (split from `request-artifact-service.ts`). 4-helper API: `formatHandoffPath`, `formatCommitBoundaryPath`, `formatSkillUsageLessonsPath`, `formatChangeScopePath`.
- **v2-v5 (`9afb702`, `41ad7a5`, `70bb568`, `83f23b2`, `975d9fc`)**: 11 B-class LLM/CLI directive strings in `src/cli/commands/` + `src/services/{refactor,sc,slice}/`, 71 B-class strings in `skills/`, 5 `.peaks/` project metadata files, 8 remaining SKILL.md literals. Plus R3 hotfix on `request-artifact-service.ts:515` runtime error message.
- **File split**: `core-artifact-commands.ts` 889 → 39 lines + 8 new `core/*-command.ts` modules (each ≤ 800 lines), preserving public API.
- **Regression test**: `tests/unit/workspace/banned-path-directive-guard.test.ts` — 7 directive-context patterns, 3-entry KEEP allow-list, covers `src/` + `skills/`.
- **v7 (`b4d666b`)**: `migrateWorkspace` updated to discover sessions under canonical `.peaks/_runtime/<sid>/` (was only walking the legacy top-level path).

### Tests

- 3873 passed / 0 failed / 17 skipped at release time.
- New: `dispatch-fanout-mandatory.test.ts` (11), `karpathy-skip-on-config-docs-chore.test.ts` (11), `checkpoint-periodic-frequency.test.ts` (6), `test-tool-detection.test.ts` (6) + injection test + docs test, `banned-path-directive-guard.test.ts` (2), `reviewer-dispatch-policy.test.ts` (11).
- New reviewable artifact helpers tested in `request-artifact-handoff-path.test.ts` (21 total now).

### Pre-existing violations preserved as-is

6 ban-explanation memory files under `.peaks/memory/`, 28 historic session files under `.peaks/_runtime/2026-06-*/`, 5 historic dispatch records under `.peaks/_sub_agents/`, `.peaks/.gitignore` (gitignore contract), `tests/fixtures/skills/pre-slim/*.md` (slim-evidence baseline) — all explicitly labeled historical.

---

## [2.9.2] — 2026-06-25 — Handoff path canonicalization v2 (INTERMEDIATE, SUPERSEDED BY 2.9.0)

**Bugfix.** v1 (2.9.1, commit 9893d3a) fixed 20 hardcoded `.peaks/_runtime/${changeId}/` template strings in the 5 render functions of `src/services/artifacts/artifact-templates.ts`. User review then surfaced 11 additional B-class (LLM/CLI directive) hits across `src/cli/commands/`, `src/services/{refactor,sc,slice}/`, and 71 hits in `skills/` SKILL.md/references that the LLM would read as write instructions. v2 cleans all of them.

- **11 B-class string edits** in 8 source files (CLI descriptions, `nextActions.push`, service-emit `warnings:` / `helpLines:` / `hardGates`, `slice-check` gate descriptions)
- **1 R3 hotfix**: `src/services/artifacts/request-artifact-service.ts:515` runtime error message path
- **1 C-class back-compat comment** on `src/services/audit/enforcers/design-draft-confirm.ts:38-41` design-draft read path
- **71 B-class edits** across 15 skills/ files (SKILL.md + references/)
- **5 .peaks/ project metadata files** updated (PROJECT.md, retrospective index, project-scan, 2 memory entries)
- **File split**: `src/cli/commands/core-artifact-commands.ts` 889 → 39 lines (orchestrator) + 8 new `src/cli/commands/core/*.ts` modules (each ≤ 800 lines), preserving the public API (`registerCoreAndArtifactCommands`, `DoctorLogsSection`, `BindingSource`)
- **4 new tests** in `request-artifact-handoff-path.test.ts` (21 total now)
- **1 new regression test**: `tests/unit/workspace/banned-path-directive-guard.test.ts` (2 tests, 7 directive-context patterns, 3-entry KEEP allow-list for explicit legacy/canonical contrast descriptions; covers `src/` and `skills/` directive contexts)
- **1 test sync**: `tests/unit/sc-service.test.ts:151` updated to match the production warning string at `src/services/sc/sc-service.ts:567`
- Bumps `package.json#version` from 2.9.1 to 2.9.2

**Pre-existing violations preserved as-is** (intentional historical/forbidden documentation, all explicitly labeled):
- 6 ban-explanation memory files under `.peaks/memory/` (slice 005 / 2.8.3 / 2.7.1 lessons)
- 28 historic session files under `.peaks/_runtime/2026-06-*/`
- 5 historic dispatch records under `.peaks/_sub_agents/`
- `.peaks/.gitignore` (gitignore contract)
- `tests/fixtures/skills/pre-slim/*.md` (slim-evidence baseline)

---

## [2.9.1] — 2026-06-24 — Handoff path canonicalization

**Bugfix.** Sub-agents were still creating `.peaks/_runtime/<change-id>/` at the top level of `.peaks/`, which is hard-banned by 2.8.3+. Root cause: 20 hardcoded `.peaks/_runtime/${changeId}/...` template strings in `src/services/artifacts/request-artifact-service.ts` were emitted into artifact markdown and read by sub-agents as handoff write instructions.

Replaced all 20 with a 4-helper API at `src/services/artifacts/artifact-templates.ts:31,36,41,46` (`formatHandoffPath`, `formatCommitBoundaryPath`, `formatSkillUsageLessonsPath`, `formatChangeScopePath`); the public surface is re-exported from `request-artifact-service.ts:28`. The service file was also split — 5 render functions + dispatcher moved to the new sibling module — bringing it from 1101 lines down to 788, satisfying the 800-line cap (Karpathy #2 Simplicity First).

- New module: `src/services/artifacts/artifact-templates.ts` (333 lines; 4 helpers + 5 render fns + dispatcher)
- `src/services/artifacts/request-artifact-service.ts` — re-exports only, 1101 → 788 lines
- New test: `tests/unit/artifacts/request-artifact-handoff-path.test.ts` (17 assertions: 4 helper shapes, 5× role-path-prefix, 1 source-grep, 1 line-count cap, 1 lazy-load guard)
- Hard ban (2.8.3+) regression-tested: zero hardcoded `.peaks/_runtime/${changeId}/` strings in either file
- Also bumps `package.json#version` from 2.8.4 to 2.9.1 (closing the slice 006 gap where CHANGELOG was bumped to 2.9.0 but package.json was not)

---

## [2.9.0] — 2026-06-24 — Test Tool Detection injection

**Added.** Sub-agent dispatch (both single + DAG paths, all roles rd/qa/ui/txt/sc/general-purpose) now prepends a `## Test Tool Detection (mandatory)` block to every sub-agent prompt. The block tells the sub-agent to read `package.json#scripts.test` first and use the project-local runner (`./node_modules/.bin/<runner>` or `pnpm test -- <file>`) — never `npx <runner>`. Runtime introspection: `peaks test --json`.

- New module: `src/services/dispatch/test-tool-detection.ts` (47 lines; exports `TEST_TOOL_DETECTION_BLOCK` + `formatTestToolDetection()`)
- Dispatch chokepoints updated: `src/cli/commands/dispatch-commands.ts:187`, `src/services/solo/dag-orchestrator.ts:157,182-183`
- Dispatch envelope bumped: `envelopeVersion: '2.1.0'` → `'2.2.0'` (consumers can detect the new prompt shape)
- New tests: `tests/unit/dispatch/test-tool-detection.test.ts` (6), `tests/unit/dispatch/test-tool-detection-injection.test.ts` (9), `tests/unit/skills/test-tool-detection-docs.test.ts` (4) — 19 new assertions
- Block size: 749 bytes UTF-8 (≤800 cap)

---

## [2.8.4] — 2026-06-24

**Breaking change.** Single-sub-agent dispatch is no longer permitted when the slice DAG has ≥ 2 leaves at one topological level. The 2.8.3-era `preferences.fanout.defaultMode = 'serial'` opt-out was removed by user directive ("禁止单 sub-agent").

### Changed

- **`FanoutMode` closed set narrowed to `['fan-out']`.** The `'serial'` member is gone from `src/services/preferences/preferences-types.ts`; any preferences.json file carrying `defaultMode = 'serial'` (or any non-fan-out value) now throws `PREFERENCES_FANOUT_INVALID` at load. The `migratePreferences` path silently rewrites legacy `'serial'` → `'fan-out'` for 2.8.3-era files and surfaces the change in the migration envelope's `changes[]`.
- **SKILL.md contract flipped.** `peaks-solo` SKILL.md now states "Hard constraint: fan-out is mandatory"; the previous "Fan-out opt-out" subsection is removed.
- **Reference docs reorganized.** `references/fanout-opt-out.md` (escape hatch) → `references/fanout-mandatory.md` (hard constraint + migration contract). `references/swarm-dispatch-contract.md` opt-out callout removed.
- **Test surface refreshed.** `tests/unit/solo/skills-solo-fanout-opt-out.test.ts` → `tests/unit/solo/skills-solo-fanout-mandatory.test.ts`; pins the new hard constraint and verifies the opt-out file is deleted.

### Migration

Run `peaks preferences migrate --write` once. The CLI will rewrite `serial` → `fan-out` in your `.peaks/preferences.json` and surface the change in stdout. Manual recovery: delete the `fanout` block from `.peaks/preferences.json`.

### Slice

`2026-06-24-audit-5th-p2` — removes the 2.8.3 serial opt-out entirely. Compatible with the 2.8.4 release tag; no DB migration required.

---

## [2.8.3] — 2026-06-22

### ⚠ BREAKING — `peaks workspace init --change-id` no longer creates `.peaks/_runtime/<change-id>/` sibling dir

The 2.8.0-era `peaks workspace init --change-id <id>` flow wrote a
top-level sibling dir `.peaks/_runtime/<changeId>/` next to `.peaks/_runtime/`.
That path is **forbidden** under the 2.8.0+ two-axis convention
(change-id is a logical identifier, NOT a sibling filesystem dir).

In 2.8.3 the CLI redirects `--change-id` to a **file-form binding** at
`.peaks/_runtime/current-change` (plain text file containing the
change-id as its sole content). NO directory is created at
`.peaks/_runtime/<changeId>/` at top level. Reviewable artifacts still land
under `.peaks/_runtime/<changeId>/<role>/`, but that dir is created **lazily**
by the writer, not by `init`.

If a 2.8.0-era legacy sibling dir `.peaks/_runtime/<changeId>/` already exists
at top level, `peaks workspace init --change-id <id>` aborts with a
new `LegacyChangeIdSiblingError` (envelope code
`LEGACY_CHANGE_ID_SIBLING`) carrying a 4-step migration message:

1. Inspect `.peaks/_runtime/<changeId>/` for user-authored content worth keeping.
2. Move desired files into `.peaks/_runtime/<sessionId>/<role>/`.
3. Delete the orphan `.peaks/_runtime/<changeId>/` dir.
4. Re-run `peaks workspace init --change-id <id>`.

This is a **deliberate breaking change** — the 2.8.0→2.8.3 transition
required the redirect because the legacy sibling-dir layout was the
root cause of `.peaks/_runtime/<YYYY-MM-DD-*>/` orphans at the project root.
Users on 2.8.2 with an existing `.peaks/_runtime/<changeId>/` sibling dir see a
one-time migration error on next `peaks workspace init`. The CLI surfaces
the four-step recipe; no data is lost.

### Fixed

- **Top-level `.peaks/_runtime/<YYYY-MM-DD-*>/` ban** — the 2.8.0-era legacy path
  `.peaks/_runtime/<change-id>/<role>/` (sibling of `.peaks/_runtime/`) is now
  **forbidden** under the 2.8.0+ two-axis convention. This slice is the
  final root-out of a 2.8.0-era orphan (`.peaks/2026-06-22-cc-connect-orphan-cleanup/`,
  4 files, 28 KB, untracked) and pins the rule across FOUR layers so a
  regression cannot survive:
    1. **`.gitignore` fnmatch rule** —
       `.peaks/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-*/` blocks any
       future untracked date-prefix sibling at `.peaks/_runtime/<seg>/`. Path-anchored
       so it does not over-match (`.peaks/_runtime/<date>/` is still ignored
       by the existing `.peaks/_runtime/` rule, not this one).
    2. **Vitest guard** at
       `tests/unit/workspace/top-level-change-id-guard.test.ts` (8 cases)
       pins the gitignore rule literal, asserts fnmatch matches a synthetic
       candidate, asserts it does NOT match `.peaks/_runtime/-nested`
       candidates, scans the live working tree for orphan date-prefix
       siblings, scans `git ls-files` for tracked escapes, asserts both
       `CLAUDE.md` and `.peaks/PROJECT.md` carry the ban wording, AND
       asserts the CLI help text (`init-command.ts`) teaches the
       `.peaks/_runtime/current-change` binding path + the four
       migration verbs (inspect / move / delete / unlink / re-run).
    3. **Source-code redirect** —
       `src/shared/change-id.ts#setCurrentChangeId` now defaults to
       `{ form: 'file' }` (was `'symlink'`); the file form writes ONLY
       `.peaks/_runtime/current-change` and never creates
       `.peaks/_runtime/<changeId>/`. The legacy `'symlink'` form is kept for
       back-compat reads but is no longer written by `peaks workspace init`.
       `src/services/workspace/workspace-service.ts#initWorkspace`
       pre-flights the existence of `.peaks/_runtime/<changeId>/` and throws
       `LegacyChangeIdSiblingError` if found.
    4. **CLI help-text guard** — `src/cli/commands/workspace/init-command.ts`
       rewrites the `init` command description and `--change-id` option
       description so an LLM reading `peaks workspace init --help` is
       taught the correct path (`.peaks/_runtime/current-change`) instead
       of the legacy `.peaks/_runtime/<change-id>/` sibling dir. A new catch block
       surfaces `LegacyChangeIdSiblingError` with the 4-step migration
       recipe in the JSON envelope.
- **`CLI_VERSION`** sync bumped 2.8.2 → 2.8.3 (regenerated via
  `scripts/sync-version.mjs` from `package.json#version`).

### Added

- **`LegacyChangeIdSiblingError`** (exported from
  `src/services/workspace/workspace-service.ts`) — thrown by
  `initWorkspace` when a 2.8.0-era legacy sibling dir
  `.peaks/_runtime/<changeId>/` already exists at top level. Carries
  `code: 'LEGACY_CHANGE_ID_SIBLING'`, `changeId`, and `legacyPath`.
  The CLI catch block surfaces the error in the JSON envelope with a
  3-item `nextActions` list (inspect → migrate → re-run).
- **`tests/unit/workspace/workspace-init-change-id-redirect.test.ts`** —
  8 vitest cases pinning the new init behavior:
  (1) no `.peaks/_runtime/<changeId>/` created; (2) `.peaks/_runtime/current-change`
  written; (3) `LegacyChangeIdSiblingError` fires when legacy sibling
  exists; (4) no `--change-id` leaves binding untouched; (5) idempotent
  re-init; (6) error envelope data fields + 4-step recipe ordering;
  (7) `LegacyChangeIdBindingError` fires when a legacy 2.8.0-era
  symlink is found at the binding path (silent-replace defense);
  (8/8b) `ChangeIdValidationError` fires for `--change-id '../'` / '.'
  before any path join.
- **`top-level-change-id-guard.test.ts` AC7** — pins the CLI help text
  in `init-command.ts` so a future refactor cannot silently revert to
  the forbidden sibling-dir phrasing. Also pins all four migration
  verbs (inspect / move / delete / unlink / re-run) so the CLI catch
  block's wording stays in sync with the runtime error messages.

### Audit followup (post-2.8.3, pre-publish) — multi-dimensional remediation

A multi-dimensional audit (Karpathy + security + silent-failure +
migration) of the 2.8.3 release surfaced 13 findings, all addressed in
a single followup commit:

- **HIGH silent failure**: `setCurrentChangeId({ form: 'file' })`
  silently replaced a 2.8.0-era symlink at the binding path
  (`unlinkSync` + `writeFileSync` with no log / envelope signal).
  Fixed: detect the symlink via `lstatSync` BEFORE the read attempt
  and throw a new `LegacyChangeIdBindingError` (envelope code
  `LEGACY_CHANGE_ID_BINDING`) with a 3-step migration recipe
  (inspect / unlink / re-run). The CLI catch block surfaces the
  error in the JSON envelope with `bindingPath` + `symlinkTarget` +
  `changeId` fields plus a 3-item `nextActions` list. Live state at
  the time of audit: this repo's own `.peaks/_runtime/current-change`
  was a legacy symlink pointing at the now-deleted
  `.peaks/014-full-dogfood/` — the fix prevented data loss on the
  next `peaks workspace init --change-id` invocation.
- **MEDIUM path-validation ordering**: `initWorkspace` joined the
  unvalidated `--change-id` and ran `existsSync` before
  `validateChangeIdOrThrow`. Fixed: `validateChangeIdOrThrow` is now
  called BEFORE any path join / `existsSync` probe.
- **MEDIUM bare-existsSync guard**: the legacy-sibling guard used
  bare `existsSync` which conflates files / broken symlinks /
  escaping symlinks / EACCES into one error. Fixed: use
  `lstatSync` + try/catch on `ENOENT` so the guard distinguishes
  path types. (All non-existent paths fall through; the legacy
  sibling dir of any kind still throws `LegacyChangeIdSiblingError`.)
- **INFO defense-in-depth**: `writeFileSync` on the binding file now
  uses `mode: 0o600` (the binding file contains a per-user change-id,
  not a team-shared file — restricting read/write to the owner defends
  against multi-user hosts).
- **Test count**: `workspace-init-change-id-redirect.test.ts` extended
  from 6 to 8 cases (AC7 symlink-at-binding-path + AC8 / AC8b
  validation); `top-level-change-id-guard.test.ts` AC7 extended with
  4-verb pin. Total test count: 8 + 8 = 16 cases pinning the
  top-level change-id ban (previously stated as "5 cases" in the
  memory file and "(7 cases)" in the "Vitest guard" bullet above —
  both have been corrected to reflect the final 8-case state).
- **Dead-code cleanup**: removed the unused `track` helper from
  `workspace-init-change-id-redirect.test.ts`.
- **Doc cleanup**:
  `.peaks/memory/2026-06-22-top-level-change-id-cleanup.md` updated
  to describe the full 4-layer defense (was 3-layer) and the 8-case
  final state (was 5-case). `.peaks/memory/index.json` entry
  description + `updatedAt` timestamp updated to 2026-06-23.
  `CLAUDE.md` Hard ban section clarifies the binding vs artifact
  path distinction. `.peaks/PROJECT.md` second convention bullet
  expanded to describe all 4 enforcement layers. The
  `.peaks/_sub_agents/unknown-sid/` followup is marked
  **tolerated** (gitignored ephemeral, no action needed).
- **CLI help text** mentions `LegacyChangeIdBindingError` alongside
  `LegacyChangeIdSiblingError` so an LLM reading
  `peaks workspace init --help` learns about both error classes.

Verification: `pnpm tsc --noEmit` clean, `pnpm vitest run` 3638/3640
pass (the 2 pre-existing ast-gate-cross-version STRAT.sig failures
are unchanged by this release), `pnpm build` clean.

### Notes

- No npm dependencies added or removed.
- CLI surface change: the `init` command description and `--change-id`
  option description text are rewritten to teach the correct path.
  `peaks workspace init --help` is now a slightly longer message — no
  flag names changed, no exit codes changed.
- The orphan `.peaks/2026-06-22-cc-connect-orphan-cleanup/` contained a
  redundant duplicate of work already promoted to
  `.peaks/_runtime/2026-06-22-session-14216e/rd/requests/002-2026-06-22-cc-connect-orphan-cleanup.md`
  per the 2.8.0+ two-axis convention. Audit confirmed no other orphan
  date-prefix `.peaks/` siblings exist anywhere in the working tree or git
  tracking, and zero `src/` / `skills/` / `tests/` paths reference the
  deleted orphan as a live location.
- The pre-existing `STRAT.sig` test failure in
  `tests/integration/rd/ast-gate-cross-version.test.ts` is out of scope
  and filed separately (unchanged by this release).
- Consumer-projects upgrading from 2.8.0/2.8.1/2.8.2: if you have an
  existing `.peaks/_runtime/<change-id>/` dir at top level from a prior
  `peaks workspace init --change-id <id>` call, run the migration
  steps surfaced by `LegacyChangeIdSiblingError` (inspect → migrate →
  delete → re-init). No data is lost. After migration, future
  `peaks workspace init` calls write only `.peaks/_runtime/current-change`
  and never create the sibling dir.

---

## [2.8.2] — 2026-06-22

### Removed

- **cc-connect package + `peaks companion` command family** — the
  `cc-connect` dependency (and its postinstall Go-binary download) is
  gone from `package.json#dependencies`, and the entire 12-file
  `src/services/companion/*` module + `src/cli/commands/companion.ts`
  CLI + 14 `tests/unit/companion/*` test files are removed
  (~7,700 lines deleted, 0 added). The `peaks companion install|setup|
  start|stop|bind|status|restart|verify|token|qr` command tree is gone
  along with the `peaks scan companion-binary` sub-command and the
  `capability:companion-binary-resolution` doctor check. Companion
  types (`CompanionConfig`, `CompanionWeixinConfig`, `CompanionChannel`,
  `CompanionBinarySource`) and the `~/.peaks/config.json#companion`
  block are also removed.
- **Orphan npm dependencies** — `qrcode ^1.5.4`, `qrcode-terminal ^0.12.0` (runtime), `@types/qrcode ^1.5.6` (dev). These were only consumed by the now-deleted `src/services/companion/*` module; the ambient declaration `src/types/qrcode-terminal.d.ts` (no consumer) was deleted in the same hunk. `pnpm-lock.yaml` regenerated; verified 0 `cc-connect` and 0 `qrcode` entries.
- **Stale `'companion'` entry in `PARENT_COMMANDS`** static set in `src/services/scan/orphan-service.ts`. The `peaks companion` command was deleted in 2.8.2; its presence in the static set caused orphan-detection false negatives (a stray `companion` directory would be silently skipped).

  Rationale: `cc-connect@1.3.1`'s postinstall script runs
  `node scripts/install.js` which downloads a Go binary from
  `github.com/alibaba/open-code-review/releases` via HTTPS. This was
  the dominant cause of slow `npm i -g peaks-cli` installs in
  restricted/proxied environments; `peaks companion` itself is also
  low-traffic (no Claude Code / Trae workflows depend on it). The
  `peaks-companion` skill directory remains in `skills/` for users
  who still have cc-connect installed locally — it is now opt-in and
  no longer wired into any `peaks` subcommand.

  Action for users with existing `~/.peaks/config.json`: the loader
  silently strips the legacy `companion` block on next read and
  rewrites the file in slim form. No data loss.

### Changed

- **`@alibaba-group/open-code-review` is now a peer dependency** —
  moved from `optionalDependencies` to `peerDependencies` with
  `peerDependenciesMeta."@alibaba-group/open-code-review".optional =
  true`. The peer hint lets npm skip the optional resolution entirely
  during global install; users who want second-opinion reviews via
  `peaks code-review run-ocr` install it manually with
  `npm i -g @alibaba-group/open-code-review`. Install hint copy in
  `ocr-service.ts` and `code-review-commands.ts` updated to reflect
  the peer-dependency status. `pnpm.onlyBuiltDependencies` is now an
  empty array (no peaks-cli dep needs postinstall approval).
- **Refreshed stale JSDoc** on `src/services/config/config-service.ts#hasLegacyGlobalFields` to describe the current 2.0 schema (`version` + `ocr`) — the old comment still described the deleted `companion` block from slice 2026-06-14-cc-connect-weixin.
- **Removed dead `commander.invalidArgument` channel-not-supported block** in `src/cli/index.ts` — the only path that raised this exact error was the now-deleted `peaks companion` command.

### Notes

- `skills/peaks-companion/` and `tests/unit/skills/peaks-companion.test.ts` are intentionally retained as a tombstone for users who still have `cc-connect` installed locally. They are not loaded by the runtime CLI.
- The pre-existing `STRAT.sig-chain` test failure in `tests/integration/rd/ast-gate-cross-version.test.ts` is out of scope and filed separately.

---

## [2.8.1] — 2026-06-22

### Fixed

- **H8 STRAT.sig chain enforcement (Plan 5 R1-W2 HIGH)** — `runTacticalStage`
  now refuses to write `impl.json` when `inputSig` does not equal the
  upstream `STRAT.sig` for the same project dir, instead of trusting any
  64-hex string. Backed by a process-local `STRAT_SIG_REGISTRY` keyed by
  `dirname(out)` and the explicit invariant phrase
  `"STRAT.sig chain broken"`. Catches a class of orchestrator bugs that
  could fabricate impl.json authority from a non-existent strategy.

- **Defense-in-depth comment cites H6 verbatim (Plan 5 R1-W3 MED)** —
  `src/services/rd/impl.ts` defense-in-depth check now cites spec H6
  (CLI 计算裁决) directly. The accompanying `docs/superpowers/specs/
  2026-06-21-context-audit-redesign-design.md` gained a new §4.3
  *战术审计* subsection that consolidates §3.2 / §3.3 / H6 / H8 / Phase 3
  AC-2 into a single canonical anchor (previous code references to
  `§4.2` updated to `§4.3`).

### Tests

- **Orphan-test traceability (Plan 5 R1-W1 MED)** — the side-effect-only
  import test in `tests/unit/services/rd/ast-gate.test.ts` now carries an
  explicit `R2-EXTRA` comment tag so future audit rounds can locate it
  in the round-2 boundary_coverage table.

- **v1 regex-limitation test names (Plan 5 R1-W4 LOW)** — namespace-import
  and default-import tests renamed from "is NOT linked to dep" to
  "v1 passes namespace/default import (limitation, R2-W3)" so the verdict
  is in the test name, not just the body.

- **Atomic-write crash test (Plan 5 R1-W5 LOW)** — new test
  *unlinks .tmp when rename throws* pins the catch→unlink fallback in
  `writeImpl` (EISDIR-triggered real-rename failure). Mutation probe
  KILLED: commenting out the unlink makes the test fail at the
  `existsSync(tmp)` assertion.

- **1-element boundary (Plan 5 R2A-L1 LOW)** — `externalApiCalls` array
  now asserts that `[]` / `[x]` / `[x,y,z]` produce three distinct sigs,
  pinning the empty-vs-single-vs-multi collapse class.

- **Uppercase-hex schema pin (Plan 5 R2A-L2 LOW)** — `StrategyOutputSchema`
  now rejects `'A'.repeat(64)` explicitly, defending against a
  case-insensitive regex widening mutation.

- **Multi-entry sig-distinction caveat (Plan 5 R3-W1 LOW)** — the
  `produces distinct sig for multi-entry externalApiCalls` test now
  documents in its comment that the named sig assertion is best-effort
  (because `generatedAt` is non-deterministic) and that the load-bearing
  guards are the on-disk length + element-order assertions.

---

## [2.7.0] — 2026-06-18

### Added

- **Slice DAG dependency analysis + parallel sub-agent dispatch (slice 1.2)** —
  the `peaks-cli` repo now ships a typed DAG model for slicing work across
  parallel sub-agents. `src/services/dispatch/slice-dag.ts` exports
  `validateDag` (cycle detection with path-in-error-message),
  `topologicalLevels` (linear / diamond / parallel DAGs), and
  `sliceReadyToRun(dag, completed)` (next-layer fan-out query). Node IDs are
  globally unique, node roles are whitelisted, and DAG serialization is
  SHA-256 hash-stable on key-sorted serialization. The new
  `peaks sub-agent dispatch --from-dag <file>` flag and the new
  `peaks sub-agent await --batch <id> [--timeout <ms>]` subcommand wrap the
  model. The `dispatch <role>` single-sub-agent path is byte-stable zero-change.
- **Contract broadcast for downstream slices (slice 1.2)** —
  `src/services/dispatch/contract-store.ts` persists each completed slice's
  public surface (`exports` / `types` / `publicSignatures`) to
  `.peaks/_runtime/<sessionId>/dispatch/contracts/<slice-id>.json`. The B/C/D
  dispatch prompts auto-inject A's contract under a `slice A contract:`
  segment so downstream slices see the dependency without re-reading source.
- **Solo DAG orchestrator with cancel-on-fail (slice 1.2)** —
  `src/services/solo/dag-orchestrator.ts` exports `runDag(dag, opts)`:
  topological-layer fan-out, per-layer join barrier, 任一叶子失败整组回退
  (any leaf failure → in-flight sub-agents receive cancel signal → RD
  returns to repair). peaks-solo SKILL.md references the orchestrator.
- **5-IDE `awaitBatch` real implementation (slices 1.2 + 1.3 + 1.4)** —
  `SubAgentDispatcher.awaitBatch(batchId, opts): Promise<BatchResult[]>`
  is now implemented across **all 5 IDEs**: claude-code (1.2 MVP) +
  trae + trae-cn + codex + cursor (1.3 expansion). The 4 non-claude-code
  IDEs share `pollDispatchRecords()` core (cross-platform file-polling via
  `homedir() + join()`); per-IDE `notePrefix` attributes the surfaced note.
  Per-IDE timeout defaults: trae 30s / trae-cn 30s / cursor 30s /
  codex 45s / claude-code 60s. Uniform 120_000ms clamp ceiling.
- **5-IDE end-to-end dogfood (slice 1.4)** —
  `tests/unit/dispatch/slice-dag-dispatcher-5ide-dogfood.test.ts` runs the
  same 5-node mock DAG (4 done + 1 failed at idx 2) through every IDE's
  `awaitBatch`. Cross-IDE envelope dimensions are byte-stable
  (length=5 / dispatchIndex 0..4 / status array / recordPath unique /
  durationMs >= 0). The `note` label is per-IDE attributed as documented
  divergence (claude-code reads raw outcome; trae/trae-cn/codex/cursor
  prefix with `${notePrefix} — ${outcome}`). Zero IDE-specific differences
  required production code fixes — the differences are design-driven.
- **RD tech-doc `## Slice DAG` section + enforcer (slice 1.2)** —
  `skills/peaks-rd/references/mandatory-tech-doc.md` gains a new
  `## Slice DAG` section (visual + text) alongside § Architecture /
  § Component / § Data flow / § Dependencies. The enforcer
  (`tech-doc-mandatory-sections.ts`) treats it as a required heading;
  missing section → `TECH_DOC_MISSING_SECTION` gate failure.
- **UT 4-dimension split convention (proposal 2, slice 2.1)** —
  `.peaks/standards/typescript/testing.md` codifies the 4 orthogonal test
  dimensions: **render** (output shape) / **behavior** (state transitions)
  / **integration** (boundary mocks) / **a11y** (human-facing signal).
  Each `describe(...)` block maps to exactly one dimension; no test case
  spans dimensions. The convention has both a frontend and a CLI/non-UI
  reading. Promotion is via the code-reviewer sub-agent hint at
  `skills/peaks-rd/references/code-reviewer-4dim-hint.md` (a verbatim
  block appended to the code-reviewer prompt at dispatch time). **No lint
  rule introduced**, no retroactive refactor of existing 3500+ test cases —
  the convention applies to NEW test files only.

### Changed

- `package.json` and `src/shared/version.ts` bumped 2.6.1 → 2.7.0.
- `SubAgentDispatcher` interface (5 implementations) gains
  `awaitBatch(batchId, opts): Promise<BatchResult[]>` (type-only extension).
- `peaks sub-agent dispatch` and `peaks sub-agent await` gain DAG-aware
  flags (`--from-dag`, `--batch-id`) and the new subcommand respectively.
  Single-sub-agent `dispatch <role>` envelope shape is byte-stable zero-change.
- `karpathy-reviewer` prompt-injection context remains in
  `references/rd-sub-agent-dispatch.md`; the new 4-dim hint is appended
  after the Karpathy block.

### Fixed

- **Cross-platform path discipline (slice 1.3)** —
  `tests/unit/dispatch/sub-agent-dispatcher-cross-platform.test.ts` pins
  the `homedir() + join()` construction so a Windows user gets
  `C:\Users\name\.trae\agents` and a Mac user gets
  `/Users/name/.trae/agents`. No hardcoded `/Users/...` or `C:\...` in
  any 5-IDE `awaitBatch` path. The 4 new IDE paths (`trae / trae-cn /
  codex / cursor`) follow the same discipline.
- **`runDag` cancel-on-fail correctness (slice 1.2.c)** — when any leaf
  fails, in-flight sub-agents in the same batch receive a cancel signal
  at the envelope level; the orchestrator no longer waits for them to
  finish naturally. Pinned by `tests/unit/solo/dag-orchestrator.test.ts`.

### Security

- No new attack surface in 2.7.0. The contract-broadcast path writes
  JSON to `.peaks/_runtime/<sessionId>/dispatch/contracts/` (project-local,
  gitignored); no cross-user / cross-process access pattern was added.
  The 4-dim convention does not introduce eval / dynamic-import / unsafe
  code paths.

---

## [2.7.1] — 2026-06-18

### Changed

- **Project-root artifact pollution remediation** — the 2.7.0 release
  shipped a `getChangeArtifactRoot(projectRoot, changeId)` helper that
  returned `.peaks/_runtime/<changeId>/` and was the source of the user-reported
  project-root pollution: reviewable artifacts (RD `tech-doc.md`, QA
  `test-cases/`, PRD, txt) were being written next to the project root
  rather than under the canonical session home. As of 2.7.1 this
  helper is **removed** (and its only remaining import cleaned up).
  All artifact writes flow through
  `.peaks/_runtime/<sessionId>/<role>/<artifact>` per the F3 / 2.7.0
  canonical-session model. The `changeId` survives as a logical
  identifier in artifact frontmatter (read via `getCurrentChangeId`),
  but no longer maps to a filesystem directory under `.peaks/`.
- `package.json` and `src/shared/version.ts` bumped 2.7.0 → 2.7.1.

### Fixed

- **`peaks request transition --allow-incomplete` bypass counter wrote
  to the project root** — `src/cli/commands/request-commands.ts` was
  building `sessionRoot` as `join('.peaks', resolvedSessionId)` for
  `recordBypass` / `isBypassLimitReached`, which produced
  `.peaks/2026-06-17-session-1baf0a/.bypass-count.json` files at
  the project root. The path formula is now
  `join('.peaks/_runtime', resolvedSessionId)`, matching the
  canonical home that `peaks session info --active` already resolves.
  Pinned by `tests/unit/bypass-tracker.test.ts` (new
  `2.7.1 root-pollution regression` describe).

### Security

- No new attack surface. The bypass-count path is now
  `.peaks/_runtime/<sessionId>/.bypass-count.json` (project-local,
  gitignored via the existing `.peaks/_runtime/` rule on
  `.gitignore:9`); no cross-user / cross-process access pattern was
  added or removed.

---

## [2.6.1] — 2026-06-18

### Added

- **Multi-IDE agent install (Slice 2.6.1.E)** — the `karpathy-reviewer`
  sub-agent now auto-installs on `npm i -g peaks-cli@latest` to **5
  platforms** instead of 1. Previously only `~/.claude/agents/`
  (claude-code) was populated; 2.6.1 extends to `~/.trae/agents/`,
  `~/.trae-cn/agents/`, `~/.codex/agents/`, and `~/.cursor/agents/`.
  The new `trae-cn` profile is opt-in via the existing
  `IDE_DETECTION_DIRS` table (presence of `~/.trae-cn/` triggers
  detection). All `agentsDir` paths go through `homedir() + join()` —
  the new `agentsDir paths are derived from homedir()` vitest pins
  the construction so a Windows user gets `C:\Users\name\.trae\agents`
  and a Mac user gets `/Users/name/.trae/agents`, not a hardcoded
  Unix literal.

### Fixed

- **orphan-service false-positive reductions (Slice 2.6.1.A)** —
  `peaks scan orphan` had been reporting 77 `cliSubcommandOrphans` for
  the peaks-cli repo. Four surgical fixes bring this down to 35
  (54% reduction):
  1. The `usageCount` algorithm now excludes the declaration file
     itself, so the threshold is "wired iff referenced in any other
     file" rather than "wired iff 2+ total string-literal matches
     (declaration + elsewhere)".
  2. `DEFAULT_DIRS` now includes `tests/` — test files often reference
     subcommands and were previously invisible to the scanner.
  3. `PARENT_COMMANDS` (35 known top-level command names) skips
     subcommand-orphan detection for the parent commands themselves.
  4. `scanExportsInFile` now matches `export default function name()`
     and `export default class Name`; `importedNameCount` now treats
     re-exports (`export { x } from './y'`, `export type { T } from
     './y'`) as consumer references.
  Bonus: `OrphanScanOptions.baseRef` lets the scan diff against an
  arbitrary git ref (default: `HEAD`) for branch-vs-main reviews.
- **karpathy-service code-fence skip (Slice 2.6.1.B)** — `peaks scan
  karpathy` no longer flags anti-pattern phrases (TODO, "should be
  fine", "maybe", "probably") when they appear inside fenced markdown
  code blocks. Illustrative code snippets were eroding trust in the
  structural scanner. The 4 guideline-marker tests
  (`tests/unit/karpathy-service-fence.test.ts`) pin the contract:
  inside-fence lines are skipped, outside-fence prose is still
  flagged, unclosed fences at EOF don't crash.

### Security

- **markdown escape in `formatKarpathyMarkdown` (Slice 2.6.1.C)** —
  the L1 LOW (`--project` value interpolated into markdown without
  escaping) is fixed via a new `escapeMarkdown(value: string)` helper
  that neutralises `\\`, `` ` ``, `[`, `]` in user-controlled strings
  before they hit the markdown report. Applied at 7 interpolation
  sites: `projectRoot`, `reviewFile`, `scannedAt`, `v.snippet`,
  `v.hint`, `warnings[].message`, and the gate header (which is
  static but routed through the helper for consistency). New vitest
  file `tests/unit/karpathy-service-escape.test.ts` (7 cases)
  covers the contract; AC-6 no-regression pins clean-ASCII output as
  byte-identical.
- **KARPATHY_REVIEW heading-anchored gate (Slice 2.6.1.F)** — the L3
  LOW (the 4 guideline `mustContain` substring markers could be
  spoofed by any file that just *mentioned* the marker names as
  prose) is fixed by a new `headingMustContain: string[]` field on
  `ArtifactPrerequisite`. `KARPATHY_REVIEW` now requires each of
  the 4 guidelines to appear as an actual markdown heading
  (`#`–`###` line prefix), not just as prose. The `## Karpathy-Gate`
  header remains a substring match (it is the file's own gate
  header, not a section anchor). New vitest file
  `tests/unit/heading-must-contain.test.ts` (4 cases) covers:
  AC-1 valid headings pass, AC-2 prose-only fails, AC-3 partial
  headings fail with the missing marker named, AC-4 code-fence
  headings (regex is strict, not fence-aware) — documented as a
  known limitation pinned by the test.

### Internal

- **L2-install dogfood verification (Slice 2.6.1.D)** — confirmed
  end-to-end on a temp HOME that the 2.6.0 tarball's `postinstall`
  creates `~/.claude/agents/karpathy-reviewer.md` (15.4 KB, mode
  0600) and the matching `.peaks-managed` marker (245 bytes, JSON
  with `version`, `kind`, `agentName`, `sourcePath`, `contentSha256`).
  The 8-platform skill fan-out also confirmed (codex, cursor, trae,
  trae-cn, qoder, tongyi-lingma, hermes, openclaw). After Slice E,
  the agent install fans out to 4 of those platforms as well.

---

## [2.6.0] — 2026-06-18

### Added (karpathy-enforcement program — slices 1–5)

- **`peaks-rd` 4-way → 5-way fanout with karpathy-reviewer sub-agent** (slice
  1+5) — every RD implementation now spawns 5 parallel reviewers
  (`code-reviewer` + `security-reviewer` + `perf-baseline-reviewer` +
  `qa-test-cases-writer` + `karpathy-reviewer`). The 5th sub-agent emits a
  compact JSON envelope `{passed, violations, gateAction}` against the 4
  Karpathy guidelines (Think Before Coding / Simplicity First / Surgical
  Changes / Goal-Driven Execution). Contract slot at
  `skills/peaks-rd/references/rd-fanout-contracts.md` §"karpathy-reviewer
  contract (Slice 5/6)". Karpathy-guidelines context block injected into
  every RD sub-agent prompt via `rd-sub-agent-dispatch.md` (4-section
  verbatim).
- **Hard Karpathy-Gate (Slice 5/6)** — new `KARPATHY_REVIEW` prereq in
  `src/services/artifacts/artifact-prerequisites.ts` blocks
  `peaks request transition --state qa-handoff` when `rd/karpathy-review.md`
  is missing or doesn't contain the `## Karpathy-Gate` header + 4
  title-case section markers (Think Before Coding / Simplicity First /
  Surgical Changes / Goal-Driven Execution). CLI error code
  `PREREQUISITES_MISSING`. Escape hatch: `peaks request transition
  --allow-incomplete --confirm` (assisted mode).
- **Karpathy prompt-injection across the full RD surface** (slice 1) —
  4-layer guard: SKILL.md body + 3 reference docs
  (`mandatory-tech-doc.md`, `rd-fanout-contracts.md`,
  `rd-sub-agent-dispatch.md`) + 1 sub-agent dispatch context. Regression
  test `tests/unit/skills/karpathy-prompt-injection.test.ts` (9 cases)
  asserts the 4-section guidelines block is present in all 4 layers.
- **`peaks scan karpathy` CLI** (slice 5) — structural scanner for
  `rd/karpathy-review.md`; markdown + JSON output; 4 guideline
  classification + section coverage + violation counts. Companion to
  the karpathy-reviewer sub-agent (regex / file-presence vs semantic
  review). New service `src/services/scan/karpathy-service.ts` (330
  lines).
- **Tech-doc 3 mandatory sections + Gate C enforcer** (slice 2) —
  `Architecture` / `Existing API or Component Inventory` / `Trade-offs`
  sections now required in every RD `tech-doc.md`. Enforced at
  spec-locked gate. New service
  `src/services/audit/enforcers/tech-doc-mandatory-sections.ts`.
- **`peaks scan api-surface` CLI** (slice 3) — identifies existing API
  endpoints / components / stores / mocks in the consumer project
  before any new code is written. `--project --format --scope --max-per-kind`
  options; output feeds the tech-doc's `## Existing API or Component
  Inventory` section. New service
  `src/services/scan/api-surface-service.ts` (~280 lines).
- **`peaks scan orphan` CLI** (slice 4) — 4-kind orphan detection
  (exportOrphan / importOrphan / cliSubcommandOrphan /
  docEndpointOrphan). `--project --format --scope --strict` options;
  aligns with karpathy §3 Surgical Changes "remove what your changes
  made unused". New service `src/services/scan/orphan-service.ts`
  (~330 lines).
- **Slice 1-4 + Slice 5 all converged at `state: verdict-issued`** with
  cumulative **86/86** vitest pass, 0 tsc errors, 0 lint findings, 0
  diff-vs-scope violations, 0 unclassified files, 0 repair cycles.

### Added (Slice 6/6 + Slice 7/7 — karpathy-reviewer sub-agent prompt + auto-install)

- **`karpathy-reviewer` LLM sub-agent prompt** (slice 6) — full system
  prompt at `agents/karpathy-reviewer.md` (15.1 KB, 229 lines). 10
  sections covering role boundary, 4 input contracts, 4 violation
  detection rules (one per Karpathy guideline), JSON envelope schema
  (`passed` / `violations[]` / `gateAction`), file-write contract
  (title-case `## Karpathy-Gate` + 4 guideline sections), 8 hard
  prohibitions, 5 anti-patterns. Project-internal 2-line pointer at
  `skills/peaks-rd/references/karpathy-reviewer-prompt.md` (peaks-cli
  2.0 rules convention).
- **Auto-install on `npm i -g peaks-cli@latest`** (slice 7) — the
  `peaks-cli` postinstall (`scripts/install-skills.mjs`) now copies
  bundled agents from the tarball to `~/.claude/agents/` with
  content-hash drift detection (`.peaks-managed` marker + SHA-256).
  Mirrors the existing `output-styles` install contract. New function
  `installBundledAgents` + per-platform fan-out
  `installBundledAgentsForAllPlatforms` (claude-code is the only
  platform with `agentsDir` today; future platforms opt in by adding
  the field to their `IDE_SKILL_INSTALL_PROFILES` entry).
- **Escape hatch** (slice 7) — `PEAKS_SKIP_AGENT_INSTALL=1` (skip
  agent install in CI / sandboxed environments);
  `PEAKS_CLAUDE_AGENTS_DIR=/custom/path` (per-IDE env-var override,
  parallel to `PEAKS_CLAUDE_SKILLS_DIR` and
  `PEAKS_CLAUDE_OUTPUT_STYLES_DIR`).
- **Tarball coverage** (slice 7) — `package.json#files` adds
  `"agents/**"` alongside the existing `"skills/**"` and
  `"output-styles/**"`. `npm pack --dry-run` confirms
  `agents/karpathy-reviewer.md` (15.8 kB) ships in the tarball.

### Security

- All 4 karpathy sub-agent review surfaces (RD main loop + 5-way
  fanout) explicitly **MUST NOT install hooks, agents, MCP, or
  settings** — the global peaks-rd red line, restated as a
  hard prohibition in the karpathy-reviewer prompt.
- `installBundledAgents` uses the same TOCTOU-safe atomic write
  pattern as `installBundledOutputStyles`:
  `writeFileExclusively` (O_EXCL + O_NOFOLLOW, 0o600 mode, file
  identity check after write) + `.peaks-managed` marker with
  SHA-256 hash. Drift detection refuses to overwrite user-authored
  files (no marker) or stale markers (different source path).
- The `PEAKS_CLAUDE_AGENTS_DIR` env-var override is documented but
  not security-sensitive (it points the install at a user-chosen
  dir; no escalation path).
- The 3 LOW security findings documented in `qa/security-findings.md`
  (markdown injection via `--project` value interpolation, path
  traversal via arbitrary paths, KARPATHY_REVIEW prereq marker
  spoof) are all non-blocking by design (RD-authored input only,
  read-only file IO, drift detection prevents tamper).

### Tests

- **141/141 vitest pass** (was 86 in 2.5.0; +55 across the 7 slices):
  - 9 new `karpathy-prompt-injection.test.ts` (slice 1)
  - 7 new `tech-doc-mandatory-sections.test.ts` (slice 2)
  - 8 new `api-surface-scan.test.ts` (slice 3)
  - 8 new `orphan-scan.test.ts` (slice 4)
  - 14 new `karpathy-5way-fanout.test.ts` (slice 5)
  - 9 new `karpathy-6-agent-prompt.test.ts` (slice 6)
  - 8 new `installBundledAgents` cases in `install-skills-script.test.ts`
    (slice 7)
  - **Zero regression** across the 86 prior cases (slices 1-5) and
    the 38 prior `install-skills-script.test.ts` cases (slice 7's
    new agents branch).
- Hard Karpathy-Gate verified end-to-end:
  `peaks request transition --state qa-handoff` with
  `rd/karpathy-review.md` present → `state: qa-handoff`; without it
  → `code: PREREQUISITES_MISSING, missing: rd/karpathy-review.md`.
- End-to-end postinstall verified against a temp HOME:
  `Peaks agents installed across 1 platforms (1 total files)`;
  `~/.claude/agents/karpathy-reviewer.md` (15,786 bytes, mode 0600);
  `~/.claude/agents/karpathy-reviewer.md.peaks-managed` (224 bytes,
  valid JSON marker with SHA-256).

### L2 dogfood (deferred)

- **L2-install test for Slice 7** — the auto-install path is
  L1-verified (vitest + end-to-end postinstall against a temp HOME)
  but not yet L2-verified on a real consumer machine. A real
  `npm i -g peaks-cli@2.6.0` + postinstall + content-hash drift
  check + uninstall + reinstall cycle is the next L2 step (Slice 8
  follow-up if issues surface).
- **Trae / Codex / Cursor / Qoder / Tongyi Lingma / Hermes /
  OpenClaw agent install** — only `claude-code` has `agentsDir`
  populated in `IDE_SKILL_INSTALL_PROFILES`. Future slices can add
  the field per-platform once each IDE's agent directory convention
  is confirmed.
- **Slice 6 user-handoff doc** — `rd/karpathy-reviewer-agent-handoff.md`
  is now the auto-install verification doc (the original user-cp
  design was superseded by Slice 7). L1-verified via the
  `karpathy-6-agent-prompt.test.ts` AC-7 + AC-8 assertions; L2
  verification deferred to the first real npm publish.

---

## [2.5.0] — 2026-06-17

### Fixed (realworld-fixes slice 014)

- **Context-overflow guidance now visible in SKILL.md body** (sub-fix A) — slice
  011 added `peaks session checkpoint` / `peaks session resume` CLIs plus
  `references/checkpoint-resume.md` + `references/periodic-checkpoint.md`, but
  SKILL.md body only mentioned them in a single line. New Claude Code sessions
  that load SKILL.md never learned the optimization existed. `### Peaks-Cli
  Step 0.75: Resume from checkpoint` and `### Peaks-Cli Step N: Periodic
  checkpoint` headings are now in the body (≥ 5 lines each), with explicit
  `peaks session checkpoint` / `peaks session resume` CLI mentions and
  reference-doc pointers. Byte cap bumped 22K → 24K (precedent: 18K → 20K → 22K).
- **`peaks test <pattern...>` CLI with smart cache** (sub-fix B) — new CLI
  auto-detects jest / vitest / mocha from consumer `package.json`, runs with
  `--cache` (NOT `--no-cache`, overriding the consumer's `test` script).
  Per-test fingerprint cache at `.peaks/_runtime/test-cache/<hash>.json` with
  schema `{ fileMtime, fileSha256, testName, status, durationMs, lastRun }`
  skips unchanged tests on re-run. Options: `--changed`, `--clear-cache`,
  `--no-cache-result`, `--passthrough`, `--all`. Exits 0 if all pass/skip,
  1 if any fail. This is a NEW top-level subcommand (peaks-test exception
  per G16; not a pure wrapper because of smart-cache value-add).
- **Playwright MCP multi-terminal conflict resolution** (sub-fix C) — new
  `peaks playwright start | ls | stop` CLI. `start` walks default port 8931
  → 8949, spawns `playwright-mcp` via `npx` (not bundled), writes
  `.peaks/_runtime/playwright-sessions/<terminal-id>.json` with
  `{ port, userDataDir, startedAt, pid }`. Terminal ID: `TERM_SESSION_ID` ||
  `WT_SESSION` || hash(`ppid` + `SSH_TTY`). Conflict detection emits a
  clear "port in use; pick --port or --reuse" message.

### Security

- `peaks playwright start` uses `spawn` with array argv (no shell concat) to
  eliminate command-injection risk.
- Terminal IDs are sanitized (`[^a-zA-Z0-9_.-]` → `_`) before becoming
  filenames.
- Port walk range is bounded 8931-8949 (19 ports) to prevent scanning the
  full port space.

### Tests

- 81 new vitest assertions across `test-cache-service.test.ts` (19),
  `test-command.test.ts` (17), `playwright-command.test.ts` (18), and the
  bumped skill-slim-content-coverage test (now 18 cases under 24K cap).
- Argv contract: `peaks test` defaults include `--cache`; `--no-cache` is
  only added when the user explicitly passes it (or `--passthrough`).

### L2 dogfood (deferred)

- None — all 3 sub-fixes are L1-only; no real-install / real-consumer
  dogfood required for 2.5.0.

---

## [2.4.0] — 2026-06-17

### Added

- **`CURSOR_ADAPTER`** (slice 012) — Cursor IDE registration on the existing
  `IdeAdapter` shape. 12 required fields filled: `id: 'cursor'`,
  `settings.dirName: '.cursor'`, `settingsFileName: 'settings.json'`,
  `envVar: 'CURSOR_PROJECT_DIR'` (UNVERIFIED),
  `hookEvent: 'beforeShellExecution'` (UNVERIFIED),
  `toolMatcher: 'Bash'`, `promptSizeAware: true`, `statusline: true`.
  `standardsProfile` and `skillInstall` left UNVERIFIED — falls back to
  the legacy Claude Code path with stderr warning per slice #011 framework.
- **`CODEX_ADAPTER`** (slice 013) — OpenAI Codex CLI registration. 12
  required fields: `id: 'codex'`, `settings.dirName: '.codex'`,
  `settingsFileName: 'settings.json'`,
  `envVar: 'CODEX_PROJECT_DIR'` (UNVERIFIED),
  `hookEvent: 'pre_tool_use'` (UNVERIFIED),
  `toolMatcher: 'shell'`, `promptSizeAware: false` (Codex hook semantics
  differ from Claude's), `statusline: false` (Codex CLI has no statusline
  UI). `standardsProfile` and `skillInstall` left UNVERIFIED — same
  legacy fallback.
- **`HOOK_COMMAND_BY_IDE` dispatch table** (slice 012+013 infrastructure)
  — `src/services/skills/hooks-settings-service.ts::resolveHookSpec`
  refactored from hardcoded if/else into a per-IDE dispatch table.
  Byte-stable for `claude-code` and `trae` (AC8 / AC15 ✓). New adapters
  join the table without per-IDE branch rewrites.

### Security

- UNVERIFIED annotations on `envVar` / `hookEvent` for Cursor and Codex
  carry the same risk profile as the slice #009 Trae UNVERIFIED state —
  the per-IDE field values are not yet confirmed against real installs.
  Until L2 dogfood closes, `peaks hooks install --ide cursor|codex`
  will write hook entries that follow each IDE's most-likely hook
  schema; if the IDE rejects the entry, the install returns a non-zero
  exit code with the schema mismatch surfaced in stderr.
- Bundled-skills postinstall for Cursor / Codex writes to
  `~/.claude/skills/` (legacy Claude Code fallback), NOT to
  `~/.cursor/skills/` or `~/.codex/skills/`. This is the slice #011
  framework's intentional fallback for adapters whose `skillInstall` is
  UNVERIFIED; AC16 is 3-layer-verified.

### Performance

- `detectIdeFromContext` cwd-fallback path stays linear in adapter count.
  Slice #2 memory anchor: 2 adapters ≈ 27µs; this release: 6 adapters
  ≈ 67µs (extrapolated; well under 1ms budget).
- `HOOK_COMMAND_BY_IDE` dispatch is a `Map.get` lookup — O(1) per hook
  install, no per-IDE if/else branch overhead.

### Tests

- 48 new vitest cases across `cursor-adapter.test.ts` (24) and
  `codex-adapter.test.ts` (24). **182/182 pass** in
  `tests/unit/ide/` (was 134; +48).
- AC6 / AC13 explicitly assert `<projectRoot>/.<ide>/settings.json` for
  `scope=project` (L1 default); AC7 explicitly asserts
  `~/<ide>/settings.json` for `scope=global`.
- AC16 (UNVERIFIED skillInstall fallback) verified at three layers:
  (1) adapter field is `undefined`; (2) `getSkillInstall('cursor')` and
  `getSkillInstall('codex')` return `null`; (3) `install-skills.mjs:474-484`
  emits stderr "falling back to the legacy Claude Code path
  (~/.claude/skills + ~/.claude/output-styles)" and writes to
  `~/.claude/skills/`.
- Byte-stability: `git diff
  src/services/ide/adapters/{claude-code,trae}-adapter.ts` returns
  empty (AC8 / AC15 ✓). Dispatch chokepoints `resource-profile.ts` /
  `ide-aware-standards-service.ts` / `install-skills.mjs` untouched
  (R6 inverse rule ✓).

### L2 dogfood (deferred)

- Real-install dogfood for Cursor 1.x — fill `CURSOR_ADAPTER.envVar` and
  `CURSOR_ADAPTER.hookEvent` from real payload, remove UNVERIFIED
  annotations. Follow the slice #009 Trae-dogfood pattern
  (`tests/fixtures/cursor/cursor-1x-payload.json` + 5+ dogfood paths on
  a real install once available).
- Real-install dogfood for Codex — same pattern as Cursor.
- `standardsProfile` + `skillInstall` filling for both adapters is
  gated on the env/hook dogfood landing first.
- Qoder + Tongyi Lingma adapters (slice #3+ backlog) remain deferred.

### Notes

- Pipeline layout caveat: `peaks workflow verify-pipeline` expects
  artifacts under `.peaks/_runtime/<change-id>/...` (per-change layout) but this
  session writes under `.peaks/_runtime/<session-id>/...` (per-session
  runtime layout). The pipeline may report `gateC: fail` despite a
  PASS verdict; reconcile in a future slice (peaks-cli tooling fix,
  not a 2.4.0 blocker).

---

## [2.3.0] — 2026-06-17

### Added

- **`peaks workspace consolidate`** (slice 011) — atomic cross-date session retirement.
  Dry-run by default; `--apply` moves `.peaks/_runtime/<sessionId>/` to
  `.peaks/_archive/retrospective-<date>/<sessionId>/` with `manifest.json`.
  Supports `--keep <sessionId>...` and `--older-than <days>`. Invoked by skill,
  not by user.
- **`peaks session checkpoint`** (slice 011) — JSON snapshot of session state
  for context-overflow recovery. 11 fields (sessionId, lastActivity, currentPlan,
  openQuestions[], recentDecisions[], recentArtifactPaths[], gitStatus,
  skillsActive, todoState, reason, createdAt). Max 10 retained, oldest auto-pruned.
- **`peaks session resume`** (slice 011) — reads checkpoint JSON, emits structured
  markdown block for skill to prepend on session restart.
- **peaks-solo Step 0.5** (slice 011) — cross-date session check.
  IDE-agnostic; lives in `skills/peaks-solo/references/cross-date-session-check.md`.
- **peaks-solo Step 0.75** (slice 011) — checkpoint resume probe.
- **peaks-solo Step N** (slice 011) — periodic checkpoint guidance.

### Security

- Path-traversal guard on `consolidate` destination (rejects `..`).
- `checkpoint` writes only inside `.peaks/_runtime/<sessionId>/checkpoints/`.
- `resume` reads only from `.peaks/_runtime/<sessionId>/checkpoints/*.json`.

### Performance

- 50-session `consolidate` plan+apply completes in <500ms (warm cache).
- `checkpoint` write <100ms per call.
- 12th checkpoint prunes oldest (MAX_CHECKPOINTS=10).

### Tests

- 25 new unit tests (12 consolidate + 8 checkpoint + 5 resume) — all green.
- 112/112 slice-relevant tests pass; 9 pre-existing baseline failures on
  `26a4bab` are unrelated and out of scope.

### L2 dogfood (deferred)

- Cross-IDE dogfood for Trae deferred to follow-up — see
  `.peaks/_runtime/2026-06-16-session-aaf8c7/qa/dogfood/2026-06-17-cross-ide.md`.
- slice #2 adapter registry contains only `claude-code` + `trae`; Cursor / Codex /
  Qoder / Tongyi Lingma are slice #3+ scope.

## [2.2.1] — 2026-06-14

### Fixed

- **Removed the `Bash` matcher from the consumer-project
  `.claude/settings.local.json` template** (`TEMPLATE_VERSION` 1.1.0 →
  1.2.0). The Bash matcher was emitting `process.exit(1)` with no
  stderr on every non-`peaks` Bash call, producing
  `Failed with non-blocking status code: No stderr output` noise in
  the Claude Code UI even though the underlying tool call still
  proceeded (per Claude Code's hook contract, `exit 1` is a
  non-blocking error, not a block — only `exit 2` blocks; only the
  absence of a downstream `[Fact-Forcing Gate]` turned the exit-1
  into pure noise). The `[Fact-Forcing Gate]` is an Edit/Write
  concern (it forces the LLM to quote user instructions before any
  file write), and the Bash matcher was unrelated to that purpose.
  Bash command enforcement is now owned by `peaks gate enforce`,
  which `peaks hooks install` injects into `.claude/settings.json`
  and which exits 0 silently for any command not guarded by a
  registered SOP gate.

  Concrete changes:
  - `src/services/workspace/claude-settings-template.ts` — deleted
    `PEAKS_SUBCOMMAND_ALLOWLIST`, `buildBashHookCommand()`. The
    template now emits only the `Write|Edit|MultiEdit` matcher.
  - `TEMPLATE_VERSION` bumped to `1.2.0`. The offline-template
    self-heal (`peaks workspace init` re-run; comparator
    `templateContentMatches` sees the dropped entry) refreshes
    `.peaks/.claude-settings-template.json` and the consumer's
    `.claude/settings.local.json` on the next `peaks workspace init`.
  - The `peaks workspace init` install prompt for the project-level
    `.claude/settings.json` still installs the `peaks gate enforce`
    hook for Bash (unchanged).

### Tests

- `tests/unit/workspace/claude-settings-template.test.ts` — added
  `template only emits the Write|Edit|MultiEdit matcher` assertion.
  Removed four Bash-specific tests (hook command contract, embedded
  double-quote escaping, `process.argv[1]` reading for the Bash
  hook, `peaks workspace init` allow / `npm install foo` deny).
  `templateContentMatches returns false when entry length differs`
  now uses an empty `PreToolUse` array to keep the test name
  accurate.
- `tests/unit/workspace/workspace-init-claude-hooks.test.ts` — case A
  (default-flags init) assertion changed from
  `expect(matchers).toContain('Bash')` to
  `expect(matchers).toEqual(['Write|Edit|MultiEdit'])`. File-level
  AC description updated to reflect the one-matcher shape.

Full suite: **2957 passed, 12 skipped, 0 failed**.
`peaks doctor`: **70 passed, 0 failed**.

---

## [2.2.0] — 2026-06-14

### Added

- **Generic fzf binary picker** — `src/services/fuzzy-matching/fzf-pick-service.ts` exposes
  `pickFromList<T>({ items, formatLine, parseLine, outputPath, meta, fzfBin, preview, overrideStdin, projectRoot, multi, prompt })`.
  Promoted from `slice-pick-service.ts`; the algorithm is fzf-free, the binary is the consumer.

- **`peaks memory list`** — new subcommand. Reads `.peaks/memory/index.json`, applies optional
  `--kind` filter, returns the full entry set as the standard envelope. Mirrors
  `peaks retrospective index`.

- **`peaks memory list --pick`** and **`peaks retrospective index --pick`** — both spawn fzf
  for interactive multi-select. Picked subset is written to `.peaks/memory/picked.json` or
  `.peaks/retrospective/picked.json` respectively. Exit code 127 on missing/old fzf.

- **`headroom-ai` preferences resolver** — `src/services/context/headroom-prefs.ts` with
  `resolveHeadroomOptions` and `shouldCompressResults` (pure functions, no IO). Sub-agent
  dispatch now reads `loadPreferences().headroom` and:
    - Hard-blocks `--use-headroom` when `headroom.enabled = false` (new error code
      `HEADROOM_DISABLED_BY_PREFERENCE`, exit 1).
    - Respects `--headroom-mode <m>` CLI override > `perTouchpoint.subAgentDispatch` >
      `defaultMode` precedence.
    - Falls back to G7 metadata-only on any preferences load failure (no dispatch break).

- **New preferences fields** — `headroom.perTouchpoint.subAgentDispatch` and
  `headroom.compressMinBytes` (default 4096). Shallow-merge on existing
  `preferences.json` files; no migration required.

- **Search result compression** — `searchMemoryWithResults` and
  `searchRetrospectiveWithResults` return a `CompressedResultsEnvelope` alongside the
  structured `matches` array. Joined match text is compressed via headroom-ai when the
  byte count exceeds `headroom.compressMinBytes`. Below-threshold or headroom-disabled
  cases return `compressedResults: null` (silent, non-blocking fallback).

- **`peaks memory search --compress-results`** — passes the option through. (Retrospective
  search gets the same in a follow-up slice if requested.)

- **`peaks slice decompose --benchmark`** — emits a `SliceBenchmark` envelope
  (`totalMs`, `codegraphQueries`, `p50ConfidenceDistribution`, `inputApproxBytes`,
  `outputJsonBytes`, `capturedAt`) and persists it to
  `.peaks/_runtime/benchmarks/<rid>.benchmark.json` for cross-version comparison.
  This is the egress path for verifying 2.1.0 → 2.1.1 algorithm optimizations
  (Stoer-Wagner min-cut + flow_step weights) end-to-end.

### Changed

- **`src/services/slice/slice-pick-service.ts`** is now a thin wrapper around
  `fzf-pick-service.ts`. Public API (`pickSlicesInteractive`, `PickOptions`,
  `PickedResult`) is preserved.

### Tests

- `tests/unit/fuzzy-matching/fzf-pick-service.test.ts` — 10 cases (ENOENT, version check,
  single/multi select, Esc-130, parseLine rejection, dedup, artifact write, overrideStdin,
  empty items).
- `tests/unit/headroom-prefs.test.ts` — 11 cases covering all `resolveHeadroomOptions`
  branches and `shouldCompressResults` (disabled / below-threshold / enabled / per-touchpoint
  mode).
- `tests/unit/slice/slice-pick-service.test.ts` — pre-existing 7 cases still pass.
- `tests/unit/memory-search-cli.test.ts` — 8 cases updated to await the now-async
  `runMemorySearch`.

### Dogfood

- `HEADROOM_DISABLED_BY_PREFERENCE` hard block verified end-to-end with a temp
  `.peaks/preferences.json` (`headroom.enabled=false`): exit 1, envelope code matches,
  two actionable `nextActions`. Without `--use-headroom`, the same project dispatches
  normally.

---

## [2.1.1] — 2026-06-13

### Added

- **`peaks slice decompose <rid>`** — the 6-stage slice-decomposition
  algorithm. Reads the PRD body, queries `peaks codegraph` for each
  acceptance criterion, reads `.understand-anything/knowledge-graph.json`
  for semantic boundary detection, builds a dependency DAG with verified
  edges, computes SCC + critical path, runs Stoer-Wagner-style min-cut
  with semantic-preference weights (`flow_step`=0.05, `imports`=10.0),
  and partitions the result into parallel batches.
  Outputs `.peaks/sc/slice-decomposition/<rid>.json`. Algorithm is
  fzf-free; the codegraph/understand-anything inputs are both
  consumed as algorithm inputs, not as decoration.

- **`peaks slice pick <rid>`** — interactive multi-select of candidate
  slices via `fzf` (>= 0.38). Reads the decomposition file, spawns
  fzf with formatted candidate lines, parses the multi-selection, writes
  `.peaks/sc/slice-decomposition/<rid>-picked.json`. The algorithm is
  fzf-free; this is the only fzf dependency in the pipeline.

- **`peaks slice plan <rid>`** — dry-run plan that reads -picked.json
  and produces a structured plan with `newRid`, `type`, `dependsOn`
  edges. `--apply` is documented as v1.1 behavior (the dry-run path
  is fully functional; v1.1 will wire it to spawn `peaks request init`).

- **`src/services/slice/slice-decompose-types.ts`** — 24 TypeScript types
  for the algorithm's input/output contract. Stable envelope shape;
  any field rename requires a migration path.

- **`src/services/slice/calibration-store.ts`** — pure LoC+test-count
  heuristic for work estimation. v1 reports `confidence: 'low'` until
  5+ historical slice records exist; v1.1 will switch to percentile
  lookup.

- **`peaks-solo` Step 0.6** — pre-mode-selection slice decomposition.
  Solo runs the algorithm automatically after Step 0.55 (1.x detection)
  returns "fresh". The user picks a profile informed by the
  decomposition's parallel structure.

- **3 new `peaks-solo/references/*.md`** — `slice-algorithm.md`
  (algorithm spec), `understand-anything-integration.md` (KG consumer
  contract), `fzf-integration.md` (operator-facing fzf usage).

- **Extended `codegraph-orchestration.md`** — grew from 5 lines
  to ~200 lines documenting the envelope contract, freshness
  contract, the v0.7.10 cross-file-affected limitation + v1
  fallback, the status-parsing regex, and the role-handoff envelope.

- **Extended `swarm-dispatch-contract.md`** — adds
  "Slice-decomposition-driven fan-out (v2.1+)" section. Swarm plans
  now derive from `parallelBatches` (with legacy `--type` lookup as
  the fallback path).

- **Extended `peaks-solo/SKILL.md`** — adds "Peaks-Cli Slice
  Decomposition (Step 0.6 — pre-mode-selection)" section.

- **Extended `runbook.md`** — adds "Step 2.5: Slice Decomposition"
  section between the PRD transition and the Swarm fan-out.

### Changed

- **`peaks codegraph` is now a runtime algorithm input**, not a
  decoration. The slice-decomposition algorithm queries it (Stage 1)
  and reads cross-file-affected results (Stage 2, with v0.7.10
  fallback to real import edges).

- **`understand-anything` is now a runtime algorithm input** at the
  semantic boundary layer. The algorithm adds `flow_step` /
  `contains_flow` edges to the DAG with the lowest min-cut weights
  (0.05 / 0.10), preferring to cut through semantic seams.

- **`peaks project dashboard` does not regress** with the new
  `.peaks/sc/slice-decomposition/` path. The path is at the top level
  of `.peaks/`, not under `.peaks/_runtime/`, so it does not trip the
  L3:l3-orphan-sessions doctor check.

### Deprecated

- The "one rid = one feature" pattern. From 2.1.1 onward, the
  recommended workflow is: PRD -> `peaks slice decompose` -> `peaks
  slice pick` (interactive) -> `peaks slice plan` -> N child rids.
  Legacy `--type`-based fan-out still works as a fallback for rids
  that pre-date the algorithm.

### Fixed

- **No public API, command, flag, or dependency change.** This is
  a feature-only patch. The new `peaks slice <subcommand>` family
  adds 3 sub-commands; existing `peaks slice check` is unchanged.

- **No data schema migration.** The new algorithm writes
  `.peaks/sc/slice-decomposition/<rid>.json` (and `<rid>-picked.json`).
  Both paths are git-ignored runtime state. No existing JSON file
  format changed.

- **`peaks codegraph` wrapper** now consistently accepts
  `--project <path>` for all subcommands (query, affected, status).
  The wrapper falls back to raw `codegraph` (without `--project`)
  only when `peaks` is not on PATH.

- **PRD body lookup** now walks `.peaks/_runtime/*/prd/requests/`
  (not just 3 hardcoded paths). Handles the real
  `NNN-<rid>.md` filename convention from `peaks request init`.

### Verified

- 232 test files / 2939 tests pass, 0 failures, 12 skipped
  (baseline 229/2894 -> delta +3 files / +45 tests).
- `npx tsc --noEmit` clean.
- `npm run build` clean.
- End-to-end CLI smoke test on peaks-cli repo:
  `peaks slice decompose 2026-06-13-slice-decompose-impl --json` returns
  `ok: true`, writes 9 work units, 1 dep edge, p50=247.5 within the
  expected [202, 248] range (8-WU 2.1.0 dry-run p50=225 +-10%).
- `peaks doctor` clean (no L3 regressions from the new path).
- QA verdict: pass (10 of 10 ACs pass; AC10 has 1 partial
  regarding peaks-cli's existing `review-fanout` path mapping, but
  the partial is a pre-existing architecture issue, NOT a regression
  from this slice).

### Known limitations (v1.1+ scope)

- `peaks codegraph` v0.7.10 `affected` returns 0 cross-file dependents;
  the algorithm falls back to real static import edges. v1.1 should
  read `.codegraph/codegraph.db` directly.
- understand-anything is not indexed on most projects; the algorithm
  falls back to structural-only cuts and reports
  `understandAnything.fallback: "structural-only"`.
- Calibration `confidence: 'low'` until 5+ historical slice records
  exist; v1.1 will switch to percentile lookup.
- fzf `>= 0.38` required for `peaks slice pick`. Earlier versions
  lack `--filter` and proper `--preview` support.
- The min-cut is a simplified sort + filter, not textbook
  Stoer-Wagner. v1.1 will swap in the full algorithm.
- `peaks slice plan --apply` is dry-run only; v1.1 will wire to
  spawn `peaks request init` for each picked slice.
- Path traversal hardening (`assertValidRid`) and DoS cap
  (`--max-wu N` default 500) are 1-line patches planned for v1.1.
- The 3 default runners (codegraph / understand / import-edge) have
  0% unit-test coverage because they shell out to real binaries.
  v1.1 will add `vi.mock('node:child_process')` tests to push
  coverage of `slice-decompose-service.ts` toward 100%.

---

## [2.1.0] — 2026-06-13

### Changed

- **`~/.peaks/config.json` is now strictly `{ version, ocr.llm.* }`.**
  All LIVE runtime data has moved to dedicated sidecar files under
  `~/.peaks/`:
  - `~/.peaks/providers.json` — `providers.minimax.{model, baseUrl, apiKey}`
    and any future custom provider configs (canonical home: provider-service.ts).
  - `~/.peaks/proxy.json` — `httpProxy` for outbound HTTP/HTTPS
    (canonical home: proxy-service.ts).
  - `~/.peaks/workspaces.json` — registered workspaces + current-workspace
    pointer (canonical home: workspace-state-service.ts).
  On-disk legacy bloat is auto-detected and promoted to the correct
  sidecar on next CLI invocation; the slim `config.json` is then
  rewritten. The migration is **idempotent and silent** — no user
  action required.
- **`peaks config migrate --apply` distributes legacy fields across
  their canonical homes.** `economyMode` / `swarmMode` continue to
  forward to `<project>/.peaks/preferences.json`; `providers` /
  `proxy.httpProxy` / `workspaces` / `currentWorkspace` now forward
  to their respective sidecar files. Original config is preserved
  in `~/.peaks/config.json.1.x.bak` for rollback.
- **`PeaksConfig` type marks legacy fields `@deprecated`.** The slim
  runtime shape is `{ version, ocr? }`; the legacy fields stay
  optional on the type so existing consumers (config-service.ts,
  workflow-commands.ts, etc.) continue to compile during the
  migration window. A future slice will redirect `setConfig` writes
  for legacy keys to their canonical homes with a clear migration
  hint.

### Added

- **New `src/services/config/sidecar-store.ts`** — path helpers
  (`providersConfigPath()`, `proxyConfigPath()`, `workspacesConfigPath()`)
  + generic `readSidecarJson<T>` / `writeSidecarJson` with the same
  hardened-fs guarantees as `config-safety.ts` (symlink / hardlink
  guards, atomic temp-file rename, 0o600 mode).
- **New `src/services/config/provider-service.ts`** —
  `getMiniMaxProviderConfig()`, `setMiniMaxProviderConfig()`,
  `getMiniMaxProviderStatus()`, `getAllProviders()`,
  `setProviderConfig(id, …)`, plus URL validation helpers
  (`isValidMiniMaxBaseUrl`, `validateMiniMaxBaseUrl`,
  `isValidProviderBaseUrl`, `validateProviderBaseUrl`,
  `validateModelProviderConfig`).
- **New `src/services/config/proxy-service.ts`** —
  `getHttpProxy()`, `setHttpProxy()`, `clearHttpProxy()`,
  `isValidProxyUrl()`, `validateProxyUrl()`.
- **New `src/services/config/workspace-state-service.ts`** —
  `getWorkspaces()`, `getCurrentWorkspace()`, `setCurrentWorkspace()`,
  `addWorkspace()`, `removeWorkspace()`, `getWorkspaceConfig()`,
  `getCurrentWorkspaceConfig()`, `getWorkspaceConfigForPath()`,
  `getWorkspaceConfigForCurrentPath()`,
  `ensureWorkspaceConfigForPath()`,
  `ensureWorkspaceConfigForCurrentPath()`.
- **`loadGlobalConfig()` governance hook.** On any read, if the
  on-disk `~/.peaks/config.json` contains fields outside
  `{ version, ocr }`, the function now promotes them to their
  sidecar file (if not already present) and rewrites the slim
  shape. Idempotent.

### Deprecated

- The `providers`, `proxy`, `workspaces`, `currentWorkspace`,
  `language`, `model`, `economyMode`, `swarmMode`, `tokens` fields
  on `PeaksConfig` are now `@deprecated`. They continue to work
  during the migration window (reads return merged legacy values;
  writes go to `~/.peaks/config.json`) but new code should target
  the sidecar modules directly. The next minor release (2.2.0)
  will remove them from the type entirely and `setConfig` will
  reject writes to these keys with a clear migration hint.

### Fixed

- **No public API, command, flag, or dependency change.** Existing
  CLI commands (`peaks config get/set`, `peaks config migrate`,
  `peaks config provider minimax …`) continue to work; their
  on-disk effects now match the slim 2.1.0 layout after the first
  governance pass.

### Verified

- 229 test files / 2894 tests pass, 0 failures, 12 skipped.
- Full 1.x → 2.0 → 2.1 dogfood cycle: `peaks config migrate --apply`
  on a bloated 1.x file produces the correct slim `config.json` +
  populated `providers.json` / `proxy.json` / `workspaces.json` +
  `<project>/.peaks/preferences.json` (per-project fields only).
- Rollback via `peaks config rollback` restores the original 1.x
  shape from `.bak`.
- `package.json.version` and `src/shared/version.ts` synced to
  `2.1.0` via `node scripts/sync-version.mjs` at release time.

---

## [2.0.6] — 2026-06-13

### Fixed

- **23 pre-existing test failures → 0 across 9 test files.** Repair slice
  `2026-06-13-repair-pre-existing-test-failures` (6 atomic commits, all
  green, all red-line compliant) eliminated the long-standing flake
  surface so the test suite is a trustworthy gate again.
- **`peaks doctor` L3:l3-memory-health now reads the actual on-disk
  schema.** The detector used to probe for a `schema_version` field
  that the durable memory store never writes; it now reads the real
  `version: 1` + hot/warm structure. The user-visible message text
  changed from `schema_version=N; K memory entries` to the more
  accurate `version=N; K hot + K warm memory entries` (cosmetic only;
  the JSON envelope `id` / `ok` / `message` shape is unchanged). The
  underlying `readMemoryFile` and the 3-state detector logic are
  unchanged — only the schema probe and the message formatter moved.
- **`plan-reader assertContained` realpath-resolves both sides
  symmetrically on macOS.** On macOS, `os.tmpdir()` is a symlink
  (`/var/folders/...` → `/private/var/folders/...`). The previous
  implementation realpath-resolved the actual on-disk path but compared
  it against the unresolved `expectedBase`, producing a spurious
  "outside project root" failure for any `peaks` CLI invocation that
  passed through a symlinked temp dir (notably `peaks doctor` and
  `peaks workflow verify-pipeline` from `/tmp`-style paths). Both
  sides are now resolved before comparison.

### Changed

- **No public API, command, flag, or dependency change.** Two source
  files were touched (`src/services/doctor/doctor-service.ts` and
  `src/services/workflow/plan-reader.ts`); both changes STRENGTHEN
  existing guards, neither widens the surface. Patch bump, not minor.

### Verified

- 23 → 0 test failures across 9 test files (full suite green).
- `peaks request transition --state implemented` accepted for
  `2026-06-13-repair-pre-existing-test-failures` prior to this release.
- `package.json.version` and `src/shared/version.ts` are in sync at
  `2.0.6` (regenerated via `node scripts/sync-version.mjs`).

---

## [2.0.5] — 2026-06-13

> **Retroactive entry.** Commit `9ab4154 feat: 2.0.5` only bumped
> `package.json` and `src/shared/version.ts`; this entry closes the
> documentation gap.

### Added

- **`peaks workflow skip <rid>`** — explicit gate-bypass primitive
  for the workflow pipeline. Backed by a three-rule classifier that
  must all pass before the bypass is allowed:
  1. **Slice-type allowlist** — only `chore` / `docs` / `refactor` are
     eligible; `feat` / `fix` / `perf` are not.
  2. **Env-var caller-id** — `PEAKS_SKIP_CALLER` (or
     `PEAKS_CALLER_ID`) must identify the human/skill driving the
     call; a missing or anonymous caller-id is rejected.
  3. **Mandatory `--reason`** — the CLI rejects `--reason ""`; the
     reason is persisted into the slice record for the retrospective.
  Three rules, not one: each rule is independently fail-closed, so a
  misuse in any one of them blocks the bypass. The classifier is the
  pure function `canSkipSlice(slice, callerId, reason)` so the rule
  set is testable in isolation.
- **`peaks workflow verify-pipeline --gate-skipped`** — reporting
  flag that surfaces slices that completed via the skip classifier
  during a pipeline run. The default `verify-pipeline` output hides
  skipped slices; `--gate-skipped` includes them in the per-slice
  breakdown with a distinct status and the recorded `--reason` so the
  retrospective can audit the bypass rate.

### Changed

- **No dependency / config / public-API change.** The 2.0.5 release
  is a feature-only patch.

### Verified

- 3-rule classifier test suite green (`tests/unit/workflow-skip-*`).
- `peaks workflow verify-pipeline --gate-skipped` returns the
  expected envelope shape on synthetic skip and non-skip fixtures.
- Slice `2026-06-13-peaks-workflow-skip` (the slice that introduced
  the feature) closed green and transitioned to `implemented` before
  the version bump.

---

## [2.0.4] — 2026-06-13 (hotfix)

### Fixed

- **PreToolUse hook `command` field was bare JavaScript source, not a
  `node -e "..."` one-liner.** `peaks workspace init` writes
  `.claude/settings.local.json` containing two PreToolUse hooks (one
  for `Bash`, one for `Write|Edit|MultiEdit`) whose `command` field
  was the inner JS payload without the `node -e "..."` wrapper.
  Claude Code executes the `command` field as a shell string, so
  bash saw literal `const c=process.argv[1]...` and tripped
  `syntax error near unexpected token`. Net effect on every 2.0.3
  install on Windows + macOS + Linux:
  - Every Bash tool call (peaks CLI or otherwise) was rejected.
  - Every Write / Edit / MultiEdit call was rejected.
  - The [Fact-Forcing Gate] bypass that `peaks workspace init` was
    supposed to install was therefore self-defeating — the bypass
    broke the gate itself, and the gate could not be reached to fix
    it.
  Recovery required the user to delete `.claude/settings.local.json`
  manually (losing the bypass permanently) or hand-patch the
  `command` field (drift vs the template).
  The fix wraps both builders' JS payloads in a real shell-evaluable
  `node -e "<js>"` form via a new `wrapAsNodeOneLiner` helper in
  `src/services/workspace/claude-settings-template.ts`. Inner `"`
  are escaped to `\"`; backslashes pass through unchanged so regex
  literals like `/\.peaks\//` still match correctly. `process.argv[1]`
  is the correct slot under `-e` per Node.js docs
  (https://nodejs.org/api/process.html#processargv) — consistent
  across Windows, macOS, and Linux. The docstring is reconciled
  with the implementation (the previous docstring incorrectly said
  `argv[2]`).

  Regression tests cover:
  - `buildBashHookCommand()` and `buildWriteHookCommand()` return
    `node -e "..."` form.
  - Inner `"` are escaped to `\"`.
  - Spawning the wrapped command with `peaks workspace init --project . --json`
    exits 0; with `npm install foo` exits non-zero.
  - Spawning the Write hook with `.peaks/_runtime/...` and
    `.peaks/_runtime/<changeId>/...` paths exits 0; with `src/...`,
    `package.json`, `.peaks/_archive/...` exits non-zero.
  - The existing workspace-init round-trip test (case A/B/C) still
    passes with the wrapper.

---

## [2.0.3] — 2026-06-13

### Fixed

- **`@alibaba-group/open-code-review` reverted to `optionalDependency`**
  (was promoted to a hard `dependency` in 2.0.1 and carried through
  2.0.2). The ocr npm package's `postinstall` downloads a Go binary
  via HTTPS, which fails in restricted/proxied environments and was
  aborting the whole `npm i -g peaks-cli` flow. The 5-state detector
  (`ready` / `package-missing` / `binary-missing` / `config-missing` /
  `detection-failed`) and the soft-fail policy are unchanged — peaks-cli
  never blocks on ocr being installed; it just no longer forces the
  install. Users who want the second-opinion review run
  `npm i -g @alibaba-group/open-code-review` explicitly. Under pnpm
  they also need `pnpm approve-builds @alibaba-group/open-code-review`
  for the binary download to run. Source-of-truth refactor (ocr config
  under `peaksConfig.ocr.llm`) from 2.0.1 is unchanged.

---

## [2.0.0] — 2026-06-12

### 🎯 Headline

**One-key 1.x → 2.0 upgrade.** `npm i -g peaks-cli@2.0` runs the full
upgrade umbrella in the consuming project automatically (gated by the
1.x detector). The manual fallback is `peaks upgrade --to 2.0 --auto`.

The architecture moves to **skill-first / CLI-auxiliary**: skill SKILL.md
files are the primary surface the LLM consumes; CLI commands are
machine-enforced gates, structured-JSON probes, or side-effect primitives.
See `.claude/rules/common/dev-preference.md` (project-local) for the
operating tenet.

**ocr second-opinion code review (soft-optional).** Alibaba's
`@alibaba-group/open-code-review` is now an `optionalDependency`; when
installed + configured against a user-owned LLM endpoint, peaks-rd's
Gate B3 merges its findings into `code-review.md` as a second opinion
alongside the LLM-only review. Soft-fails so missing ocr never blocks
a slice. New CLI: `peaks code-review detect-ocr` / `run-ocr`. See
`skills/peaks-rd/references/ocr-integration.md` for the contract.

> **Note:** This `optionalDependency` classification was briefly
> promoted to a hard `dependency` in 2.0.1 (alongside the source-of-truth
> refactor) because the user feedback was "peaks-cli should not leave
> install to the user". 2.0.3 reverts just the classification — the
> source-of-truth refactor stays — because the ocr postinstall
> downloads a Go binary via HTTPS, which fails in restricted/proxied
> environments and was aborting `npm i -g peaks-cli`. See the 2.0.3
> entry above for the full rationale.

### Breaking Changes

- **`.claude/rules/` is no longer the source of truth for project standards.**
  The 2.0 canonical location is `.peaks/standards/{common,typescript}/*.md`.
  The 1.x `.claude/rules/` tree is thinned to 2-line pointers during upgrade,
  preserving the original under `.claude/rules/.peaks-2.0-backup-<ISO>/`.

- **`.gitignore` requires a granular `.peaks/` block**, not a wholesale
  `/.peaks/` ignore. The upgrade umbrella migrates the consumer's
  `.gitignore` automatically (with a timestamped backup); without it, 2.0
  tracked artifacts (`.peaks/standards/`, durable `.peaks/memory/*.md`,
  `.peaks/PROJECT.md`, opt-in markers) would be silently hidden from git.

- **Per-project config moved from `~/.peaks/config.json` to `<project>/.peaks/preferences.json`.**
  `~/.peaks/config.json` retains only `{ "version": "2.0.0" }`. Fields
  `economyMode`, `swarmMode`, headroom settings, etc. are now per-project.
  The upgrade umbrella runs `peaks config migrate --apply` automatically.

- **Postinstall behavior changed.** `npm i -g peaks-cli@2.0` now:
  1. Symlinks bundled skills to **all 8 supported IDE platforms**
     (Claude Code, Trae, Cursor, Qoder, Codex, Tongyi Lingma, Aider, Roo Code),
     not just the auto-detected one. Per real Trae user feedback 2026-06-11.
  2. Installs bundled output styles.
  3. If `cwd` contains a 1.x peaks-cli project, fire-and-forgets
     `peaks upgrade --to 2.0 --auto`. Opt out with `PEAKS_SKIP_AUTO_UPGRADE=1`.

### Changed — ocr source-of-truth moved into peaks-cli's config

Following the same-release user feedback that the original 2.0.0 ocr
config lived in `~/.opencodereview/config.json` (a file outside
peaks-cli's reach) and was set via the `ocr config set` CLI from the
upstream package, the ocr LLM endpoint config now lives under
`peaksConfig.ocr.llm` in `~/.peaks/config.json`. This makes the
user-managed LLM endpoint discoverable from a single, peaks-cli-owned
config surface.

- **`@alibaba-group/open-code-review` is now a hard `dependency`** (was
  `optionalDependency`). The user no longer has to remember to install
  it; `npm i -g peaks-cli` pulls it. Network-blocked installs that fail
  to download the platform binary still soft-fail at runtime
  (`binary-missing` state) — the install-time failure risk is the
  trade-off.

  > **Reverted in 2.0.3.** The install-time failure risk turned out
  > to bite too many real-world installs (corporate proxies, region
  > firewalls, sandboxed dev environments all abort the whole
  > `npm i -g peaks-cli`). 2.0.3 puts ocr back under
  > `optionalDependencies`; everything else in this section
  > (env-var injection, `config-template` CLI, `missingKeys`,
  > source-of-truth under `peaksConfig.ocr.llm`) is unchanged.
- **`detectOcr` / `runOcrReview` no longer read `~/.opencodereview/config.json`.**
  The source of truth is `peaksConfig.ocr.llm` (parsed by
  `getOcrLlmConfig()` in `config-service.ts`). Missing fields surface
  in `data.missingKeys`; the `config-missing` state's `nextActions`
  payload embeds the JSON template to paste.
- **Env-var injection replaces file writes.** `runOcrReview` injects
  `OCR_LLM_URL` / `OCR_LLM_TOKEN` / `OCR_LLM_MODEL` /
  `OCR_USE_ANTHROPIC` / `OCR_LLM_AUTH_HEADER` from `peaksConfig.ocr.llm`
  when spawning the ocr subprocess — the ocr package's highest-priority
  config path. peaks-cli never has to materialise
  `~/.opencodereview/config.json`, and does NOT auto-configure the
  endpoint — the user is the only party that touches the LLM
  token / URL.
- **New CLI: `peaks code-review config-template`.** Prints the JSON
  snippet the user pastes into `~/.peaks/config.json`. It does NOT
  write anything. No `peaks ocr config set`, no `ocr config set` — just
  edit peaks-cli's config.json (or use
  `peaks config set --key ocr.llm.url --value '...'` if preferred).
- **JSON envelope contract change:** `OcrDetectResult.configPath` now
  points at the peaks-cli config (e.g. `~/.peaks/config.json`) instead
  of the OCR package's legacy file. A new `missingKeys` field lists the
  required `ocr.llm.*` keys the user has not yet populated. The
  five-state contract and the soft-fail policy are unchanged.

### Migration (ocr source-of-truth)

Users who already configured `~/.opencodereview/config.json` for the
soft-optional 2.0.0 release should:

1. Run `peaks code-review config-template --json` to see the JSON
   snippet.
2. Paste the equivalent values into `~/.peaks/config.json` under
   `ocr.llm` (peaks-cli handles the camelCase conversion; the
   template shows the canonical shape).
3. Re-run `peaks code-review detect-ocr --json` to verify
   `state == "ready"`.

The old `~/.opencodereview/config.json` is no longer consulted by
peaks-cli. The user may delete it at their discretion (the ocr
subprocess ignores it when peaks-cli's env vars are present).

### Added

- **`peaks upgrade --to 2.0`** — umbrella that orchestrates the 1.x → 2.0
  migration: config migrate, standards migrate (`--from-claude-rules`),
  memory extract (with disk-based glob expansion for the consumer's
  artifact tree), hooks install, skill sync, audit verify, plus
  in-process preferences-ensure, gitignore-migrate, and upgrade-record
  write. Soft-fail per sub-step; never blocks the whole upgrade.

- **`peaks upgrade --detect-1x`** — read-only probe returning a JSON
  envelope the peaks-solo skill consumes to gate the AskUserQuestion
  in Step 0.55.

- **`peaks standards migrate --from-claude-rules`** — thins `.claude/rules/`
  to 2-line pointers and scaffolds `.peaks/standards/{common,typescript}/`.

- **`peaks skill sync`** — distributes the skill family across all 8
  supported IDE platforms in one command.

- **`peaks audit red-lines`** — L2 catalog audit (P0/P1/P2-a/P2-b
  enforcers) for skills/SKILL.md, references/*.md, and the agent shield.

- **`peaks agent run`** — ECC 64 agents soft-optional integration
  (spec §7.2). When the L3 stack is installed, peaks delegates to it;
  otherwise degrades to peaks-cli's own core diagnostics.

- **`peaks memory search` / `peaks retrospective search`** — new search
  subcommands for the durable memory / retrospective stores.

- **`peaks workspace init / clean / archive`** — workspace lifecycle
  primitives with `--dry-run` default + `--apply` opt-in.

- **`peaks preferences set / get / reset`** — per-project preferences
  read/write CLI.

- **Two paired tenets** captured in `.peaks/memory/peaks-cli-tenet-one-key-completion.md`:
  - **One-key completion** — actions that can be done in one step
    should not be designed as two-step operations.
  - **Minimal user operation** — features can be powerful, but the
    user-facing surface should be minimal; the CLI/LLM figures it out.

### Fixed

- **(2026-06-12) `upgrade-service.ts` was missing from develop HEAD**,
  causing fresh clones to fail TS2307. Repaired in commit ec6f674.

- **(2026-06-12) `peaks standards migrate --from-claude-rules`** rejected
  as `unknown option`. CLI flag wiring fixed in core-artifact-commands.ts.

- **(2026-06-12) `peaks memory extract`** failed with
  `Artifact path must stay inside the project root` when the umbrella
  passed literal glob strings (`skills/**/SKILL.md`). The umbrella now
  expands globs on disk before spawning.

- **(2026-06-12) Three bugs surfaced by real-world ice-cola dogfood:**
  - memory-extract was called without `--apply` → always dry-ran, never
    actually wrote.
  - `.claude/skills/**/SKILL.md` (the standard Claude-Code consumer
    convention) was not walked; only `<root>/skills/` was scanned.
  - `.peaks/preferences.json` was never created after upgrade, so the
    1.x detector kept returning `isOneX=true` and the user got stuck
    in a re-prompt loop. Violated the one-key completion tenet.

- **(2026-06-12) `.gitignore` 1.x wholesale `/.peaks/` rule** silently
  hid every 2.0 tracked artifact. New `gitignore-migrate-service.ts`
  detects 4 wholesale forms (`.peaks`, `.peaks/`, `/.peaks`, `/.peaks/`),
  removes them, and appends the canonical 2.0 granular block with a
  sentinel comment. Idempotent; creates timestamped backup before write.

- **(2026-06-11) Windows: `peaks slice check`** was using `npx tsc` /
  `npx vitest` which spawned `cmd.exe` indirectly via the npx shim and
  failed with ENOENT. Now resolves local `node_modules/.bin/` binaries
  directly via `runCommand(shell: true)`.

### Deprecated

- **`peaks workspace migrate-1-4-1`** — retained for 1.4.1 → 1.4.2
  legacy session-layout backward compatibility. Will be removed in 2.1.
  Use `peaks upgrade --to 2.0` for the canonical migration path.

### Removed

- `~/.peaks/config.json` schema is now `{ "version": "2.0.0" }` only.
  All other fields are migrated to per-project `.peaks/preferences.json`
  by `peaks config migrate`.

### Architecture

- **Skill-first / CLI-auxiliary.** SKILL.md is the primary surface;
  CLI earns its keep only when (a) hook/script/CI-invokable, (b) the
  consumer needs a structured JSON envelope to gate a decision, or
  (c) destructive side-effect needs explicit `--apply`. See the
  decision template in `.claude/rules/common/dev-preference.md`.

- **Two-axis naming convention** for `.peaks/` workspace:
  `<changeId>` for reviewable artifacts under `.peaks/_runtime/<changeId>/...`;
  `<sessionId>` for ephemeral state under `.peaks/_runtime/<sessionId>/...`.
  Regression test pins zero use of ambiguous `<sid>`.

- **`.peaks/_runtime/`** replaces `.peaks/runtime/` (defensive wrong-path
  pattern still in .gitignore).

### Verified

- 223 test files / 2768 tests pass / 16 skipped.
- `npx tsc --noEmit` clean.
- `npm run build` clean.
- End-to-end dogfood on real 1.x consumer project (ice-cola): 6/6
  upgrade sub-steps pass; `.gitignore` migrated with backup; detector
  returns `isOneX: false` after upgrade; all 2.0 tracked artifacts
  surface in `git status`.

### Migration Guide

See `docs/UPGRADING-2.0.md` for the manual fallback if the auto-upgrade
is skipped (`PEAKS_SKIP_AUTO_UPGRADE=1` or `npm i --ignore-scripts`).

---

## [2.0.1] — 2026-06-12

### Fixed

- **Bug 1 — `~/.peaks/config.json` was bloated to 9 top-level fields.**
  The 2.0.0 release moved per-project fields (`language`, `model`,
  `economyMode`, `swarmMode`) to `<project>/.peaks/preferences.json`
  per spec §10.4, but the runtime `DEFAULT_CONFIG` still shipped
  `language` / `model` / `economyMode` / `swarmMode` / `tokens` /
  `providers` / `proxy` / `progress` placeholders. The slim migration
  (`executeMigration`) wrote `{ version: "2.0.0" }` only, but any
  code path that went through `readConfig` and re-serialised
  re-bloated the file. The 2.0.1 fix:

  1. **Slim `DEFAULT_CONFIG`** to `{ version, ocr: { llm: { url, authToken, model, useAnthropic, authHeader } } }`
     (placeholders for the OCR LLM endpoint only).
  2. **Slim migration write** to the same 2-key form, so a fresh
     `peaks config migrate --apply` produces a discoverable
     `ocr.llm` block the user can paste their endpoint into.
  3. **Tolerant loader.** Legacy 1.x files with extra fields
     (`language`, `model`, `tokens`, `providers`, `proxy`, etc.)
     still load without throwing; the legacy fields are exposed
     via `getConfig` for backward compatibility, and
     `setConfig` rejects writes to `language` / `model` /
     `economyMode` / `swarmMode` with a pointer to
     `<project>/.peaks/preferences.json` (do not silently migrate).

  The net effect: a freshly-installed peaks-cli writes a 2-key
  `~/.peaks/config.json`; legacy 1.x files migrate to the same
  2-key form; the ocr second-opinion config is now the only
  discoverable surface the user needs to populate to make
  `peaks code-review detect-ocr` report `state: "ready"`.

### Verification

- 70 config tests pass (`tests/unit/config-*`).
- `pnpm tsc -p tsconfig.json --noEmit` clean (excluding pre-existing
  sync-service test scaffold for Bug 2).

---

## [2.0.2] — 2026-06-13

### Changed — README redesign (docs only)

The top of both `README.md` and `README-en.md` is rebuilt in the
RAG-Anything style requested from the published repo: card-grid
metadata (PROJECT / BASED ON / SKILLS.SH / STARS / VERSION / LICENSE
/ TESTS / LANG / DOWNLOADS / 中文 / QUICK START / VISITORS), a
multiline `readme-typing-svg` tagline animation, a
`github-readme-streak-stats` streak band, and a `komarev` visitor
counter. Both languages are structurally identical (same card grid,
same animations, same anchor links); only the tagline and
call-to-action text differ.

- `README.md` updated to the new layout (typing animation uses the
  Chinese tagline: `peaks-cli: 跨 AI IDE 的工程门禁与编排`).
- `README-en.md` synced to mirror the new layout (typing animation
  uses the English tagline: `peaks-cli: cross-AI-IDE engineering
  gates & orchestration`).
- Card anchors renamed to ASCII-friendly slugs on the English file
  (`30-seconds-to-running`, `5-minute-onboarding`, `11-skills-in-the-family`,
  `killer-feature-un-bypassable-gates`) so the README renders
  consistently on GitHub's auto-generated anchor list.

No code, CLI, or schema changes. The CLI still reports
`Peaks CLI 2.0.2` after `prepublish` regenerates
`src/shared/version.ts`.

---

## [1.4.2] — 2026-06-08

Last 1.x release. See git history pre-2.0.0 for details.

[2.0.2]: https://github.com/SquabbyZ/peaks-cli/releases/tag/v2.0.2
[2.0.1]: https://github.com/SquabbyZ/peaks-cli/releases/tag/v2.0.1
[2.0.0]: https://github.com/SquabbyZ/peaks-cli/releases/tag/v2.0.0
