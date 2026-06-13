# Changelog

All notable changes to peaks-cli are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
