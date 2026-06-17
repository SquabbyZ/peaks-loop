# Changelog

All notable changes to peaks-cli are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
  artifacts under `.peaks/<change-id>/...` (per-change layout) but this
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
    `.peaks/<changeId>/...` paths exits 0; with `src/...`,
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
  `<changeId>` for reviewable artifacts under `.peaks/<changeId>/...`;
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
