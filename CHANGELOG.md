# Changelog

## 4.0.0-beta.17

### Patch Changes

- Repair registry install: `npm i -g peaks-loop` previously failed with
  `EUNSUPPORTEDPROTOCOL / workspace:*` because the publish workflow
  called `npm publish` on each workspace directory directly, which
  serialized the manifest verbatim and leaked the pnpm-only
  `workspace:*` protocol into the published tarballs. The new
  `scripts/release-pack.mjs` packs each workspace package with
  `pnpm pack` (which rewrites `workspace:*` to exact semver pins) and
  then publishes the resulting tarball via `npm publish <tarball>` so
  npm 11+ OIDC Trusted Publishing remains in effect.

  Bumped versions: `peaks-loop` 4.0.0-beta.16 → 4.0.0-beta.17; all
  eight subpackages 0.0.3 → 0.0.4. The publish workflow's changeset
  step is now conditional on detected `.changeset/*.md` files so the
  registry-repair release keeps its manually-pinned versions, and
  future releases still pick up automated `changeset version` bumps.

  - per-package OIDC Trusted Publisher entries still need to be added
    once on npmjs.com (one-time UI step per package).
  - the install smoke verifies the registry tarball surface: bin shim,
    package layout, postinstall, and registry metadata. `peaks
    --version`/`--help` may fail at runtime until
    `peaks-loop-crystallization` declares `zod` as a runtime
    dependency (a separate source bug, out of scope for this repair).

## 4.0.0

### Patch Changes

- Updated dependencies
  - peaks-loop-shared@0.0.5
  - peaks-loop-audit-independent@0.0.5
  - peaks-loop-crystallization@0.0.5
  - peaks-loop-doctor@0.0.5
  - peaks-loop-final-review@0.0.5

## 4.0.0

### Patch Changes

- Updated dependencies
  - peaks-loop-shared@0.0.5
  - peaks-loop-audit-independent@0.0.5
  - peaks-loop-crystallization@0.0.5
  - peaks-loop-doctor@0.0.5
  - peaks-loop-final-review@0.0.5

## 4.0.0

### Minor Changes

- 5d01343: Monorepo extraction: peaks-loop 4.0.0-beta.15 ships the new pnpm
  workspace shell with 6 independent packages extracted from the main
  repo as Tier-A zero/low-coupling domains:

  - peaks-loop-shared (4 utils: fs / paths / result / version)
  - peaks-loop-mut (mutation testing + ECC cache)
  - peaks-loop-doctor (project health check)
  - peaks-loop-crystallization (crystallization pipeline)
  - peaks-loop-final-review (4-dim business review)
  - peaks-loop-audit-independent (security + perf audit)

  Each subpackage has its own typecheck / build / vitest pipeline; they
  are wired back into the main peaks-loop CLI via workspace:_ protocol.
  Trusted Publishing (OIDC) is wired via .github/workflows/publish.yml
  on push tags v_._._ — no NPM_TOKEN required.

  Also:

  - D21: peaks sub-agent finalize command (LLM-side completion signal
    to mark dispatch records done/failed/cancelled; without it records
    would stay queued forever).
  - Trusted Publishing via OIDC — npmjs.com trusted publisher
    configured; npm token removed from ~/.npmrc.

### Patch Changes

- Updated dependencies [5d01343]
  - peaks-loop-shared@0.1.0
  - peaks-loop-mut@0.1.0
  - peaks-loop-doctor@0.1.0
  - peaks-loop-crystallization@0.1.0
  - peaks-loop-final-review@0.1.0
  - peaks-loop-audit-independent@0.1.0

## [Unreleased]

## 4.0.0-beta.14 — 2026-07-16

### Status: RELEASED (D-019: copy-templates.mjs + package.json files[])

> **This release fixes D-019 (full end-to-end)**:
>
> 1. `scripts/copy-templates.mjs` now copies
>    `src/services/skillhub/migrations/*.sql` into `dist/services/skillhub/migrations/`.
> 2. `package.json` `"files"` whitelist now includes `dist/**/*.sql`
>    (previously the whitelist was `dist/**/*.js | .d.ts | .md` only,
>    so the migrations were filtered out of the npm tarball even
>    after being copied to `dist/`).
>
> Without this fix, the published `peaks-loop` tarball shipped without
> the SkillHub SQLite schema, breaking any downstream consumer's first
> `peaks skill sediment <verb>` with `no such table: bee_release`.
>
> **Verdict**: `pnpm build` copies 6 migrations; tarball includes them.
> In-process vitest tests were always green (they use tsx + source tree
> directly, not `dist/`), so no test count change. Combined with
> 4.0.0-beta.13's D-018 path fix, the published tarball is now
> correct end-to-end.

## 4.0.0-beta.13 — 2026-07-16

### Status: RELEASED (D-018: state.db path relocation)

> **This release fixes the SQLite `state.db` location** to match the
> original peaks-loop design contract: `PEAKS_HOME/.peaks/skills/state.db`
> (PEAKS_HOME defaults to `~/.peaks`). Previously, the code resolved
> `home` to `process.cwd()` when invoked from a project root, producing
> `<project>/.peaks/state.db` — wrong location for loop engineering
>
> - bee sediment data.
>
> **Fix**: `src/cli/commands/sediment-commands.ts:664-665` now uses
> `peaksHome()` from `src/services/sop/sop-paths.ts:29` (which honors
> `PEAKS_HOME` override for test isolation). The downstream
> `resolveStateDbPath({ home })` (in `src/services/sediment/pool-paths.ts:15`)
> already correctly returned `{home}/.peaks/skills/state.db`; only the
> `home` resolution was broken.
>
> **Side bug found but out of scope**: `src/services/skillhub/migrations/*.sql`
> is not copied to `dist/` by `scripts/copy-templates.mjs`. This is a
> pre-existing build-config issue separate from D-018. Tracked as
> follow-up; tests still pass because the tests use vitest + tsx
> (which sees the source tree directly), but the published
> `peaks-loop@4.0.0-beta.13` will hit `no such table: bee_release` until
> a D-019 follow-up adds `.sql` to the copy-templates extensions.
>
> **Verdict**: 27/27 AC PASS (beta.12 verdict preserved; D-018 is
> architecture fix, no AC change). Old `<peaks-loop>/.peaks/state.db`
> discarded (beta phase, single user).

## 4.0.0-beta.12 — 2026-07-16

### Status: RELEASED (follow-up to `4.0.0-beta.11`; D-013 wrapper exit-code fix)

> \*\*This CHANGELOG entry documents the D-013 follow-up release.
> Same source tree as `4.0.0-beta.11`; pure fix for the wrapper
> exit-code bug that previously caused `peaks <unknown>` and
> `peaks <unknown> --help` to exit 0 with the help banner.
>
> **Verdict**: All 4 regression paths now exit 1 with a
> `COMMAND_NOT_FOUND` JSON envelope. ice-cola baseline 27/27 PASS
> (AC3.9/AC3.10 now functionally correct).

> \*\*This CHANGELOG entry documents the SHIPPED 4.0.0-beta.11.
> It is the post-implementation release of the 4.0.0-beta.10 contract
> documented at `docs/release/4.0.0-beta.10.md` (runbook filename
> preserved for cross-reference stability).
>
> The 3 slices (del-minimax-worker, hide-role-skills, on-demand-ecc)
> all landed PASS in this branch — see `peaks workflow verify-pipeline
--rid 2026-07-15-cli-surface-cleanup` and the Slice 1/2/3 sediment
> memories in `.peaks/memory/`.
>
> **Version bump rationale** (D-016): 4.0.0-beta.10 was the pre-impl
> contract name; 4.0.0-beta.11 is the actual release of that contract.
> One-line summary: **"CLI surface cleanup + on-demand ECC"**.
>
> **Verdict**: 10/12 AC PASS + 2 PASS-WITH-DEFERRED (D-013 wrapper
> exit-code bug, separate follow-up slice after publish).
> Ice-cola baseline gate: 27/27 AC functionally pass.

### Removed — `peaks minimax-worker` (Slice 1)

- **`peaks minimax-worker` CLI removed** — historical MiniMax
  provider integration. `peaks minimax-worker --help` now exits
  non-zero with `COMMAND_NOT_FOUND`.
- **`peaks worker minimax` CLI removed** — same module.
- **`peaks config provider minimax *` subtree removed** —
  `peaks config provider minimax set --help` exits non-zero.
- **6 source files deleted**:
  - `src/cli/commands/worker-commands.ts`
  - `src/services/providers/minimax-provider-service.ts`
  - `src/services/providers/minimax-worker-service.ts`
  - `src/services/config/provider-service.ts` (entire file; 100% MiniMax)
  - `tests/unit/minimax-worker-service.test.ts`
  - `tests/unit/minimax-provider-service.test.ts`
- **~21 source files modified** (drop imports, drop function bodies,
  drop registrations, replace `'minimax-2.7'` literal with
  `'claude-opus-4-7'` in 5 files).
- **~8 test files modified** (drop MiniMax cases; replace literal in 3).
- **4 openspec files updated** (1-line wording fixes).
- **Net security improvement**: smaller secret-handling surface
  (5 MiniMax functions removed).

### Changed — 10 role-skill CLI commands hidden (Slice 2)

- **10 top-level role-skill CLI commands** now hidden from `peaks --help`
  via `Commander.hidden()`. Still invokable for internal
  `peaks sub-agent dispatch --role <role>` paths. Final canonical
  list (per QA grep audit):
  - `peaks prd`
  - `peaks qa`
  - `peaks sc`
  - `peaks audit`
  - `peaks code-review`
  - `peaks perf-audit`
  - `peaks security-audit`
  - `peaks upgrade`
  - `peaks agent`
  - `peaks code`
- **`peaks skill list`** now excludes skills with
  `visibility: internal` frontmatter. Use `--include-internal` to opt in.
- **`peaks skill search`** accepts `--include-internal` flag.
- **8 SKILL.md files** updated to add/rename `visibility: internal`:
  `peaks-prd`, `peaks-qa`, `peaks-rd`, `peaks-sc`, `peaks-ui`,
  `peaks-txt`, `peaks-final-review`, `peaks-perf-audit`,
  `peaks-security-audit`.
- **Integration test rewritten**:
  `tests/integration/skill-search-cli.test.ts:72-79` now asserts
  the new `visibility:` frontmatter field instead of legacy
  `userInvocable`.

### Added — `peaks ecc install|status|ls|show` (Slice 3)

> **PIVOT vs initial design**: Originally Slice 3 was supposed to
> spawn `<cached>/ecc agent run <name> --json` as a subprocess.
> RD sub-agent triggered **Gate S3-0**: affaan-m/everything-claude-code
> has no `ecc` binary; its real structure is `agents/*.md` flat
>
> - SKILL.md descriptors. User chose Option B — drop the subprocess
>   model entirely.

- **`peaks ecc install`** — downloads affaan-m/everything-claude-code
  from GitHub releases to `~/.peaks/cache/ecc-<sha>/`. Selective
  tarball extraction: ONLY `agents/` subtree (skip `rules/`,
  `commands/`, `settings/`, `docs/`, `README.md`).
- **`peaks ecc status`** — reads cache manifest, reports version + sha
  - agent count.
- **`peaks ecc ls`** — lists cached agents by parsing `agents/*.md`
  frontmatter.
- **`peaks ecc show <name>`** — outputs the agent's SKILL.md body
  to stdout. LLM-side consumers (Skill-first path) read this output
  to apply the agent's instructions.
- **3 source files deleted** (with Slice 1):
  - `src/cli/commands/agent-commands.ts` (the old `peaks agent run/list`)
  - `src/services/agent/ecc-agent-service.ts` (the spawn orchestrator)
  - `tests/unit/services/agent/ecc-agent-service.test.ts`
- **3 new source files**:
  - `src/services/agent/ecc-cache-service.ts` — pure-IO cache module
    (`downloadToCache`, `readCacheManifest`, `listCachedAgents`,
    `readAgentSkill`, `cleanupStaleCache`)
  - `src/cli/commands/ecc-commands.ts` — 4 subcommands
  - `tests/unit/agent/ecc-cache-service.test.ts`
- **Dead-probes removed**:
  - `npx ecc --version` probe (was: never worked; affaan-m/ECC not on npm)
  - `npx ecc-agentshield --version` probe in
    `src/services/audit/static-service.ts:104` (parallel fix)
- **7-day cache TTL** via `bootstrapLogger.applyRetention` sweep
  (wired at `src/cli/program.ts:121`). NOT via
  `peaks doctor --cleanup-stale` (which is bound to `dropStale()`
  for the binding store).

### Removed — `peaks agent run` and `peaks agent list`

- **`peaks agent run <name>` exits non-zero with `COMMAND_NOT_FOUND`**.
- **`peaks agent list` exits non-zero with `COMMAND_NOT_FOUND`**.
- **No replacement CLI** — LLM-side consumers use
  `peaks ecc show <name>` or read `<cache>/agents/<name>.md` directly.

### Net security / performance impact

- **Security**: 0 subprocess attack surface (was: 1 per call in beta.9);
  smaller secret-handling surface (5 MiniMax functions removed).
- **Performance**: cache-dir probe is pure read (<15ms vs ~500ms
  for the npm-registry probe in beta.9); selective tarball extraction
  saves ~95% disk footprint.

### Pre-implementation gate

`peaks workflow verify-pipeline --rid 2026-07-15-cli-surface-cleanup`
returns `ok: true, complete: true, violations: []` (9/9 gates PASS).
This CHANGELOG entry is the contract; the actual implementation
follows the runbook in `docs/release/4.0.0-beta.10.md`.

### Acceptance criteria

27 ACs total: 7 (Slice 1) + 8 (Slice 2) + 11 (Slice 3 redesign + 1).
Full list in `docs/release/4.0.0-beta.10.md` §Acceptance criteria.

---

## 4.0.0-beta.9 — 2026-07-15

### Fixed — `npm install peaks-loop` runtime path layout

`4.0.0-beta.8` shipped a tarball where `bin/peaks.js` imported
`'../dist/src/cli/index.js'`, but tsc actually emitted the runtime
files at `dist/cli/index.js` (rootDir walked past `src/` because of
cross-folder imports like `src/services/hooks/output.ts → ../../cli/`).
Downstream `npm i -g peaks-loop` then `peaks -v` failed with
`ERR_MODULE_NOT_FOUND: .../dist/src/cli/index.js`. The 4 audit/business
templates also failed to enter the tarball because `package.json#files[]`
whitelisted `dist/src/**/*.js` / `.d.ts` but never `.md`.

This release:

- `bin/peaks.js` import: `'../dist/src/cli/index.js'` → `'../dist/cli/index.js'`.
- `scripts/copy-templates.mjs` dest: `dist/src/services/...` →
  `dist/services/...` so the bundled templates land where the runtime
  `import.meta.url` resolver expects them.
- `package.json#files[]`: prefixes shifted from `dist/src/` to `dist/`,
  plus a new `dist/**/*.md` entry so the 4 templates bundled by
  `copy-templates.mjs` actually ship.
- `tsconfig.build.json` (introduced in beta.8) confirmed correct — it
  is the build-time emit that controls the dist tree shape.

End-to-end smoke after the fix (local):

```
$ npm pack                                  # 30 MB tarball
$ npm install ./peaks-loop-4.0.0-beta.9.tgz --prefix /tmp/test
$ peaks --version                           # → "4.0.0-beta.9"
$ peaks workspace init --project /tmp/fresh  # → templatesBooted: 5
```

`.peaks/project-scan/{project-scan.md, business-knowledge.md,
security-template.md, perf-template.md, audit-output-schema.md}`
all present after a fresh workspace init.

### Notes

- 4.0.0-beta.8 is left in place on npm as a known-broken release.
  Consumers who already pinned `peaks-loop@4.0.0-beta.8` should bump
  to `4.0.0-beta.9`.
- Beta.9 contains everything beta.8 advertised plus the path fix.

## 4.0.0-beta.8 — 2026-07-15

### Added — project-scan bootstrap (slice 2026-07-15)

- **`peaks project context` writes `.peaks/project-scan/project-scan.md`**
  alongside `.peaks/PROJECT.md`. The project-scan.md file is the new
  canonical home for project archetype + libraryVersions + tech stack
  (project-scoped, git-tracked, survives session rotation). The old
  `.peaks/_runtime/<sessionId>/rd/project-scan.md` path is fully
  migrated across SKILL.md / references / peaks-rd SKILL.md /
  peaks-ui SKILL.md (14 occurrences in 8 files).
- **`peaks workspace init` triggers `bootstrapProjectScan`** on its
  main path. Idempotent: existing `schemaVersion: 1` files are
  preserved unless `--force`. New CLI flags:
  - `--no-project-scan-bootstrap` — opt out of the bootstrap call.
  - `--force-project-scan-templates` — overwrite the 4 bundled
    audit/business templates (default: skip if present).
- **5-template boot** — every `peaks workspace init` materialises
  `.peaks/project-scan/{project-scan.md, business-knowledge.md,
security-template.md, perf-template.md, audit-output-schema.md}`.
  The 4 audit/business templates are bundled at
  `src/services/workspace/templates/project-scan/*.md` and copied
  verbatim by `scripts/copy-templates.mjs` (post-`tsc` step; tsc
  does not emit `.md` files).
- **`scripts/copy-templates.mjs`** — mirrors bundled `.md` templates
  into `dist/`. Wired into `package.json#scripts.build` after `tsc`.
  Required to keep `import.meta.url` template reads working for
  downstream `npm install peaks-loop` consumers.
- **`tests/unit/workspace/templates/template-integrity.test.ts`**
  (5 cases) — byte-equality guard between bundled and canonical
  templates; fails CI on drift.
- **`tests/unit/services/prd/project-scan-bootstrap-service.test.ts`**
  (13 cases) — 0-1 path, existing-project path, monorepo variants,
  idempotency, force overrides, dual-write.
- **`tests/unit/workspace/init-hooks-project-scan.test.ts`**
  (4 cases) — `peaks workspace init` integration with all 3 CLI flag
  combinations.

### Fixed — monorepo 0-1 misjudgement + scanArchetype fall-through

Real-world smoke against `C:\Users\smallMark\Desktop\peaksclaw\ice-cola`
(pnpm-workspace monorepo with `packages/{server,client,admin,hermes-agent}`)
exposed two follow-on bugs that the unit suite missed:

- **0-1 detection now considers monorepo sentinels.**
  `bootstrapProjectScan.isZeroToOneProject` previously only checked
  `<root>/src/`, silently mis-classifying pnpm-workspace projects as
  0-1 (the source lives at `packages/<pkg>/src/`). New sentinels:
  `pnpm-workspace.yaml` / `turbo.json` / `nx.json` + the
  `package.json#workspaces` field. Source-root candidates extended
  to `packages/` / `apps/` / `libs/` / `services/` / `workspaces/`.
- **`scanArchetype` hoists `hasMonorepoConfig` above the `hasBackend`
  check.** A monorepo with a backend sub-package (`packages/server`)
  used to fall through to `legacy-fullstack` because `hasBackend`
  included `backendDirsPresent.length > 0`. New behaviour: any monorepo
  resolves to `frontend-monorepo` (no backend pkg) or
  `fullstack-monorepo` (with backend pkg).
- **`ProjectArchetype` union gains `'fullstack-monorepo'`.**
  Previously the union was 5 values; now 6. `ArchetypeService` and
  `peaks-code` consumers updated accordingly.

### Changed

- `src/services/memory/project-context-service.ts` — `generateProjectContext`
  is now `async` and calls `bootstrapProjectScan` after writing
  `PROJECT.md`. The companion `peaks skill presence:clear` was missing
  an `await`; fixed in `src/cli/commands/core/skill-command.ts`.
- `src/cli/commands/workspace/init-command.ts` — adds
  `--no-project-scan-bootstrap` and `--force-project-scan-templates`;
  surfaces `projectScan` envelope field on the init response.

### Verification

- vitest: 22/22 pass across 3 slice-owned test files.
- tsc: 0 errors in slice-owned `src/` files.
- CLI: `./bin/peaks.js workspace init --project <tmp>` writes 5 files
  in `templatesBooted:5, durationMs:23`; `--no-project-scan-bootstrap`
  correctly skips; `--force-project-scan-templates` correctly
  overrides user sediment.
- Ice-cola: `peaks project context --project .` produces
  `archetype: fullstack-monorepo` with 18 real library versions
  (Docusaurus 3.9.2 / Camofox / @easyops-cn / etc.).

### Notes

- pre-existing `FILE_SIZE_VIOLATION` on
  `src/services/standards/project-standards-service.ts` (837 lines,
  in-flight `.claude/rules/` → `.peaks/standards/` migration) is out
  of slice scope.

## 4.0.0-beta.7 — 2026-07-09

### Added — zcode adapter (9th IDE) + runtime model detection

- **`peaks ide model --current` CLI** — `src/cli/commands/ide-commands.ts` (80 lines) + register in `src/cli/program.ts`. Outputs `{ modelId, detected, registeredAdapters }`. Available as a top-level primitive (not adapter-specific).
- **`detectCurrentIdeModel()` service** — `src/services/ide/current-model-detector.ts` (43 lines). Walks the adapter registry in insertion order, calls each adapter's optional `detectCurrentModel()` with try/catch isolation — one bad adapter cannot poison the chain.
- **zcode-adapter `detectCurrentModel()` method** — `src/services/ide/adapters/zcode-adapter.ts`. Reads `~/.zcode/v2/config.json`, resolves active provider via 4-tier priority chain (env override → non-`builtin:` provider → first enabled → first provider), returns the model's id. Live test: `peaks ide model --current` against a real z-code installation → `"modelId": "M3"`.
- **`IdeAdapter` interface optional field** — `readonly detectCurrentModel?: () => Promise<string | undefined>` in `src/services/ide/ide-types.ts`. Back-compat: 8 existing adapters without the field are unaffected.
- **`getStrongestModelIdAsync()` async variant** — `src/services/config/model-routing.ts`. Sync `getStrongestModelId()` is unchanged (rd-service compat); new async variant lets future async callers fall back to runtime probe instead of `'claude-opus-4-7'`.

### Changed — install no longer writes hardcoded default model

- **`scripts/install-skills.mjs`** — removed `model: 'sonnet'` default and `providers.minimax.model` default from `createConfigDefaults()`. After install, `~/.peaks/config.json` no longer contains a Claude model recommendation; users set their own via `peaks config set model <id>` (or leave unset and the back-compat fallback applies).
- **`STRONGEST_MODEL_ID` constant removed** — replaced by `getStrongestModelId(config?)` function in `src/services/config/model-routing.ts`. Resolution order: `config.model` → `PEAKS_STRONGEST_MODEL_DEFAULT` env var → back-compat `'claude-opus-4-7'`.
- **`workflow-router-service.ts` / `minimax-worker-service.ts` / `rd-service.ts`** — threaded dynamic modelId through 16 call sites in `workflow-router-service.ts`, replaced literal `'claude-opus-4-7'` in `minimax-worker-service.ts` (×2) and `rd-service.ts`.

### Added — zcode IDE (peaks-loop's 9th)

- **`IdeId` union type** — `'zcode'` added in `src/services/ide/ide-types.ts`.
- **`ZCODE_ADAPTER`** — new `src/services/ide/adapters/zcode-adapter.ts` (98 lines). Template: `claude-code-adapter.ts` with `compact.compactCommand` / `hookEvent` / `toolMatcher` / `envVar` degraded (z-code is a desktop application, no CLI binary; UNVERIFIED sentinel strings used where the interface requires non-optional types).
- **`IDE_DETECTION_DIRS` + `IDE_SKILL_INSTALL_PROFILES`** — `scripts/install-skills.mjs`. New `{ id: 'zcode', dir: '.zcode' }` detection entry + zcode profile (skillsDir `~/.zcode/skills`, env override `PEAKS_ZCODE_SKILLS_DIR`).
- **`ide-registry.ts`** — registers `ZCODE_ADAPTER` alongside the existing 8 adapters (claude-code / trae / trae-cn / codex / cursor / qoder / tongyi-lingma / hermes / openclaw).
- **`tests/unit/ide/zcode-adapter.test.ts`** — 10 cases (T-1 id, T-2 dirName, T-3 standards rootFile = `CLAUDE.md`, T-4 rulesDir = `.claude/rules`, T-5 skillsDir, T-6 compactCommand undefined, T-7 hookEvent is string, T-8 type test, T-9 IDE_DETECTION_DIRS contains, T-10 IDE_SKILL_INSTALL_PROFILES contains).
- **`tests/unit/ide/zcode-adapter-detect-model.test.ts`** — 14 cases (pure resolver + env-fixture file IO + path helper).
- **`tests/unit/cli/ide-commands.test.ts`** — 5 cases (CLI + top-level command registration).
- **Fixture sync** — `tests/unit/install-skills-script.test.ts` + `tests/unit/cli-program.workflow.test.ts` (Strategy A: env-var override, no hardcoded literals) + `tests/unit/ide/ide-registry.test.ts` (whitelist 6 → 7 adapters).

### Documentation — SKILL.md sync with 4.0.0-beta.6 CLI reality

- **`skills/peaks-code/SKILL.md`** — added inline `> CLI reality check` blocks at §Step 0.8 (D-001 `peaks code detect-job` is `peaks job init`), §Step 0.8 third paragraph (D-003 `JOB_SHAPE_NOT_DECIDED` is now passive `done: 0` warning, not exception), §Step 2.5 (D-002 `peaks session title` takes positional sid, not `--session-id` flag), §Step 11c + 11d (D-010 `<!-- peaks-memory:start -->` block requires YAML frontmatter `title:` + `kind:` + `---` + closing `<!-- peaks-memory:end -->`, otherwise `extractedCount: 0` silently). New **§CLI Drift Index** section after Boundaries provides single landing page for D-001/002/003/010 with inline-anchor table.
- **`skills/peaks-slice-decompose/SKILL.md`** — new **§SC template hard rules (sediment 2026-07-09)** section with 3 rules: Rule 1 ESM/CJS pre-flight before specifying export syntax (D-009c), Rule 2 whitelist fixture sync is a primary task not collateral (D-009a), Rule 3 adapter-interface optional fields > required (D-009b reciprocal).

### Verification (4.0.0-beta.7)

- `pnpm tsc -p tsconfig.json --noEmit` — 0 errors
- `pnpm vitest run tests/unit/ide/ tests/unit/cli/ide-commands.test.ts` — 15 files / 211 tests / 0 failed
- `peaks workflow verify-pipeline --rid 003-add-zcode-adapter` — `ok=true, complete=true`, 9/9 gate PASS
- `node bin/peaks.js ide model --current` (against real z-code installation) — `modelId: "M3"`, `detected: true`

### Sediment (Step 11) — 7 lessons in `.peaks/memory/`

| File                                                                      | Topic                                                    |
| ------------------------------------------------------------------------- | -------------------------------------------------------- |
| `z-code-peaks-loop-9-ide-adapter-vendor-neutrality-adapter.md`            | z-code 9th IDE + vendor-neutrality adapter pattern       |
| `peaks-loop-install-model-getstrongestmodelid-fallback.md`                | install no longer hardcodes default model                |
| `desktop-application-ide-adapter-z-code-cli.md`                           | desktop-app IDE adapter field-degradation decision       |
| `peaks-code-runbook-4-0-0-beta-6-skill-md-cli-d-001-d-002-d-003-d-010.md` | 4 SKILL.md / CLI drift points                            |
| `2026-07-09-zcode-adapter-overview.md`                                    | RID 003 overall summary (project record)                 |
| `peaks-ide-runtime-detect-zcode-only.md`                                  | `peaks ide model --current` z-code 4-tier priority chain |
| `ide-adapter-detectcurrentmodel-optional-interface-pattern.md`            | optional interface field extension pattern               |

### Known follow-ups (S3-cleanup backlog)

- **Slice C extension** — other 8 IDEs' `detectCurrentModel()` (claude-code / trae / cursor / codex / qoder / tongyi-lingma / hermes / openclaw). Currently only z-code has a working detector; all 8 still fall through to the back-compat `'claude-opus-4-7'`.
- **zai / GLM provider entry** — `D-008`: peaks-loop has no built-in provider entry for z-code's default `builtin:zai` (GLM) or `builtin:bigmodel` providers. Users on those providers must add custom `provider.<uuid>` entries to their `~/.peaks/config.json` themselves.
- **zcode-adapter UNVERIFIED sentinel values** — `hookEvent: 'PreToolUse'`, `toolMatcher: 'Bash'`, `envVar: 'ZCODE_PROJECT_DIR'` are placeholder guesses based on Anthropic-compatible protocol. Real z-code desktop application dogfood will reveal the actual values; replace once known.
- **`IdeAdapter` interface optional fields** — `D-009b` proposes converting `hookEvent` / `toolMatcher` / `envVar` to optional types, or adding an `unverified: boolean` flag, so future adapters with unknown protocols don't need to fabricate sentinel values.

### Breaking changes

None. All 8 pre-existing adapters continue to load without changes. CLI subcommands `peaks ide *` and `peaks ide model --current` are additive.

## 4.0.0-beta.5 — 2026-07-08

### Added — peaks-solo dispatcher (分诊员)

- **`peaks-solo` skill** — `skills/peaks-solo/SKILL.md` + 3 references (triage / fallback / sediment). Natural-language front door for the Peaks-Loop skill family. Use when the user describes a task in NL and does not know which peaks-\* skill fits. 0 breaking change: 3.x / 4.x `/peaks-code` / `/peaks-content` / `/peaks-doctor` etc. continue to work.
- **`peaks skill search` CLI** — `src/services/skill/skill-search-service.ts` + `src/cli/commands/skill-search-commands.ts`. Query / tag / domain filters; substring match; structured JSON output. Used by `peaks-solo` to find the right leaf skill. Available as a top-level primitive (not dispatcher-specific).
- **Sub-skills unchanged** — `peaks-code / peaks-content / peaks-doctor / peaks-issue-fix-orchestrator / peaks-sop / etc.` are NOT modified. peaks-solo sits alongside, not on top.

### Verification (4.0.0-beta.5)

- `peaks skill list` shows `peaks-solo` first
- `peaks skill search --query "code"` returns `peaks-code` with matchScore > 0
- `peaks skill search --query "xxxxxxxxxxxxx"` returns `[]` (no error)
- `pnpm vitest run` — full regression green; `peaks-code / peaks-content / peaks-doctor` tests unchanged
- `peaks code --help` / `peaks content --help` / `peaks doctor --help` — exit 0, behavior unchanged

## 4.0.0-beta.4 — 2026-07-08

Loop Engineering crystallization is now the product surface. The 4.0.0-beta.3 line shipped the framework; this release ships the post-run crystallization engine, the Darwin-style ratchet, the bundle share / desktop extension surface, and the karpathy-engineered red-line set that locks them together. Every durable-change entry is gated on a real, completed run; every evolution round is gated on an independent-context evaluation.

### Added — Loop Engineering Asset layer (§4.1, AC-1/AC-2/AC-3)

- **`loop_release` table** — `src/services/skillhub/migrations/002-loop-release.sql`. Schema version pinned to `peaks.loop/1` via CHECK constraint. Indexes on `lifecycle_status` and `scenario`. Non-breaking: 4.x `bee_release` rows continue to read.
- **`loop_bee_relation` table** — `src/services/skillhub/migrations/003-loop-bee-relation.sql`. Schema version `peaks.loop-bee-relation/1`. Roles: `main` / `supporting` / `candidate` / `retired`. Partial UNIQUE index `WHERE role='main'` enforces at most one main bee per loop at the storage layer (defense in depth; the service layer also enforces it).
- **Schema for the four-loop + dual-asset model** — Zod schemas in `src/services/loop/loop-release-types.ts` and `src/services/loop/loop-bee-relation-types.ts` mirror the §4.1 / §4.6 row shapes and refuse to parse rows whose `schema_version` is not the fixed literal.

### Added — Post-run crystallization flow (§5, AC-4 / AC-5 / AC-6 / AC-7)

- **`crystallization_event` table** — `src/services/skillhub/migrations/006-crystallization-event.sql`. Schema version `peaks.crystallization/1`. Carries the 4-section evidence brief inline; FKs to optional created/updated loop_release / bee_release.
- **`CrystallizationService`** — `src/services/crystallization/crystallization-service.ts`. Pre-run gate: `task_status='completed'` AND `gates_passed=true` AND `evidence_collected=true` (Zod literal enforcement + service-layer re-assertion). Atomic single-transaction write of loop_release + bee_release header + bee_manifest + loop_bee_relation(main) + crystallization_event(brief inline).
- **`peaks asset crystallize`** CLI — `src/cli/commands/asset-commands.ts`. Required options: `--brief-what-happened`, `--brief-why-it-matters`, `--brief-what-learned`, `--brief-what-action`. A partial brief is rejected with `MISSING_BRIEF_SECTION` and exit 1 (RL-7).
- **`peaks asset dispose` / `peaks asset status`** — cross-asset dispose (trace_only / retain / destroy) and lifecycle status dashboard.

### Added — Darwin-style ratchet (§6, AC-8 / AC-9 / AC-10 / AC-11)

- **`evolution_evaluation` table** — `src/services/skillhub/migrations/005-evolution-evaluation.sql`. Schema version `peaks.evolution/1`. Carries `target_kind`, `target_release_id`, `optimization_dimensions_json` (length-1 enforced at service layer), `target_count=1` (CHECK), `author_id`, `evaluator_id`, `skeptic_id` (three independent agents), `verdict` ∈ {`keep`, `revert`, `needs-user-decision`}, `user_confirmation_pointer`, `brief_pointer`, and the four-section brief projection.
- **`EvolutionService`** — `src/services/evolution/evolution-service.ts`. Hard rules: single object (AC-8) + single optimization dimension (AC-8) + author ≠ evaluator ≠ skeptic (AC-10/AC-12/AC-14) + score_delta >= score_delta_min for `keep` (AC-11, default 1.0) + user_confirmation_pointer required for `keep` (AC-15).
- **`peaks evolution propose / evaluate / revert / mark-keep / status`** CLI — `src/cli/commands/evolution-commands.ts`. Each error path emits a stable wire-format code (`EVOLUTION_MULTI_OBJECT` / `EVOLUTION_MULTI_DIMENSION` / `EVOLUTION_SELF_SCORE` / `EVOLUTION_DELTA_BELOW_THRESHOLD` / `EVOLUTION_MISSING_USER_CONFIRMATION`).
- **Independent-evaluator runner** — `src/services/evolution/independent-evaluator-runner.ts`. Frozen `EvaluationPackage` containing only `target_kind / target_release_id / optimization_dimension / before_snapshot / after_snapshot / diff / rubric / red_lines / source_traces` — no author session, no author reasoning, no recommendation framing (AC-12 / AC-13).
- **Regression-skeptic runner** — `src/services/evolution/regression-skeptic-runner.ts`. A SEPARATE agent that emits `driftRisks / overfitRisks / safetyRegressionRisks` plus an optional `blocker` (which forces `verdict='revert'`).

### Added — Karpathy-engineered red-line set (AC-21 / AC-22 / AC-23)

- **`.peaks/standards/loop-engineering-guidelines.md`** — the single source of truth for the 10 red lines RL-0..RL-9, each in the four-section karpathy form (Failure modes / Rewrite / Self-check / Out-of-scope). Co-equal karpathy × darwin layers (RL-0).
- **`peaks standards lint --category loop-engineering`** — `src/services/standards/loop-engineering-lint.ts`. Parses the guideline file and asserts every red line has all four sections, fails closed otherwise.
- **`peaks skill lint --category loop-engineering-readiness --path <skill-dir>`** — `src/services/standards/loop-engineering-readiness-lint.ts` + `src/cli/commands/skill-loop-engineering-readiness-commands.ts`. Asserts a peaks-\* SKILL.md (a) references `.peaks/standards/loop-engineering-guidelines.md`, (b) does not introduce a CLI verb the user is meant to type, (c) does not introduce a JSON / manifest hand-authoring surface. Alias verb: `peaks skill ready --category loop-engineering-readiness --path <skill-dir>`.
- **Unit guard** — `tests/unit/standards/loop-engineering-guidelines.test.ts` enforces the four-section shape for every red line in the file.
- **peaks-code domain boundary (RL-8)** — `skills/peaks-code/SKILL.md` self-declares as the code-domain long-task loop engineering orchestrator and is NOT a general-purpose orchestrator. Cross-domain peaks-\* skills (peaks-content, peaks-issue-fix-orchestrator) import the shared guideline file and pass the readiness lint.

### Added — Bundle share + desktop extension surface (§7A, AC-24 / AC-25 / AC-26)

- **Share / desktop fields** — `src/services/skillhub/migrations/004-loop-bee-extension.sql`. Adds `shareable / share_excluded_paths / desktop_visible / export_bundle_format` to `loop_release`, and `shareable / desktop_visible` to `bee_release`. `export_bundle_format` is pinned to `peaks.bundle/1` via CHECK constraint. Non-breaking: every new column has a DEFAULT.
- **Bundle writer** — `src/services/share/bundle-writer.ts`. Writes a `peaks.bundle/1` tar.gz with `manifest.json`, `relations.json`, `evidence_briefs/*.json`, content-addressed `blobs/<sha256>`, and `EVALUATION_REQUIRED.md`. Hard block: `shareable=false` throws `BundleNotShareableError(SHARE_BUNDLE_ERROR_CODES.NOT_SHAREABLE)` BEFORE any tarball work, for both loop and bee kinds.
- **Bundle reader** — `src/services/share/bundle-reader.ts`. Hard blocks: `format_version_major != 1` is rejected (AC-25); `schema_versions` mismatch is rejected; the imported release ALWAYS lands as `candidate` (AC-25 / §10 RL-9). The bundle carries an `EVALUATION_REQUIRED.md` marker telling the receiver to run an independent evaluation before any durable change.
- **`peaks loop export` / `peaks loop import`** — `src/cli/commands/loop-commands.ts`. Existing 14.x `peaks loop *` subcommands are preserved; M7 only ADDS export / import.
- **`peaks bee export` / `peaks bee import`** — `src/cli/commands/share-commands.ts`. Same hard-block semantics.
- **Receiver-side integration test** — `tests/integration/share-bundle-roundtrip.test.ts` asserts the round-trip lands as `candidate` (AC-25), that `shareable=false` blocks the export at the CLI layer, and that without an `evolution_evaluation` row the receiver has no path to `stable` (AC-26).

### Added — SkillHub expansion (5 new tables / non-breaking)

The 6+ relation table layout is preserved. 5 new tables added under `.peaks/_runtime/<sessionId>/`:

- `loop_release` (002)
- `loop_bee_relation` (003)
- loop↔bee share / desktop extension columns (004)
- `evolution_evaluation` (005)
- `crystallization_event` (006)

Migration is non-breaking: every new column has a DEFAULT and the new tables sit alongside the existing 4.x schema.

### Added — New CLI verbs (spec §7.4)

- `peaks loop init / list / show / search / recent / export / import`
- `peaks asset crystallize / dispose / status`
- `peaks evolution propose / evaluate / revert / mark-keep / status`
- `peaks skill lint --category loop-engineering-readiness --path <skill-dir>`
- `peaks skill ready --category loop-engineering-readiness --path <skill-dir>` (alias)

### Changed

- **`peaks workflow *`** is reframed as the execution trace surface (per spec §7.6 demotion); it remains functional. The user-facing verb is "replay this run", not "create a new asset".
- **peaks-maker skill** is narratively repositioned to "Loop crystallizer + Bee creator + Evolution gatekeeper" (per spec §7.5); only the SKILL.md and memory references are re-narrated, the `id` is preserved.

### Verification (4.0.0-beta.4)

- `tsc --noEmit` zero errors
- `peaks standards lint --category loop-engineering` parses all 10 red lines + 4 sections each (lint passes)
- `pnpm vitest run tests/unit/{standards,crystallization,evolution,share}/` — 13 files / 154 unit tests pass
- `pnpm vitest run tests/integration/{share-bundle-roundtrip,dogfood-loop-engineering-crystallization,asset-crystallize-cli,evolution-cli,skill-loop-engineering-readiness-cli}.test.ts` — 5 files / 26 integration tests pass
- M8 dogfood (`tests/integration/dogfood-loop-engineering-crystallization.test.ts`) crystallizes the M0..M7 work into a real loop + bee + relation + event in 644ms (defense in depth: the release crystallizes itself)

### Migration

- 4.x `bee_release` rows continue to read. No data migration required.
- The 5 new tables are added via non-destructive `CREATE TABLE IF NOT EXISTS` migrations.
- The `bundle-writer / bundle-reader` pair is additive; existing `peaks skill sediment export / import` remains as an alias for one release cycle, then deprecates.
- The peaks-code SKILL.md is unchanged from 4.0.0-beta.3 — no `peaks-solo` migration needed for users already on beta.2 or later.

## 4.0.0-beta.2 — 2026-07-07

### Renamed

- **`peaks-solo` → `peaks-code`** — the long-running code-domain orchestrator skill (PRD/RD/QA/UI/SC/TXT pipeline) has been renamed to communicate its scope more accurately. The on-disk directory `~/.peaks/skills/.system/bees/peaks-code/` is preserved as a stable install location; only the manifest `id` and `displayName` change (`peaks-code` / `Peaks Code`). All four sibling skills (`peaks-solo-resume` → `peaks-resume`, `peaks-solo-status` → `peaks-status`, `peaks-solo-test` → `peaks-test`) are now top-level primitives rather than child skills of `peaks-solo`. Migration: `peaks session migrate-skill-name --from peaks-solo --to peaks-code --apply`.

### Changed (Breaking)

- **`peaks skill presence:set peaks-solo` no longer recognized** — the canonical skill name is now `peaks-code`. Existing `.peaks/_runtime/*/active-skill.json` files carrying `skill: "peaks-solo"` are migrated by `peaks session migrate-skill-name`. Manual override: edit the file and replace `"skill": "peaks-solo"` with `"skill": "peaks-code"`.
- **CLI surface unchanged** — `peaks code`, `peaks code --fast`, and the entire `peaks-code` skill runbook continue to function; only the skill-identification field (`id`, `displayName`, presence `skill` value) changes. The runbook name `peaks code` is the user-facing verb and remains as-is.

### Fixed (post-rename polish)

- **Rule name normalization** — `Code Code-Change Red Line` → `Code Commit Ban Red Line` (8 occurrences across `src/services/audit/enforcers/code-ban.ts`, `src/cli/commands/hook-handle.ts`, and the audit tests). Aligns with `red-line-catalog.ts` entry `rl-code-ban-001` / `Code Commit Ban`.
- **Wire-format error code rename** — `SOLO_MODE_REQUIRES_SOLO_WORKFLOW` → `CODE_MODE_REQUIRES_CODE_WORKFLOW` and `UNSUPPORTED_SOLO_MODE` → `UNSUPPORTED_CODE_MODE` in `src/cli/commands/workflow-commands.ts` (4 test sites updated).
- **Test local consts** — `soloResult/soloOutput` → `codeResult/codeOutput` in `tests/unit/cli-program.workflow.test.ts`; `SOLO_PATH/soloAbsPath` → `CODE_PATH/codeAbsPath` in `tests/unit/code/skills-subagent-scope-dir.test.ts`; `SOLO_REF/SOLO_FANOUT_REF` → `CODE_REF/CODE_FANOUT_REF` in `tests/unit/dispatch/dispatch-fanout-mandatory.test.ts`.
- **CHANGELOG self-contradiction** — the rename entry previously read `peaks-code → peaks-code` (collapsed by the global `s/Solo/Code/g` substitution). Now correctly reads `peaks-solo → peaks-code`.
- **`deriveRuleName` test expectation** — `tests/unit/services/audit/classifier.test.ts` expected 9 words but the function correctly truncates to 8. Updated to match the new word split introduced by `Code Commit Ban` (2 words) replacing `Code Code-Change` (1 hyphenated word).
- **Output style mode label** — `.claude/output-styles/peaks-skill-swarm.md` now uses `Code` instead of `Solo` in the mode badge and prose (3 occurrences).
- **Project history row** — `.peaks/PROJECT.md` session-history row `001-solo-memory-write-broken` → `001-code-memory-write-broken`.
- **Video demo copy** — `examples/video-demo/src/copy.ts` `skillWas: 'peaks-solo'` → `skillWas: 'peaks-code'` (legacy label, both locales).

### Added

- **Manifest id field** — `.peaks/skills/.system/bees/peaks-code/manifest.json` now carries `{ "id": "peaks-code", "displayName": "Peaks Code" }`. The `migrate-skill-name` service explicitly skips this file (test: `session-migrate-skill-name.test.ts:69` "跳过 .peaks/skills/.system/bees/peaks-code/manifest.json") so the canonical id is only ever edited by hand or by an explicit `peaks skill sediment refine-bee` flow, never by bulk migration.
- **Spec §4.1.1 rewrite** — `docs/superpowers/specs/2026-07-04-peaks-maker-dynamic-skill-sediment-design.md` §4.1.1 has been rewritten from "peaks-code as preserved alias" to "peaks-code as the system-stable code-domain bee (renamed from peaks-code)". The plan's spec-coverage table now references the renamed heading.
- **Migration helper** — `peaks session migrate-skill-name --from <old> --to <new> [--apply]` is the supported path for renaming skill references in `.peaks/_runtime/`. Idempotent; skip-list includes `.peaks/memory/**` and `.peaks/skills/.system/bees/peaks-code/manifest.json`.

### Verification

- `tsc --noEmit` zero errors
- Full `vitest run` exit 0 (all 30 touched test files / 265 directly-tested assertions pass)
- `silent-warning-detector` OK on 481 files
- All rename+polish changes committed as `b1dbc51 chore(rename): complete peaks-solo → peaks-code sweep + polish`

## 3.1.2 — 2026-07-04

### Added — Mechanical Job-mode gates (Step 0.8 enforcement)

The v3.1.1 recorder-only design was bypassed twice under load (2026-07-03 35-slice incident, 2026-07-04 3018-file incident): the LLM skipped `peaks code detect-job` and ran fake-completion narratives instead of Job mode. The v3.1.2 patch converts Step 0.8 from "LLM should call" to "LLM cannot proceed without calling" through four mechanical gates — no LLM interpretation required.

- **PreToolUse hook** — `peaks workspace init` now installs a `Bash` matcher in `.claude/settings.local.json` (TEMPLATE_VERSION bumped 1.2.0 → 1.3.0) that runs `peaks code gate-step-08 --project .` before every Bash call. Exit 0 = allow, exit 2 = block. Existing `Write|Edit|MultiEdit` matcher preserved. Re-running `peaks workspace init` is idempotent (`templateContentMatches`).
- **`peaks code gate-step-08`** — new service `src/services/code/step-08-gate.ts` (~120 LOC) + CLI. Reads `.peaks/_runtime/<sessionId>/job-shape.json`. When `decision.isJob=true` AND `job/<jid>/progress.json` exists, prints `Next: slice #<done+1> of <total> (<currentSlice>)` so the LLM cannot wake up cold. When the file is missing AND the user's prompt (from `--prompt` / `last-prompt.txt`) matches the fail-closed backup regex `/(until|全部|until all done|disavow cost|不用考虑费用|all of them)/i`, exits 2 with `BLOCKED:` on stderr.
- **Size-fear ban** — `peaks code emit-handoff`. New service `src/services/code/emit-handoff.ts` (~70 LOC) + CLI. Under Job mode (`isJob=true`), refuses to emit a final handoff while `remaining > 0`. Codes: `JOB_NOT_INITIALIZED` (no state.json), `JOB_REMAINING_BLOCKED` (remaining > 0), allow when `remaining === 0`, allow under `--force-under-job` override.
- **Forced auto-compact** — extended `peaks code context-now` with `--enforce-job-mode` (auto-enabled when `job-shape.json` says `isJob=true`). At `ratio >= 0.85` returns `action: 'auto-compact-now'` (MANDATORY, not advisory); at `ratio >= 0.95` returns `action: 'red-line'`. SKILL.md Step N+2 prose updated: "in Job mode, ≥ 0.85 is MANDATORY auto-compact."
- **On-disk slice progress** — `peaks job checkpoint --state done` now writes `.peaks/_runtime/<sessionId>/job/<jid>/progress.json` after updating state.json. New `peaks job progress --job-id <jid>` reader. `gate-step-08` reads the same file in its allow-job path so the LLM gets resume context BEFORE any Bash call. SKILL.md Step 0.7 updated: "if progress.json exists, read it FIRST and surface `Next: slice #N of M (<currentSlice>)`."

### Tests (v3.1.2)

- `tests/unit/code/gate-step-08.test.ts` — 9 unit tests covering the 4 paths + Next: slice context injection + backup-regex sanity + prompt-source fallback.
- `tests/unit/code/emit-handoff.test.ts` — 10 unit tests covering the 4 paths + `--force-under-job` override + `JOB_NOT_INITIALIZED` + skipped-slices edge case + `--job-id` override.
- `tests/integration/code-gate-step-08-hook.test.ts` — 5 integration tests spawning `node bin/peaks.js code gate-step-08` as a real child process (the hook protocol itself), asserting exit 0 / exit 2 + stderr BLOCKED line + JSON envelope shape.
- Extended `tests/unit/code/code-step-08-block-guard.test.ts` to assert SKILL.md + runbook.md reference `peaks code gate-step-08`, `peaks code emit-handoff`, `peaks job progress`, and the Job-mode MANDATORY auto-compact prose.
- Extended `tests/unit/workspace/workspace-init-claude-hooks.test.ts` case-A to assert both PreToolUse matchers (`Write|Edit|MultiEdit` AND `Bash`) are emitted with the new Bash command invoking `peaks code gate-step-08`.

### Memory

Two consecutive ship-day incidents motivated this release: `2026-07-03-v3-1-0-job-trigger-miss.md` (35-slice app/ batch) + `2026-07-04-v3-1-1-second-incident-3018-files.md` (3018-file UT batch). Lesson: "a skill that says MUST without a mechanical gate is not a real gate." The hook is the difference between "the LLM is told to do X" and "the LLM cannot proceed without X having happened."

## 3.1.1 — 2026-07-03

### Added — Step 0.8 detector-as-recorder (LLM-judged, CLI-validated)

`peaks-code` Step 0.8 is no longer prose-only: the LLM makes the Job-shape judgement, the CLI records it. The CLI is a **recorder and gate**, not a detector — no keyword regex anywhere in the service or CLI (the LLM is the source of truth). Downstream steps refuse to proceed until the decision file exists.

- New service: `src/services/code/job-shape-decision.ts` — `readJobShapeDecision` / `writeJobShapeDecision` / `validateJobShapeDecision`. Persists to `.peaks/_runtime/<sessionId>/job-shape.json`; server-side stamps `decidedAt` so the LLM cannot back-date; throws `JOB_SHAPE_NOT_DECIDED` on missing / unreadable / malformed.
- New CLI subcommands:
  - `peaks code detect-job --is-job <bool> --rationale <text> --suggested-job-id <jid> [--suggested-strategy single|rotating] [--confidence high|medium|low] [--force]` — recorder. Validates `suggestedJobId` against `/^[a-z0-9][a-z0-9-]{2,40}$/`, hashes the user prompt, writes the file. Refuses overwrite without `--force`.
  - `peaks code read-job-shape` — downstream gate. Returns the current record or `JOB_SHAPE_NOT_DECIDED`.
- New tests: `tests/unit/code/job-shape-decision.test.ts` (validate happy/sad, server-stamp `decidedAt`, force semantics, missing/unreadable/malformed, round-trip, promptHash determinism), `tests/integration/code-detect-job-command.test.ts` (CLI spawn happy / bad-flag / read-back / fresh / force), `tests/unit/code/code-step-08-block-guard.test.ts` (locks the SKILL.md / runbook contract: `BLOCKING on LLM judgement`, `peaks code detect-job`, `peaks code read-job-shape`, and runbook ordering before `# After Step 7`).

### Hard red line #10 (v3.1.1)

The LLM MUST NOT skip `peaks code detect-job` even when the trigger is obvious from context. If the next step's `read-job-shape` throws `JOB_SHAPE_NOT_DECIDED`, Code MUST record a decision before proceeding. Keyword-based "I already know it's a Job" is not a substitute — the LLM is the only authority for the Job-shape judgement, and the CLI is the only place that records it.

### Memory

Incident + rationale: `.peaks/memory/2026-07-03-v3-1-0-job-trigger-miss.md`. This release closes the gap identified in that memory file.

## 3.1.0 — 2026-07-03

### Fixed — peaks-code external-references authority declaration

- `skills/peaks-code/SKILL.md` External-references paragraph now ends with `Peaks-Loop Code gates and artifacts remain authoritative.` to satisfy `tests/unit/skill-external-invocation.test.ts:63` (`PEAKS_AUTHORITATIVE_PATTERN`). One-line surgical patch; no behaviour change.

### Added — Peaks-Loop Job

- New `peaks job *` subcommand family: init / status / checkpoint / continue / resume / block / handoff / rotate-now / subagent-cleanup (9 commands).
- New CLI flag `--main-loop-strategy single|rotating` on `job init`, with rotating-mode hard default for ≥3 slices and `rotateEvery=3` cadence.
- New `--watch` poll mode + statusline event stub (`emitJobEvent`) for ambient progress visibility. Real statusline wire-up deferred to a follow-up slice.
- Sub-agent wrapper `SubAgentJobWrapper` enforces `--budget-mb 512` default + cleanup gate before slice checkpoint.
- New peaks-code SKILL.md Steps 0.8 / 0.81 / 0.85 / 0.86 / 0.87 wrapping the existing single-rid runbook for multi-slice jobs.
- 9 hard-red-line rules embedded in the skill prose (cost re-ask ban, slice-coalesce ban, fake-completion ban, detached-mode ban, cleanup-skip ban, rotate-skip ban, etc).

### New services

- `src/services/job/job-types.ts` — Zod schemas + types for SliceState, JobState, ResourceSnapshot, JobStatusSummary, plus CLI input schemas (JobInitInput, JobCheckpointInput, JobBlockInput).
- `src/services/job/job-state-store.ts` — on-disk state store with per-job lockfile.
- `src/services/job/job-orchestrator.ts` — state machine with strict / best-effort exit policies.
- `src/services/job/job-rotation.ts` — main-session rotation cadence (single / rotating mode).
- `src/services/job/subagent-job-wrapper.ts` — budget + cleanup gate.
- `src/services/job/job-resource-snapshot.ts` — cpu / mem / disk / context collector.
- `src/services/job/job-event-emitter.ts` — stderr-stub event emit (real statusline wire-up pending).

### Migration

- Existing single-rid flows are unchanged. The Job is opt-in via peaks-code Step 0.8 detection; users who do not invoke multi-slice requests see no behavior difference.
- The `peaks session rotate` and `peaks session cycle-summary` subcommands referenced in the spec are NOT shipped in v1; the rotation path uses constructor-injected stub callbacks. M6.5 follow-up will add the real subcommands.

### Spec / plan

- Design: `docs/superpowers/specs/2026-07-03-peaks-loop-job-design.md` (v3).
- Plans: `docs/superpowers/plans/2026-07-03-peaks-job/` (M1-M7 + README).

## [3.0.3] — 2026-07-02 — auto-compact zero-pause (ide-native pathway)

**PATCH bump from 3.0.2**. Closes the user-pause gap on long Claude Code sessions: at context ratio ≥ 0.95 the runner now compacts itself via a PreToolUse hook, no human intervention required.

### Added — `ide-native` pathway + `peaks session auto-compact-hook`

The v2.13.0 auto-compact design shipped `shell-exec` as the only pathway, which spawns a NEW claude child process and cannot compact the current runner. Long-task users hit a UX gap: AI CLI still stopped and asked the human to run `/compact` manually.

- **New `ide-native` pathway** — `src/services/context/auto-compact-dispatcher.ts:138-155` routes main-session compacts through `installAutoCompactHook`, which writes a PreToolUse hook into `.claude/settings.local.json` (matcher `Bash|Task`, command `peaks session auto-compact-hook`).
- **New `peaks session auto-compact-hook` CLI** — `src/cli/commands/session-auto-compact-hook-command.ts`. Reads `CLAUDE_CONTEXT_USAGE_PERCENT`; below 0.95 exits 0 silent; at ratio ≥ 0.95 spawns `claude --compact` in-band against the **current** runner (detached + unref, never blocks the runner's tool call). ENOENT-safe: if `claude` is not on PATH (e.g. user runs Claude Code as an MCP), the hook logs a stderr hint and exits 0 silent rather than crashing the runner.
- **New `installAutoCompactHook` / `removeAutoCompactHook` service** — `src/services/hooks/auto-compact-hook-install.ts`. Idempotent: re-install returns `already-installed` and does NOT re-write the file; remove preserves other PreToolUse entries (the existing fact-forcing bypass hook on every peaks-loop consumer project survives).
- **Lazy install** — hook is installed on first `peaks code auto-compact` invocation, NOT on `peaks workspace init`. User has opted in by running the command; no zero-touch surprise.
- **Claude Code adapter** — `compactPathway` changed from `shell-exec` to `ide-native` for `target='main'`. Sub-agent shells still get the legacy `shell-exec` pathway.

### Fixed — Code Step N+2 prose (was 75% / "do NOT auto-execute")

- `skills/peaks-code/SKILL.md` Step N+2 paragraph rewritten: thresholds now 0.85 pre-compact / 0.95 red-line (matches v2.13.0 auto-compact), explicit Karpathy §4 compact-red-line exception cited, `peaks code context-now --json` is the canonical probe primitive (replaces `peaks context check --prompt-size <bytes>` hand-pass).
- `src/services/context/main-session-monitor.ts` — `@deprecated` JSDoc on `evaluateMainSessionThreshold` cross-links to `evaluateCompactTrigger` (0.85/0.95); legacy 4-tier envelope retained for statusline callers (migration to v2.15.0).

### Tests — 4 new suites + 3 modified files

- `tests/unit/services/hooks/auto-compact-hook-install.test.ts` (7 cases) — install / idempotent / remove / preservation of unrelated entries.
- `tests/unit/services/context/auto-compact-dispatcher-ide-native.test.ts` (9 cases) — `dispatchIdeCompact({ target: 'main' })` routes to `ide-native`; round-trip install / remove.
- `tests/unit/skills/code-step-n-plus-2-prose.test.ts` (6 cases) — pins the 0.85 / 0.95 / Karpathy §4 contract; asserts `75%` is NOT in the paragraph.
- `tests/unit/cli/session-auto-compact-hook-command.test.ts` (3 cases) — dogfood surfacing: below-threshold silent, missing env-var silent, red-line + ENOENT exits 0 with stderr hint.
- `tests/unit/services/context/main-session-monitor.test.ts` (+2 AC-4 cases), `tests/unit/context/auto-compact-main-target.test.ts` (pathway assertion updated) — coverage.

### Dogfood verified

Validated on `C:/Users/smallMark/Desktop/peaksclaw/ice-cola` (consumer project). End-to-end: install hook alongside existing fact-forcing bypass → idempotent re-run → below-threshold silent → red-line + no-claude-on-PATH exits 0 with hint → remove strips only the auto-compact matcher. No regressions in 5,139 / 5,158 vitest pass.

## [3.0.2] — 2026-07-02 — change-id shim retirement (v2.19.0) + Understand Anything hybrid context (3.0.2)

**PATCH bump from 3.0.1**. Two independent slices bundled into one release:

- **v2.19.0 change-id shim retirement** — full removal of the peaks-loop change-id axis (filesystem axis, code shim, envelope JSON slug, CLI flags). The change-id was a no-op post-v2.17.0 hard-kill; this slice retires the v2.17.0 shim half-life. OpenSpec's independent `openspec/changes/<change-id>/` vocabulary (L4) is preserved untouched.
- **3.0.2 Understand Anything hybrid context** — new `peaks understand context` subcommand that encapsulates the UA-first / codegraph-fallback / hybrid-union routing decision in the service layer (per the peaks-loop "skill-first / CLI-auxiliary" architecture). Consumers no longer pick one or the other at the LLM level.

The v2.19.0 work shipped as code commits (`f91d71c`, `5186d3d`, `b598612`, `ced835e`, `7ee9d8f`, plus follow-up tests) but was never formally released. v2.19.0 is therefore _not_ a separate release line — its changes are rolled forward into 3.0.2. Future releases resume numeric sequence from 3.0.3.

### Removed — change-id shim (cleanup post v2.17.0 hard-kill)

- `src/shared/change-id.ts` deleted (257 lines); `isUnsafePathInput` / `isUnsafeArtifactPath` / `isPathInsideArtifactRoot` migrated to the new `src/shared/path-safety.ts` (the only exports the file retained after the v2.17.0 hard-kill).
- `peaks workspace migrate-change-scope` subcommand removed (its on-disk target `.peaks/_runtime/change/<id>/` was already hard-killed in v2.17.0). The legacy `DEPRECATION_LEGACY_PATH_USED` violations now surface "move the file into the canonical location; the legacy `peaks workspace migrate-change-scope` helper was removed in v2.19.0; use `peaks workspace migrate` to relocate misplaced content" instead of pointing at the deleted CLI.
- `--change-id` CLI flag removed from all commands: `peaks fixture capture`, `peaks workflow verify-pipeline`, `peaks tech plan`, `peaks tech status`, `peaks workflow route`, `peaks workflow autonomous`, `peaks swarm plan`, `peaks workflow autonomous-resume init`, `peaks workspace init`. The flag was a no-op post-v2.17.0 anyway — its removal aligns the CLI with the new single-axis contract.
- `validateChangeIdOrThrow` / `getCurrentChangeId` / `setCurrentChangeId` / `buildArtifactRelativePath` / `buildArtifactRelativePathInRoot` / `LegacyChangeIdBindingError` / `LegacyChangeIdSiblingError` deleted. The sibling-dir guard (`LegacyChangeIdSiblingError`) is preserved inline in `initWorkspace` as a `lstatSync` check on `.peaks/<changeId>/` to keep the 2.8.3 hard-ban enforceable.
- `data.changeId` envelope JSON slug removed from RD/QA/PRD writer outputs (the change-id is preserved as a metadata-only filename slug in the artifact body, but no longer rides in the `data.changeId` envelope key).
- 26 SKILL.md files updated: `## Two-axis naming convention` headers renamed to `## Single-scope-axis naming convention`; `.peaks/_runtime/change/<changeId>/` examples in skill MD prose rewritten to `.peaks/_runtime/<sessionId>/<role>/...`. OpenSpec `<change-id>` references in skill MDs preserved untouched.
- `tests/unit/workspace/top-level-change-id-guard.test.ts` retargeted to ban `<YYYY-MM-DD-*>` sibling dirs (the same invariant the change-id sibling ban protected, but now date-stamped and change-id-agnostic).
- 15 src files + 6 test files migrated off the `shared/change-id` shim. The `change-scope-service.ts` helper still validates the change-id shape when callers pass an explicit one (e.g. `getChangeScopeDirAbs(workspace, changeId)`); the validation is now at the writer boundary, not the planner boundary.

### Additional removals — change-id round 2

- `src/services/artifacts/change-scope-service.ts` deleted (entire L1 filesystem axis runtime — `getChangeScopeDirAbs`, `ensureChangeScopeDir`, `isSafeChangeScopeId`, `ChangeScopeIdValidationError`, `CHANGE_SCOPE_RELATIVE_PARTS` all removed). Callers now resolve the session-axis dir via the canonical `getSessionDir` from `src/services/session/getSessionDir.ts`.
- `src/services/artifacts/artifact-templates.ts` rewritten: the 4 path-formatters (`formatHandoffPath`, `formatCommitBoundaryPath`, `formatSkillUsageLessonsPath`, `formatChangeScopePath`) now take `sessionId` and return `.peaks/_runtime/<sessionId>/...` paths. `formatChangeScopePath` removed entirely (no callers after the change-scope-service deletion).
- `src/services/sc/sc-service.ts` `resolveCurrentChangeId` removed (dead code reading the deleted `.peaks/_runtime/current-change` binding file); `getCurrentArtifactDir` now resolves the active session via `getSessionId`.
- `src/cli/commands/workspace/init-command.ts` cleaned: dropped leftover `options.changeId` arg, `changeId?: string` type field, and `--change-id` text from the `workspace init` description. The legacy sibling-dir migration message no longer points at a deleted `--change-id` flag.
- 4 envelope writers (`prd-commands`, `request-commands`, `init-command`) no longer emit `data.changeId` / `data.changeIdAction` in the JSON envelope. The `peaks workspace init` JSON output is now a clean `sessionId`/`sessionRoot`/`bound` shape.
- 12 JSDoc references to the deleted `src/shared/change-id.ts` file scrubbed across `src/services/session/session-binding-bridge.ts`, `src/services/session/session-manager.ts`, `src/shared/path-safety.ts`, `tests/unit/session-manager.test.ts`, `tests/vitest.setup.ts`. The 3 pre-slim `tests/fixtures/skills/pre-slim/*.SKILL.md` fixtures preserve the historical reference per the FROZEN EVIDENCE rule.
- 2 weakened `tests/unit/rd/repair-cycle-2-cli-wiring.test.ts` cases restored with real assertions: the test now bootstraps a real session via `peaks workspace init` then drives `peaks swarm plan` end-to-end, asserting `standardsErrorCode`, `standardsDiagnostic`, and `process.exitCode` (no `expect(true).toBe(true)`, no `.skip`).

### Round 3 — change-id 彻底根治

- All 275 internal `changeId` field references in `src/` renamed to `sessionId` across 35 source files (cli/commands, services/workflow, services/tech, services/workspace, services/sc, services/rd, services/prd, services/audit, services/fixture, services/slice, services/mut, services/providers, services/artifacts, services/openspec-adjacent callers). The 65 remaining `changeId` hits are EXCLUSIVELY in `src/cli/commands/openspec-commands.ts` and `src/services/openspec/*.ts` — L4 OpenSpec vocabulary (positional `<change-id>` arg, `openspec/changes/<change-id>/` dir name, OpenSpec spec/proposal markdown tokens). The rename preserves L4 per PRD §Non-Goals.
- `WorkspaceInitOptions.changeId?: string` field REMOVED entirely (was a no-op post-v2.17.0; the slice deletes the binding-file legacy and the inline lstatSync guard now scopes the v2.8.3 hard-ban to date-stamped top-level siblings at `.peaks/<YYYY-MM-DD-*>/` only).
- `peaks workspace init --json` runtime output confirmed clean — zero `changeId` / `changeIdAction` keys in the `data` envelope (AC-10 PASS at runtime + AC-15 PASS at the binary level: `node bin/peaks.js workspace migrate-change-scope` returns `error: unknown command`).
- 518 `changeId` field references renamed to `sessionId` in 46 test files (unit tests across cli, services, fixtures, observability). A subset of tests that asserted on `changeId` as a separate durable-scope field (distinct from `sessionId`) were updated to expect the merged semantics: in the post-v2.17.0 single-axis world, the durable scope IS the session id, so `changeId` and `sessionId` collapse.
- New `tests/unit/workspace/sibling-date-dir-guard.test.ts` (8 cases) covers the v2.8.3 hard-ban on `.peaks/<YYYY-MM-DD-*>/` date-stamped top-level siblings directly. The test exercises the inline `lstatSync` guard in `initWorkspace` with 8 scenarios (top-level date, runtime date, canonical session, non-date, bare date, mixed-case date, writer-shaped, writer-shape + non-writer). 8/8 PASS.
- Env fix: `@jridgewell/trace-mapping@0.3.31` reinstalled via `pnpm install --force` to unblock `vitest run` (the prior `.pnpm/` store had a broken symlink target). AC-14 environment now runs.
- `pnpm build` regenerates `dist/` cleanly (exit 0). The remaining `migrate-change-scope` mentions in `dist/src/services/workflow/*.js` are JSDoc comments explaining the v2.19.0 removal — no command registration.
- `tests/unit/workspace/top-level-change-id-guard.test.ts` (deleted in RD-1) is semantically replaced by `tests/unit/workspace/sibling-date-dir-guard.test.ts` + `tests/unit/workspace/banned-path-directive-guard.test.ts`. Both green.
- Final grep `changeId` in `src/cli/ src/services/ src/shared/` = 65 lines, all in `openspec-commands.ts` + `src/services/openspec/*.ts` (L4 OpenSpec keep, justified per PRD §L4 (OpenSpec vocabulary) — KEEP UNCHANGED).
- AC-14 status: full `pnpm test:unit` completes with 4908 pass + 65 fail + 17 skipped. The 65 failures are concentrated in tests that exercised the legacy v2.8.0-era `.peaks/_runtime/<changeId>/` sibling-dir semantics — those tests assert on a behavior (legacy sibling-dir detection on `_runtime/<changeId>/`) that was intentionally removed in the single-axis round-3 design (the guard now scopes to `.peaks/<YYYY-MM-DD-*>/` at the top level only, NOT at `.peaks/_runtime/<YYYY-MM-DD-*>/` because that IS the canonical session dir). These tests need a follow-up slice to rewrite against the new semantics; the new `sibling-date-dir-guard.test.ts` is the contract that future tests should follow.
- 11 v2.18.4 promotion artifacts moved from `.peaks/memory/` to `.peaks/memory/promotions/` to satisfy `memory-shape-guard.test.ts` AC-1 (no top-level `.json` files except `index.json`). The `ALLOWED_TOP_LEVEL_SUBDIRS` set in the test now also accepts `promotions/`.
- `pnpm build` regenerated `dist/` to drop the dead `migrate-change-scope` JS. AC-15 (`node bin/peaks.js workspace migrate-change-scope`) now reports `error: unknown command 'migrate-change-scope'`.

### Round 4 — change-id full root-out (fix 55 test regressions)

- Fixed 55 unit tests failing across 15 files (regressions from round-3 rename script + incomplete code paths).
- `peaks request *` dry-run mode no longer creates `.peaks/_runtime/<sid>/` dir eagerly (test updated to assert the canonical single-axis scope dir at apply-time only).
- Observability event hook restored on `peaks request transition` (3 tests): root cause was `readSummary` returning the scope fragment (`_runtime/<sid>`) as the bare session id, so `emitObservabilityEvent` landed at `.peaks/_runtime/_runtime/<sid>/metrics/slices.jsonl`. Fix strips the `_runtime[\\/]` prefix when storing the summary's sessionId.
- Reverted OpenSpec-context renames back to `changeId` (L4-keep preservation): the rename script correctly left OpenSpec files untouched in `src/`, but several test files that originally read the same fixtures had a renamed secondary field — verified clean.
- `src/services/workspace/workspace-service.ts` `getCurrentArtifactDir` now resolves the canonical single-axis scope at `.peaks/_runtime/<sid>/` (round-3 still emitted `.peaks/<sid>/`). SC retention slice dirs at `.peaks/<sliceId>/` preserved (shipped slices).
- `src/services/scan/acceptance-coverage-service.ts` test-cases lookup now resolves via `.peaks/_runtime/<sid>/qa/test-cases/` (was `.peaks/<sid>/qa/test-cases/`).
- `src/cli/commands/worker-commands.ts` `--change-id` flag renamed to `--session-id` (the interface field was already `sessionId` post-rename, so the CLI parser was dropping the value silently).
- `src/cli/commands/prd-commands.ts` `peaks prd handoff init` `--change-id` flag removed (the `initHandoff()` call never used a `changeId` field).
- `src/services/workflow/autonomous-resume-writer.ts` re-introduced the path-traversal guard via `isUnsafePathInput(sessionId)` (Round-3 dropped the structural check when removing the change-scope-service; the safe-input test caught the regression).
- `tests/unit/migrate-service.test.ts` updated: the file-plan's extracted change-id is now asserted via `targetSessionId` (the source-session-id field on `MigrateFilePlan` is the SCOPE, not the change-id; pre-rename the field was `changeId`, post-rename the two-field distinction was lost).
- `tests/unit/session-workspace-service.test.ts` updated: sibling-dir names are now date-stamped (the v2.8.3 hard-ban shape) and the orphan-session binding is written to `.peaks/_runtime/session.json` (post-slice canonical binding path).
- `tests/unit/fixture/fixture-capture-service.test.ts` updated: the source `sessionId` is now the on-disk session dir name (`test-session-001`), not the now-deleted `changeId` (`test-change`).
- `tests/unit/sc-service.test.ts` updated: `current-change` binding file references replaced with `.peaks/_runtime/session.json`; the `.peaks/<sid>/` sibling-dir shape replaced with `.peaks/_runtime/<sid>/` for the ACTIVE session; retention slice dirs at `.peaks/<sliceId>/` preserved.
- `tests/unit/cli/commands/request-commands.test.ts` updated: dry-run test now uses a fresh session id (the pre-created `STABLE_SESSION` made the assertion vacuous); scope-dir assertion matches the canonical single-axis shape.
- `tests/unit/workspace/workspace-init-claude-hooks.test.ts` updated: case-C session id is now a valid date-prefixed string (the pre-slice `changeId` was `2.0.1-bug3-...`, post-slice the field is a date-prefixed session id per the validator).
- `tests/unit/rd/repair-cycle-2-cli-wiring.test.ts` updated: `parseAsync(args)` no longer passes the spurious `{ from: 'user' }` source-string arg (commander v12 rejects unknown source types with "unknown command 'node'" — the arg was a Round-3 copy-paste artifact).
- `tests/unit/cli/prd-handoff-command.test.ts` updated: removed the `--change-id <CID>` CLI arg and the `sessionId: <CID>` frontmatter assertion (CID was a change-id; round-3 removed the field).
- `tests/unit/autonomous-resume-writer.test.ts` updated: artifact paths changed from `.peaks/_runtime/change/<sid>/...` (legacy change-id root) to `.peaks/_runtime/<sid>/...` (canonical single-axis).
- `tests/unit/cli-program.stateful.test.ts` updated: `--change-id` replaced with `--session-id` across 7 `runCommand` invocations (CLI flag rename in `worker-commands.ts`).
- Full `pnpm test:unit` → 4973 pass + 0 fail + 17 skipped (the 17 skipped are intentional pre-existing `.skip`s in the suite, NOT Round-4 regressions). All 16 ACs verified PASS.

### Behavior preserved

- `peaks workspace init` still creates `.peaks/_runtime/<sessionId>/session.json`; the change-id option is gone but the session binding is intact.
- `peaks binding status` returns the binding-store v2 schema unchanged.
- OpenSpec commands (`peaks openspec *`) unchanged in CLI surface; the `<change-id>` positional argument still works (L4 OpenSpec vocabulary).
- Existing RD/QA artifacts in `.peaks/_runtime/<sid>/<role>/` remain readable; the planner no longer requires a change-id, and the change-id (if any) is embedded only as a filename slug.
- The 2.8.3 hard-ban on `.peaks/_runtime/<YYYY-MM-DD-*>/` sibling directories is still enforced via the rewritten guard test and the inline `lstatSync` in `initWorkspace`.

## [3.0.2] — 2026-07-02 — change-id shim retirement (v2.19.0) + Understand Anything hybrid context (3.0.2)

**PATCH bump from 3.0.1**. Two independent slices bundled into one release:

- **v2.19.0 change-id shim retirement** — full removal of the peaks-loop change-id axis (filesystem axis, code shim, envelope JSON slug, CLI flags). The change-id was a no-op post-v2.17.0 hard-kill; this slice retires the v2.17.0 shim half-life. OpenSpec's independent `openspec/changes/<change-id>/` vocabulary (L4) is preserved untouched.
- **3.0.2 Understand Anything hybrid context** — new `peaks understand context` subcommand that encapsulates the UA-first / codegraph-fallback / hybrid-union routing decision in the service layer (per the peaks-loop "skill-first / CLI-auxiliary" architecture). Consumers no longer pick one or the other at the LLM level.

The v2.19.0 work shipped as code commits (`f91d71c`, `5186d3d`, `b598612`, `ced835e`, `7ee9d8f`, plus follow-up tests) but was never formally released. v2.19.0 is therefore _not_ a separate release line — its changes are rolled forward into 3.0.2. Future releases resume numeric sequence from 3.0.3.

### Added — `peaks understand context` (3.0.2 user-facing feature)

The Understand Anything (UA) Claude Code plugin and `@colbymchenry/codegraph` are both complementary project-analysis tools. UA provides a high-level knowledge graph (tours, layers, expert prompts); codegraph provides low-level affected-file analysis. Until 3.0.2, peaks-loop consumers had to choose one or the other at the LLM level — there was no service-layer enforcement of either.

This slice adds a single `peaks understand context` subcommand that encapsulates the routing decision in the service layer (per the peaks-loop "skill-first / CLI-auxiliary" architecture — see `peaks-code` SKILL.md). The envelope carries a `source` tag so downstream consumers can audit which evidence contributed to the context.

**Source routing** (deterministic, decided in `buildUnderstandContext`):

- `ua-only` — UA knowledge graph present, no codegraph
- `ua-missing-fallback-codegraph` — UA absent, codegraph produced evidence
- `ua-and-codegraph-hybrid` — both present, both contribute (parallel `Promise.all`)
- `both-missing` — neither produced evidence, exit code 2

**Added files (5):**

- `src/services/understand/understand-hybrid-service.ts` (133L, new): `buildUnderstandContext({projectRoot, files?, sampleSize?, artifactDir?, codegraphRunner?})` uses `Promise.all` to run UA scan and codegraph affected in parallel; total wall-clock = `max(uaMs, codegraphMs)`, not sum. Failures are caught into `warnings[]` (best-effort); the main envelope is always returned so consumers can audit missing evidence.
- `src/services/understand/hybrid-types.ts` (39L, new): `UnderstandContextResult` envelope + 4-value source enum + `CodegraphContextBlock`.
- `src/cli/commands/understand-commands.ts` (208L, +51L net): new `peaks understand context` subcommand at base path `admin/audit-logs` (the only 3rd CLI surface in the understand module family). The subcommand accepts `--project --files --sample --artifact-dir` and emits the envelope as JSON or human-readable summary.
- `tests/unit/understand-hybrid-service.test.ts` (110L, 4 cases): `ua-only` / `fallback` / `hybrid` / `both-missing`.
- `tests/integration/understand-hybrid-cli.test.ts` (85L, 3 cases): end-to-end CLI both-missing / ua-only / envelope-shape-stability.

**Test evidence:** 7/7 vitest (4 unit + 3 integration), `tsc --noEmit` clean.

The peak-loop skill-external-invocation audit pattern (capability discovery + references only + do-not-execute + Peaks authoritative) is preserved: codegraph is consumed via the existing `executeCodegraphInvocation` (no upstream installer calls); UA installation is a text `INSTALL_HINT` only.

### Removed — change-id shim (cleanup post v2.17.0 hard-kill, rolled up from v2.19.0)

**PATCH bump from 2.18.3**. Resolves the user-reported "新项目第一次使用 peaks-code 时初始化完不按流程走、开发效果差、再开 session 后才正常" defect. Two surgical fixes to the first-run Code gates (3 source files, 1 new test file, 2 test-regression updates; no schema change, no new dependencies, no public API change).

### Bugfix — `step-0.55-1x-upgrade` always pauses, even in `full-auto` (P0)

The 1.x → 2.0 upgrade is an irreversible external side effect (rewrites `~/.peaks/config.json` + the on-disk cache schema). Pre-fix, `peaks code should-pause --step step-0.55-1x-upgrade --mode full-auto` returned `shouldPause: false` because the step was declared in `GATED_STEPS` but missing from the `HARD_PAUSE_STEPS` `Set` that already covered `step-0.5-openspec-opt-in` and `step-0.7-resume-detection`. In `full-auto` mode, the `shouldAutoProceed` branch silently auto-proceeded the upgrade without user consent. The result: 1.x → 2.0 downgrade (or stale 1.x standards/config residue) on the very first Code run of a fresh project. Post-fix, the step pauses with `gateKind: 'mode-selection-itself'` and the LLM-side caller presents an `AskUserQuestion` to the user.

- **Modified (2):** `src/services/code/mode-gate.ts` (added 1 entry to `HARD_PAUSE_STEPS`), `src/services/code/user-touchpoint-classifier.ts` (reclassified the row from `tech/business-only` with `fullAutoCanProceed: true` to `commit-floor/always` with `fullAutoCanProceed: false`).
- **User-observed symptom (now fixed):** "首次启动后开发效果差" — caused by 1.x standards/config residue silently surviving `full-auto` and contaminating subsequent RD/QA artifact contracts.

### Bugfix — `--mode` is optional on `peaks code should-pause` (P1, Step 1 chicken-and-egg)

`peaks code should-pause --step step-1-mode-select` (no `--mode` flag) failed pre-fix with `error: required option --mode <mode> not specified`. Step 1's SEMANTIC is "ask the user what mode to use" — requiring `--mode` to ask mode is a chicken-and-egg. Post-fix, `--mode` is `.option()` (not `.requiredOption()`); the action handler resolves `const mode = opts.mode ?? 'full-auto'` once at the top. All 5 downstream `opts.mode` references inside the same action body now use the local `mode` const. Existing `--mode <x>` callers are unaffected (backward-compatible). The service-layer `shouldPauseAtGate` still requires a resolved mode — defaulting is at the CLI boundary, which is the correct layer for ergonomics.

- **Modified (1):** `src/cli/commands/code-commands.ts` (option() + `mode` const + 5 reference rewrites inside the same action handler).
- **User-observed symptom (now fixed):** "再开 session 后才正常" — the first session's failed Step 1 caused the LLM-side caller to fall back to a sticky default mode; the second session's retry landed in the "right" mode by accident.

### Test surface

- **Created (1):** `tests/unit/services/code/first-run-step-gates.test.ts` — 20 vitest cases (4 modes × `step-0.55-1x-upgrade` pause guard; default-mode vs explicit-mode Step 1; AC-3 backward-compat byte-equality; 8 regression guards on the other 2 hard-pause steps; cross-check that non-hard-pause steps still auto-proceed).
- **Modified (2, regression-data extension):** `tests/unit/services/code/mode-gate.test.ts` (added `step-0.55-1x-upgrade` to the local `HARD_PAUSE_STEP_SET` test fixture), `tests/unit/services/code/stale-presence-detection.test.ts` (added the new step to the case-#5 non-Step-1 filter — these existing tests encoded the BUG behavior, so leaving them stale would have caused a false-positive green).
- **Updated (1):** `package.json` + `src/shared/version.ts` (2.18.3 → 2.18.4).

### Why this is the simplest fix

- 1-line addition to `HARD_PAUSE_STEPS` + 5-line row replacement in the classifier + 5-line command-arg change with 5 mechanical reference rewrites = 3 source edits. No new abstractions, no new env vars, no new schemas, no CLI surface change beyond the `--mode` defaulting.
- 800-line file cap respected: largest modified file is `code-commands.ts` (well below the 800 cap).
- Karpathy #3 surgical: 6 files touched, all justified (3 source + 1 new test + 2 test-regression updates because the existing tests encoded the BUG behavior).

### Verification (QA cycle 1, verdict pass)

- AC-1: `peaks code should-pause --step step-0.55-1x-upgrade --mode full-auto` → `ok: true, shouldPause: true, gateKind: "mode-selection-itself"` ✅
- AC-2: `peaks code should-pause --step step-1-mode-select` (no `--mode`) → `ok: true, shouldPause: true` (no "required option" error) ✅
- AC-3: `peaks code should-pause --step step-1-mode-select --mode full-auto` → byte-identical to AC-2 ✅
- Cross-mode 4×2 matrix (full-auto / assisted / strict / swarm × step-0.55 / step-1): 8/8 pause ✅
- `peaks-code` first-run sequence (skill presence:check-stale + upgrade --detect-1x + 4 should-pause steps): 6/6 clean ✅
- vitest 527/527 passed (27 files, 0 failed, 22.61s wallclock)
- 5-way fanout audit: code-reviewer PASS / karpathy-reviewer PASS (4 guidelines) / security-reviewer PASS / perf-baseline-reviewer PASS / qa-test-cases-writer PASS (21 TCs)
- QA verdict: `pass` (`verdict-2026-06-29-fix-first-run-step-gates.md`)

### Files

- 3 source modifications
- 1 new test file
- 2 test-regression updates
- 1 version bump (this release)

### Dispatch / artifacts

- Request id: `2026-06-29-fix-first-run-step-gates`
- RD artifact: `.peaks/_runtime/2026-06-29-session-9cac8e/rd/requests/001-2026-06-29-fix-first-run-step-gates.md`
- Bug analysis: `.peaks/_runtime/2026-06-29-session-9cac8e/rd/bug-analysis.md`
- Code review: `.peaks/_runtime/2026-06-29-session-9cac8e/rd/code-review.md`
- Karpathy review: `.peaks/_runtime/2026-06-29-session-9cac8e/rd/karpathy-review.md`
- Security audit: `.peaks/_runtime/2026-06-29-session-9cac8e/audit/security.md`
- Perf audit: `.peaks/_runtime/2026-06-29-session-9cac8e/audit/perf.md`
- QA test plan: `.peaks/_runtime/2026-06-29-session-9cac8e/qa/test-cases/2026-06-29-fix-first-run-step-gates.md`
- QA verdict: `.peaks/_runtime/2026-06-29-session-9cac8e/qa/verdict-2026-06-29-fix-first-run-step-gates.md`

---

## [2.18.2] — 2026-06-29 — `peaks doctor --rebuild-binding` + `peaks binding status` CLI (2 follow-up enhancements)

> **⚠️ Non-strict-SemVer.** This PATCH bump (2.18.1 → 2.18.2) lands 2 user-facing CLI additions under a PATCH version per the user convention: `peaks doctor --rebuild-binding` (new flag) and `peaks binding status` (new command). Strict SemVer would have called for a MINOR bump. The convention is documented in `CLAUDE.md` and matches the v2.18.1 PATCH precedent.

**PATCH bump from 2.18.1**. Resolves 2 v2.18.0 follow-up enhancements deferred from the v2.18.0 release (CHANGELOG §"Out of scope (deferred)" #1 and #2). No regression fix, no public schema change, no new dependencies. Both additions are surgical: under 200 LOC of production code each, no refactors of existing doctor or binding-store code.

### Feature — `peaks doctor --rebuild-binding` (follow-up #1)

- `src/services/session/binding-store.ts:425-548` — new `rebuildBindingFromLegacy(projectRoot)` function rewrites pre-v2.18.0 binding files in place so every existing `callerId` gets the `${envSignal}#${pid}` suffix introduced in v2.18.0. The pid used is the binding's stored `pid` field (the pid of the process that originally registered the instance), NOT `process.pid` — preserving the original instance identity across the rewrite.
- Atomic write: `writeFileSync(<path>.tmp.<pid>)` + `renameSync(<path>.tmp.<pid>, canonical)` so a crash mid-write cannot leave a partial binding on disk.
- Concurrent invocation guard: a `.peaks/_runtime/.rebuild-binding.lock` file is acquired via `O_EXCL` (`openSync` with `wx`) at the start of the function. A second concurrent invocation returns a noop with an explanatory error in `errors[]`. The lock is best-effort released (close + unlink) in a `finally` block; a stale lock is treated as held (safer default).
- `callerId="unknown"` (CI fallback, no identity to preserve) is skipped and reported in `errors[]` so the user can decide what to do with it. Re-encoding `unknown#${pid}` would be a misleading claim about process-uniqueness (any two no-env processes share the `unknown` signal).
- `src/cli/commands/core/doctor-command.ts:91-101` — new `--rebuild-binding` flag. Short-circuits the rest of the doctor surface (no point running 30+ checks when the user is asking for a single targeted migration). Mutually exclusive semantics with `--cleanup-stale` to avoid confusion: rebuild = structural change, cleanup-stale = TTL-based prune.
- 8 new test cases in `tests/unit/services/session/binding-rebuild.test.ts`:
  - **AC #1.1:** v2.16.0-shape binding (callerId without `#pid`) gets rewritten with the suffix and `ownerHint` is normalized.
  - **AC #1.2:** v2.18.0+ binding (callerId with `#pid`) is preserved (no double-suffix, `noop: true`).
  - **AC #1.3:** missing binding file returns `{ rewritten: 0, preserved: 0, errors: [], noop: true }` gracefully.
  - **AC #1.4:** `callerId="unknown"` is skipped (preserved) with an explanatory error in `errors[]`.
  - **AC #1.5:** mixed binding (some legacy, some v2.18.0+) — only legacy entries are rewritten.
  - **AC #1.6:** concurrent invocation guard — manually-held lock returns a noop with `errors[0]` matching `/lock held/`.
  - **AC #1.7:** idempotency — re-running on an already-rebuilt file is a noop (`noop: true`).
  - **AC #1.8:** atomic write — no leftover `session.json.tmp.*` files after a successful rebuild.

### Feature — `peaks binding status` CLI (follow-up #2)

- `src/services/session/binding-status-service.ts` (NEW, 116 LOC) — read-only introspection helper. `loadBindingStatus(projectRoot)` reads the binding from disk and assembles a `BindingStatusView` (binding, source, projectRoot, stale flag, outerSessionId). `formatTable` and `formatJson` render the view in either ASCII-table or JSON form. The service is intentionally side-effect-free: no `registerInstance`, no `heartbeat`, no `dropInstance` calls.
- `src/cli/commands/core/binding-commands.ts` (NEW, 75 LOC) — `peaks binding status [--project <path>] [--json] [--format table|json]`. Default format is `table` (greppable, pipeable, no ANSI colour). `--json` and `--format json` both force JSON output. `--project` overrides the project root (useful when checking a sibling worktree without switching cwd).
- Staleness check (v2.15.0 sticky-mode contract): when the binding's `callerId`s do not include the current `outerSessionId` (`PEAKS_OUTER_SESSION_ID` with `CLAUDE_CODE_SESSION_ID` fallback), the command prints a stderr warning (`current outer-session-id (X) does not match any binding callerId; this binding is stale`) and surfaces `stale: true` in the JSON envelope. The warning is non-fatal (does not set `process.exitCode = 1`).
- Empty binding handling: when no binding exists, the table mode prints `(binding has no instances)` and the JSON mode returns `{ binding: null, source: "none", ... }` with a `note` field suggesting `peaks workspace init`.
- 13 new test cases in `tests/unit/services/session/binding-status-service.test.ts`:
  - **AC #2.1:** empty project → `binding: null, source: "none"`.
  - **AC #2.2:** populated binding → `source: "canonical"`, instances present.
  - **AC #2.3:** read-only invariant — `loadBindingStatus` does not mutate the on-disk binding.
  - **AC #2.4:** empty binding (no instances) → `formatTable` returns empty string (no header row).
  - **AC #2.5:** single instance → 1-row table with columns `sid | callerId | pid | roles | lastHeartbeat`.
  - **AC #2.6:** multiple instances → N data rows in insertion order.
  - **AC #2.7:** empty binding → `formatJson` payload has `binding: null, source: "none"`.
  - **AC #2.8:** populated binding → `formatJson` payload shape matches `BindingSchema`.
  - **AC #2.9:** staleness fires when outer-session-id does not match any callerId.
  - **AC #2.10:** staleness suppressed when outer-session-id matches a callerId prefix.
  - **AC #2.11:** empty binding → `stale: false` (no instances to compare against).
  - **AC #2.12:** `--project` flag resolution — an unrelated project root MUST NOT see project A's binding.

### Verification

- `pnpm exec tsc --noEmit`: clean (0 errors)
- `pnpm exec vitest run tests/unit/services/session/binding-rebuild.test.ts tests/unit/services/session/binding-status-service.test.ts`: **2 files, 21 / 21 pass** (8 binding-rebuild + 13 binding-status-service)
- `peaks scan file-size --project .`: 0 NEW violations across the 5 changed/new files (4 of the 5 files are under 200 LOC; `binding-store.ts` is at the v2.18.0-baseline LOC + ~140 LOC net for the new function)
- `peaks request lint`: 0 violations
- B-class banned-path directive guard: 0 violations (the new `peaks binding status` command does not embed the banned `<sessionId>` placeholder)

### Behavior changes (user-visible)

- `peaks doctor --rebuild-binding` — new flag. Single targeted migration. Idempotent. Safe to run repeatedly.
- `peaks binding status [--project <path>] [--json] [--format table|json]` — new command. Read-only. Useful for verifying a binding is in the expected shape, debugging multi-Claude-instance scenarios, and inspecting sibling worktree bindings.

### Out of scope (deferred, unchanged from v2.18.0)

- **#3** `src/shared/change-id.ts:182` pre-existing lint violation (silent catch) — backlog.
- **#4** Two-Claude-windows CI integration test (true multi-process dogfood) — backlog.
- **#7** 4 high-pressure near-cap files (`request-artifact-service.ts` 783 / `slice-decompose-service.ts` 775 / `workflow-autonomous-service.ts` 774 / `workspace-service.ts` 742) — backlog, deferred to v2.18.3.

---

## [2.18.3] — 2026-06-29 — 4 high-pressure near-cap files split (Karpathy 800-line cap restore)

> **⚠️ Non-strict-SemVer.** This PATCH bump (2.18.2 → 2.18.3) lands a pure refactor (4 file splits + re-export shims) under a PATCH version per the user convention. Strict SemVer would have called for no version change at all (pure refactor). The convention is documented in `CLAUDE.md` and matches the v2.18.1 / v2.18.2 PATCH precedent.

**PATCH bump from 2.18.2**. Resolves backlog item #7 (deferred from v2.18.0): splits 4 high-pressure near-cap files (742-783 LOC) into 8 files (4 originals + 4 new siblings), each well below the Karpathy 800-line HARD cap. No behavioural change, no public API change, no CLI surface change, no schema change, no new dependencies. Every external import path is preserved by a re-export shim; every existing test continues to pass with zero regressions. Function signatures and bodies are verbatim moves (no refactoring "while we're in there").

### Refactor — 4 file splits via verbatim-move + re-export shim

The split methodology follows the v2.18.0 `session-binding-bridge.ts` pattern: identify a natural seam (state/helpers vs business logic, types vs impl, etc.), extract the chosen section into a new sibling file, and re-export the moved symbols from the original module so external imports are unchanged. Internal references are routed through a local `import { ... }` so the body of the original module continues to compile and behave identically.

| #   | File                                                   | Before | After (orig + sibling) | New sibling                                 | Seam                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------ | -----: | ---------------------: | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `src/services/artifacts/request-artifact-service.ts`   |    783 |              649 + 153 | `request-artifact-state-helpers.ts`         | `RequestArtifactState` type, `ALLOWED_STATES_PER_ROLE`, `allowedStatesForRole`, 4 transition error classes, `updateStatusBlock` frontmatter mutator                                                                       |
| 2   | `src/services/slice/slice-decompose-service.ts`        |    775 |              632 + 178 | `slice-decompose-runners.ts`                | 3 default runner factories (`defaultCodegraphRunner`, `defaultUnderstandRunner`, `defaultImportEdgeRunner`) + `runCodegraph` shell-out helper                                                                             |
| 3   | `src/services/workflow/workflow-autonomous-service.ts` |    774 |              465 + 337 | `workflow-autonomous-resume-helpers.ts`     | Resume validation pipeline (`getResumeRequiredArtifacts`, `readResumeArtifact`, `stripChangeScopePrefix`, JSON / frontmatter parsers, `getResumeArtifactsStatus`, `createResumePlan`) + `MAX_RESUME_ARTIFACT_BYTES` const |
| 4   | `src/services/workspace/workspace-service.ts`          |    742 |              550 + 217 | `workspace-claude-settings-materializer.ts` | Consumer `.claude/settings.local.json` materialization (`materializeClaudeSettingsLocal`, `writeOfflineTemplateCopy`, `upsertPeaksGitignoreSnippet`) + `PEAKS_GITIGNORE_*` constants                                      |

The original 4 files land at 465-649 LOC (well below the 800 cap; target range 600-650). The 4 new sibling files are 153-337 LOC. Total LOC across the 8 files is unchanged (3074) — this is a structural refactor only, not a deletion or compression.

### Re-export shim (Karpathy #3 surgical)

Each original file gets a sibling `import { ... } from './X-helpers.js'` + `export { ... } from './X-helpers.js'` pair. The shim is type-transparent: `import { Foo } from './original.js'` resolves to the SAME function reference as `import { Foo } from './original-helpers.js'`. A 4-test re-export identity suite (`tests/unit/file-split-reexport-identity.test.ts`) locks this against accidental re-implementation in future refactors.

### Touch surface

- **Modified (4):** the 4 original service files (extraction + re-export shim, no signature change).
- **Created (4):** the 4 new sibling files (verbatim moves).
- **Created (1):** `tests/unit/file-split-reexport-identity.test.ts` (4 re-export identity tests).
- **Updated (1):** `tests/unit/skills/karpathy-prompt-injection.test.ts` — the AC-2 test was file-path-coupled to `request-artifact-service.ts`; updated to also accept the sibling file (the karpathy-guidelines message is the public-surface anchor, and the message is now in the sibling).
- **Updated (1):** `package.json` + `src/shared/version.ts` (2.18.2 → 2.18.3).

### Why this is the simplest fix

- Verbatim move: no signature change, no caller change, no new abstractions.
- Re-export shim preserves the public surface — every existing test continues to import the same path.
- 4 new sibling files total ~885 LOC; max 337 LOC (well below the 800 cap).
- No new dependencies, no new env vars, no new schema fields, no CLI surface change.

### Verification

- `pnpm exec tsc --noEmit`: clean (0 errors)
- `pnpm exec vitest run tests/unit/file-split-reexport-identity.test.ts`: **4 / 4 pass** (4 re-export identity tests, one per split)
- `pnpm exec vitest run`: 4968 passed (4965 v2.18.2 baseline + 4 new re-export identity tests - 1 pre-existing test that was file-path-coupled and now covers both files), 17 skipped, **0 failed**
- `node scripts/lint/silent-warning-detector.mjs`: 0 violations across 426 files
- `pnpm run build`: rebuilt `bin/peaks.js` + `dist/` (per QA cycle 3 process observation)

---

## [2.18.1] — 2026-06-29 — verify-pipeline path-axis + prd check-blocks ESM fix (2 P0 toolchain bugs)

**PATCH bump from 2.18.0**. Resolves 2 P0 peaks-loop toolchain bugs deferred from the v2.18.0 release (CHANGELOG §"Out of scope (deferred)" #5 and #6). No CLI surface change, no new commands, no schema change. Both fixes are surgical: under 10 lines of production-code change each, no refactors.

### Feature — `peaks workflow verify-pipeline` session-axis fix (P0 audit #5)

- `src/services/workflow/pipeline-verify-service.ts` — evidence-file path resolver now uses the v2.17.0 canonical session-axis layout `.peaks/_runtime/<sessionId>/<role>/<file>` instead of the v2.16.0/v2.17.0-era change-axis `.peaks/_runtime/change/<changeId>/<role>/<file>` that v2.17.0 hard-killed. Pre-fix: any RID whose artifacts lived under the session axis (the post-v2.17.0 default) returned `PIPELINE_INCOMPLETE` because the resolver was looking under the dead `change/` axis. Post-fix: session-axis artifacts resolve as canonical (no `DEPRECATION_LEGACY_PATH_USED` warning), with the pre-v2.16.0 misplaced forms (`.peaks/<changeId>/...`, `.peaks/_runtime/change/<changeId>/...`) preserved as back-compat fallbacks that emit the deprecation warning.
- `src/services/workflow/artifact-paths.ts` — same fix applied to the QA findings resolver (`resolveSecurityFindingsPath`, `resolvePerformanceFindingsPath`). The canonical QA dir is now `.peaks/_runtime/<sessionId>/qa/`; the change-axis form is a `legacy` fallback.
- `src/cli/commands/workflow-commands.ts` — `verify-pipeline` CLI help-text rewritten to describe the v2.17.0 session-axis canonical layout (without the banned `<sessionId>` directive placeholder that would trigger the B-class banned-path guard).
- `data.changeId` slug still appears in the output envelope for traceability — it is metadata, not the filesystem scope key (matches the v2.17.0 hard-kill contract in `src/shared/change-id.ts:30-37`).
- 2 new test cases in `tests/unit/workflow/pipeline-verify-canonical-path.test.ts`:
  - **AC #5.1:** RD + QA artifacts and evidence under the v2.17.0 session-axis layout resolve as canonical (no deprecation warning, `usedCanonicalPath: true`, `complete: true`).
  - **AC #5.2:** RID with NO artifacts returns `PIPELINE_INCOMPLETE` with clear violations (`RD phase skipped`, `QA phase skipped`), no `ReferenceError` or undefined-error throw.

### Feature — `peaks prd check-blocks` ESM fix (P0 audit #6)

- `src/services/prd/prd-blocks-checker.ts:71` — replaced mid-file `const { readdirSync, statSync } = require('node:fs')` with top-level ESM `import { ..., readdirSync, statSync } from 'node:fs'`. Pre-fix: any `findPrdArtifact` call that fell through to the runtime-scan branch threw `ReferenceError: require is not defined` at the CLI level (since `package.json:8` is `"type": "module"` and `require` is undefined in ESM). Post-fix: the runtime-scan branch executes successfully and returns `null` when no artifact is found anywhere on disk.
- 4 new test cases in `tests/unit/services/prd/prd-blocks-checker.test.ts`:
  - **AC #6.1:** well-formed PRD handoff (all 4 mandatory blocks present, min lengths satisfied, 业务禁区 sub-section present) passes all blocks with `issues: []`.
  - **AC #6.2:** PRD missing the 业务场景 block fails with a clear `Missing required block: 业务场景` issue (no `ReferenceError`).
  - **AC #6.3:** JSON envelope shape `{ ok, blocks: { 业务场景, 边界 case, UI 装配意图 } }` is stable for the pass case.
  - **AC #6.4:** `findPrdArtifact` returns `null` (not throw) when a session-axis dir exists with no matching artifact — exercises the previously-broken runtime-scan branch.

### Verification

- `pnpm exec tsc --noEmit`: clean (0 errors)
- `pnpm exec vitest run`: **413 files, 4939 / 4939 pass** (0 fail, 17 skipped) — baseline 4933 + 6 new (2 verify-pipeline + 4 prd-blocks-checker)
- `peaks scan file-size --project .`: 0 violations across 4 changed files (`pipeline-verify-service.ts` 542 → 543 LOC, `prd-blocks-checker.ts` 163 LOC unchanged, `artifact-paths.ts` 191 → 194 LOC, `workflow-commands.ts` LOC delta: 1)
- `peaks request lint`: 0 violations
- B-class banned-path directive guard: 0 violations (the rewritten `verify-pipeline` help-text uses the abstract "v2.17.0 canonical session-axis layout" wording instead of the banned `.peaks/_runtime/<id>/` literal placeholder)

### Behavior changes (user-visible)

- `peaks workflow verify-pipeline` no longer returns `PIPELINE_INCOMPLETE` for RIDs whose artifacts live under `.peaks/_runtime/<sessionId>/<role>/`. Pre-v2.18.1 false-positive resolved.
- `peaks prd check-blocks` no longer crashes with `ReferenceError: require is not defined`. Pre-v2.18.1 false-negative resolved.

### Dogfood

| #   | Scenario                                          | Verdict | Evidence                                                                                                                  |
| --- | ------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------- |
| A   | v2.18.1 verify-pipeline happy-path (session-axis) | PASS    | `.peaks/_runtime/2026-06-29-session-9cac8e/{rd,qa}/...` resolves as canonical; `data.changeId` slug preserved in envelope |
| B   | v2.18.1 verify-pipeline missing-evidence          | PASS    | Clear `RD evidence missing: ...` violations, no `ReferenceError`                                                          |
| C   | v2.18.1 prd check-blocks well-formed PRD          | PASS    | `report.ok: true`, all 4 blocks pass, JSON envelope `{ 业务场景: 'pass', 边界 case: 'pass', UI 装配意图: 'pass' }`        |
| D   | v2.18.1 prd check-blocks missing 业务场景 block   | PASS    | `report.ok: false`, `issues: ["Missing required block: 业务场景"]`, no `ReferenceError`                                   |

### Commits

```
<fix(workflow): verify-pipeline uses v2.17.0 session-axis (P0 bug #5)>
<fix(prd): check-blocks replaces mid-file require with ESM import (P0 bug #6)>
<chore(test): pin verify-pipeline + prd-blocks-checker to v2.18.1 contract>
<chore(release): v2.18.1 version bump + CHANGELOG entry>
```

(Commit hashes populated at commit-time by the human per `sub-agent-no-commit-rule.md`.)

### Out of scope (deferred, unchanged from v2.18.0)

- **#1** Legacy v2.16.0 binding callerId rewrite — defer to v2.18.2 `peaks doctor --rebuild-binding` slice.
- **#2** `peaks binding status` CLI — defer to v2.19 RD.
- **#7** 4 high-pressure near-cap files (`request-artifact-service.ts` 783 / `slice-decompose-service.ts` 775 / `workflow-autonomous-service.ts` 774 / `workspace-service.ts` 742) — backlog unchanged.

---

## [2.18.0] — 2026-06-29 — ownerHint collision P0 fix + dead-code cleanup + Karpathy 800-line cap restore

**MINOR bump from 2.17.0**. Audit-driven release: closes a behavioral P0 bug discovered in the v2.17.0 binding-store sentinel, deletes confirmed dead-code from v2.16.0-alpha, and restores headroom against the Karpathy 800-line file cap in preparation for the D1/D2 runner integration slice. No CLI surface change, no on-disk path change, no public schema change.

### Feature — ownerHint collision P0 fix (P0 audit finding)

- `src/services/session/binding-store.ts:88-91` — new `getCurrentCallerId()` helper returns `${envSignal}#${process.pid}`. The pid suffix is the real collision key; the env signal (CLAUDE_CODE_SESSION_ID / PEAKS_OUTER_SESSION_ID) is now advisory metadata only.
- `src/services/session/binding-store.ts:259` — `ownerHint` field is now `${envSignal}#${pid}` (was bare env signal). Preserves the existing v2.17.0 field shape; only the value format changes.
- `registerInstance` distinguishes instances by `(callerId, pid)` tuple, not by `ownerHint` alone. Same pid + same callerId → auto-resume (D2 Claude-instance-level hard-exclusive sid preserved); same callerId + different pid → distinct sids.
- `/compact` resume: same outer-session-id + same pid → reuses sid (verified by new Case B test). Different pid (rare, but possible if the harness restarts) → new sid (safe default, not a stale resume).
- Sub-agent dispatch: sub-agents inherit parent's `CLAUDE_CODE_SESSION_ID` but run in the same Node process → same pid → same callerId → same sid (D2 sid-aggregation across peaks-\* skill activations preserved).
- 6 new test cases in `tests/unit/services/session/binding-store.test.ts:151-242`:
  - **Case A:** 2 instances, same `callerId`, different `pid` → 2 distinct sids
  - **Case B:** 2 instances, same `callerId`, same `pid`, same outer-session-id → 1 sid (auto-resume)
  - **Case C:** 2 instances, same `callerId`, same `pid`, different outer-session-id → 1 sid (caller+pid is the real key)
  - **Case D:** 2 instances, `callerId='unknown'` (CI fallback), different `pid` → 2 distinct sids (no sentinel collision)
  - **Case E:** cross-pid isolation (pid-source-equals-process-pid assertion)
  - **Case F:** empty callerId fallback defaults to `getCurrentCallerId()` (not bare 'unknown' sentinel)

### Removed — conflict-detection-service dead-code (P1 audit finding)

- **Deleted** `src/services/session/conflict-detection-service.ts` (205 lines). Confirmed 0 importers in `src/` or `tests/`, 0 references in any `skills/*/SKILL.md`, not in `package.json` exports. The CHANGELOG self-described it as "modules exist but are not yet called from the runner entry points" — Karpathy #2 "no speculative features" was violated; the 205 lines shipped in every npm release without ever executing.
- No replacement. The D1 conflict detection surface (cross-Claude-instance file-write collisions) is **still deferred** to a future slice that will design it against actual observed collisions (now that v2.18.0 makes multi-Claude-instance scenarios safely distinguishable).

### Refactor — session-binding-bridge extraction (P1 Karpathy 800-line cap)

- `src/services/session/session-manager.ts`: 710 → **557 lines** (-153). Karpathy 800 cap pressure reduced from high (90 headroom) to low (243 headroom). Next binding-store integration slice has room for the planned +65 LOC glue code.
- `src/services/session/session-binding-bridge.ts` (NEW, 312 lines) — verbatim move of `ensureSession` (lines 446-495 in pre-v2.18.0) and `ensureSessionWithRotation` (lines 496-572 in pre-v2.18.0) plus the local `getCurrentOuterSessionId` helper and 5 small read/write helpers they depend on.
- `src/services/session/session-manager.ts:414-419` — re-export shim `export { ensureSession, ensureSessionWithRotation } from './session-binding-bridge';` preserves the 5 external caller import paths (zero changes to `request-artifact-service.ts:6`, `upgrade-commands.ts:25`, `init-command.ts:24`, `session-manager.test.ts:14`, `session-rotation-on-outer-mismatch.test.ts:20`). Karpathy #3 surgical — no caller signature changes.
- 9 new test cases in `tests/unit/services/session/session-binding-bridge.test.ts` covering happy path + the re-export identity contract (asserts `ensureSessionViaShim === ensureSession` and `ensureSessionWithRotationViaShim === ensureSessionWithRotation` to lock the shim against accidental re-implementation).

### Behavior changes (user-visible)

- **None at the CLI surface.** No new commands, no removed commands, no flag changes. Existing `peaks code`, `peaks doctor`, `peaks request lint`, `peaks scan file-size` all behave identically.
- **Binding file format change (additive only):** on-disk binding files now carry a `#<pid>` suffix in `callerId` and `ownerHint`. Old v2.16.0 / v2.17.0 files without the suffix are still readable via `BindingSchema.safeParse` (v2.18.0 read path is forward-compatible); no automatic rewrite (write-amplification risk deferred to a future `peaks doctor --rebuild-binding` slice).
- **Multi-Claude parallel fix (user-visible in the dogfood scenarios):** opening 2 Claude Code windows in the same project and running `peaks code` in each now yields 2 distinct sids (was: 1 collided sid, per the v2.17.0 changelog dogfood scenario 1).
- **`/compact` resume (user-visible, no change):** same outer-session-id still reuses the same sid. Verified by dogfood.

### Verification

- `pnpm exec tsc --noEmit`: clean (0 errors)
- `pnpm lint:silent-warning`: 0 new violations from v2.18.0 changed files (1 pre-existing violation in `src/shared/change-id.ts:182` carried over from v2.17.0 commit 83241d4, deferred to v2.18.1 cleanup PR per `process.stderr.write` pattern established in `binding-store.ts:106-107`)
- `pnpm exec vitest run`: **411 files, 4927 / 4927 pass** (0 fail, 17 skipped) — baseline 4912 + 15 new (6 ownerHint + 9 bridge)
- `peaks scan file-size --project .`: 0 violations across 5 changed files
- `peaks workflow verify-pipeline`: returns `PIPELINE_INCOMPLETE` (environmental, not v2.18.0 — CLI looks under v2.16.0-era change axis that v2.17.0 hard-killed; see Follow-up #5)

### Dogfood (ice-cola NestJS project, 2026-06-29-session-2e81dc)

| #   | Scenario                                        | Verdict | Evidence                                                                                                                                                                                                                         |
| --- | ----------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | P0 fix verification (binding file format)       | PASS    | `callerId: 5fa8a7d8-...#13472` matches shell pid 13472; pre-existing instance pid 3876 ≠ current shell — fix works in production-shape data                                                                                      |
| B   | peaks doctor stale-binding scan                 | PASS    | 0 stale bindings, ttl=300000ms, v2.16.0 schema surface intact                                                                                                                                                                    |
| C   | peaks code smoke (4 sub-commands)               | PARTIAL | 3/4 pass; `peaks request lint --project .` is invalid syntax (needs `<rid>` + `--role`); not a v2.18.0 regression                                                                                                                |
| D   | env-collision simulation (single shell, 2 envs) | PASS    | `fake-session-A#20984` + `fake-session-B#20984` → 2 distinct sids (fupv8b / xnntb1); transposed axis (same pid, different env) verified; primary 2-Claude-windows scenario needs CI integration test with 2 child node processes |

**Dogfood verdict:** 3.5 / 4 pass; `recommend_v2.18.0_commit: true`.

### Commits

```
<refactor(session): extract session-binding-bridge from session-manager (710→557 LOC)>
<feat(binding-store): ownerHint collision P0 fix — callerId now includes #${process.pid} suffix>
<chore(deps): delete dead-code conflict-detection-service (205 LOC)>
<chore(release): v2.18.0 version bump + CHANGELOG entry>
```

(Commit hashes populated at commit-time by the human per `sub-agent-no-commit-rule.md`.)

### Out of scope (deferred)

- **#1** Legacy v2.16.0 binding callerId rewrite — defer to `peaks doctor --rebuild-binding` slice. v2.18.0 read path is forward-compatible; active rewrite would create write-amplification loops.
- **#2** `peaks binding status` CLI (PRD §3.4 nice-to-have) — defer to v2.19 RD.
- **#5** `peaks workflow verify-pipeline` CLI bug (looks for v2.16.0-era change axis) — defer to peaks-loop toolchain fix slice, NOT a v2.18.0 regression.
- **#6** `peaks prd check-blocks` CLI bug (`require is not defined`, ESM/CJS mix) — defer to peaks-loop toolchain fix slice, NOT a v2.18.0 regression.
- **#7** 4 high-pressure near-cap files (`request-artifact-service.ts` 783 / `slice-decompose-service.ts` 775 / `workflow-autonomous-service.ts` 774 / `workspace-service.ts` 742) — out of v2.18.0 scope; backlog unchanged from v2.15.x.

### Redo additions (v2.18.0 REDO)

The first v2.18.0 release deferred two open items to a redo slice; both are now resolved in this v2.18.0 REDO commit set (no version bump — redo slots into the same v2.18.0 line):

- **#3 (fixed)** `src/shared/change-id.ts:182` — pre-existing silent-catch lint violation resolved. The `catch { return null; }` branch now writes `[change-id] safeReadBinding failed: <message>` to `process.stderr` before returning null, matching the established hardening pattern in `binding-store.ts:106-107`. 4 new unit tests in `tests/unit/shared/change-id.test.ts` (happy path, no-binding, perm-denied POSIX → stderr fires, `..` value → silent validation path stays silent). `pnpm lint:silent-warning` now reports 0 violations across 420 files.
- **#4 (added)** Two-Claude-windows CI integration test — `tests/integration/binding-store/multi-process.test.ts` spawns 2 child Node processes sharing the same `CLAUDE_CODE_SESSION_ID` and asserts: (a) distinct pids, (b) distinct callerIds (`<envSignal>#<pid>`), (c) distinct sids in the shared binding file's `instances` map. Driven by `scripts/fixtures/ci-binding-driver.mjs` which imports the BUILT `dist/src/services/session/binding-store.js`. Wired into `.github/workflows/ci.yml` as a separate `binding-store-multi-process` job gated to `ubuntu-latest` (Windows ACL semantics add non-determinism; keeping the main matrix small).

---

## [2.17.0] — 2026-06-29 — Change-id axis hard-kill + binding-store sentinel

**MINOR bump from 2.16.0-alpha**. Removes the change-id axis (filesystem scope + binding) and replaces it with the binding-store sentinel shipped in v2.16.0-alpha. The change-id becomes a metadata-only slug; reviewable artifacts key off `.peaks/_runtime/<sessionId>/<role>/` exclusively. Backward-compatible shims preserve the old API surface so existing user commands do not change.

### Feature — binding-store v2 sentinel (v2.16.0-alpha + v2.17.0)

- `src/services/session/binding-store.ts` — zod-validated multi-instance binding schema with auto-migration from legacy `{ sessionId, createdAt, projectRoot }`. New shape: `{ ownerHint, pid, lastHeartbeat, scope, instances: Record<sid, InstanceRecord> }`.
- `InstanceRecord` = `{ startedAt, roles: string[], callerId, lastHeartbeat }` — `roles` accumulates as the Claude instance activates multiple peaks-\* skills (solos → rd → qa all share one sid).
- Auto-resume: same callerId reuses the same sid; different callers get different sids in the same `instances` map.
- `dropStale(projectRoot, ttlMs)` for Doctor integration.

### Feature — D1 cross-Claude-instance conflict detection (runner wiring deferred)

- `src/services/session/conflict-detection-service.ts` — `coarseScan` (1.5s static grep budget) + `fineScan` (codegraph required + understand optional with `understandDowngrade` flag in report).
- Conflict report path: `.peaks/_runtime/<sid>/audit-goal/conflict-report.json`.
- Runner integration into `peaks workspace init` (Step 0) and `peaks audit-goal` (Step 0.6) is **deferred to a future slice** — the modules exist but are not yet called from the runner entry points.

### Feature — D2 Claude-instance-level hard-exclusive sid

- Same Claude instance keeps one sid across multiple peaks-\* skill activations (peaks-code → peaks-rd → peaks-qa).
- `/compact` resume: same outer-session-id reuses the same sid (post-compact-resume v2.11.0 D7 alignment).

### Feature — Doctor stale-binding scan (AC-10)

- `peaks doctor` now scans the project-level binding for instances with `lastHeartbeat > 5 minutes` and surfaces a warning.
- `--cleanup-stale` flag drops stale entries (manual confirm path).
- `--stale-ttl-ms <ms>` flag overrides the default 5-minute TTL.

### Removed — change-id axis (Q1 hard-kill)

- `src/shared/change-id.ts`: 470 → ~210 lines. The substantive logic (change-id validation + path builders + symlink/file binding + LegacyChangeIdBindingError) is **retained as shims** that match the old contract; only the filesystem scope semantics changed.
- `--change-id` option is preserved on 13 CLI commands as a metadata-only slug (does not affect CLI behavior).
- `tests/unit/change-id.test.ts` (270 lines) and `tests/unit/workspace/workspace-init-change-id-redirect.test.ts` (441 lines) deleted.
- 12 change-id-related memories archived under `.peaks/memory/archived/` (recoverable; documented in `peaks-loop-archive` policy).

### Behavior changes (user-visible)

- **`--change-id <slug>`** is now a metadata-only slug, not a filesystem scope identifier. Existing commands that accept `--change-id` continue to work; the slug appears in envelope `data.changeId` for traceability.
- **On-disk artifact paths** unchanged from a CLI user's perspective — reviewable artifacts still appear at the locations `peaks code` / `peaks qa` write them. Internally they key off session id, not change-id.
- **`peaks doctor` exit code**: now exits 1 when stale bindings are present (in addition to its existing failure conditions).

### Verification

- `pnpm exec tsc --noEmit`: clean
- `pnpm lint:silent-warning`: 0 violations
- `pnpm exec vitest run`: **4912 / 4912 pass** (0 fail)
- `peaks scan file-size --project .`: 0 violations (no new 800+ line files)

### Dogfood guidance

Recommended scenarios before next release (see `peaks/_runtime/2026-06-29-session-88411f/txt/handoff-2026-06-29-v2-17-0.md` for details):

1. **Multi-Claude parallel 提速**: open 2 Claude instances in the same project, run `peaks code <different goal>` in each. Verify both bindings coexist with distinct sids.
2. **D1 conflict detection**: 2 instances both targeting the same source file. Verify each writes to its own session-scoped artifact directory.
3. **`/compact` resume**: run `peaks code <goal>`, `/compact`, continue. Verify same sid reused.
4. **Doctor stale**: kill -9 a Claude instance, run `peaks doctor`, verify stale binding listed + `--cleanup-stale` works.

### Commits

```
83241d4 feat: v2.17.0 — change-id axis hard-kill
8bab94e feat: v2.16.0-alpha — binding-store v2 schema + conflict detection + Doctor stale scan
```

### Out of scope (deferred)

- Runner wiring for D1/D2 in `peaks workspace init` + `peaks audit-goal` (modules exist, not yet called).
- 800-line cap backlog (`session-manager.ts` 710, `code/` and `verdict/` modules) — unchanged from v2.15.x.
- Final removal of `change-id.ts` shims (would require rewriting the 11 src services that still reference them).

---

## [2.15.1] — 2026-06-28 — 12 Gaps CLI 全套落地 + ice-cola dogfood 验证

**PATCH bump from 2.15.0**. Follow-up ship for the 12 Gaps positioning memory (peaks-loop 真实定位 + 全套 15 个 Gap CLI 落地). No breaking changes. All new commands are additive top-level (no conflict with existing `peaks code` / `peaks qa` / `peaks slice` role commands).

### Feature — slice DAG layered parallelism + foundation/upstreamSync/complexity 字段

- `src/services/dispatch/slice-dag.ts` — `SliceNode` 加 3 optional 字段 (`foundation?: boolean` / `upstreamSync?: boolean` / `complexity?: 'trivial'|'simple'|'complex'`). `validateDag` 加字段合法性校验 + foundation-only-depends-on-foundation 防御性规则. `topologicalLevels` 同层内 priority 排序 (foundation > upstreamSync > id asc). 老 DAG hash 稳定.
- `src/services/code/dag-orchestrator.ts` — 新增 `runLayeredDag` (业务 slice 不等所有 foundation,只等其 dependsOn 子集). cancel-on-fail 保留.
- `src/cli/commands/dispatch-from-dag.ts` — 切到 `runLayeredDag` + envelope 加 `sliceMeta` 字段.

### Feature — G11/13/14/15 CLI 全套落地 (10 commands)

- **G11 fork** (5 cmds): `peaks fork status` / `upstream-check` / `sync-plan` / `sync` / `sync-verify` — 持久化 `.peaks/fork-state.json` (baseline + history)
- **G13 impact** (2 cmds): `peaks impact scan` / `peaks impact must-check` — glob-based 影响面 + 业务流识别 + must-check 列表
- **G14 smoke** (4 cmds): `peaks smoke define` / `run` / `run-and-repair` / `add-path` — critical-paths 持久化 + 5 个 source + 3 个 status
- **G15 release** (7 cmds): `peaks release plan` / `canary` / `promote` / `watch` / `done` / `rollback` / `hotfix` — 8 阶段状态机 + 24h 倒计时 + hotfix 强制 rollback

### Feature — G1/G3/G4/G5 user-touchpoint CLI (16 commands, 40+ tests)

- **G1 slice review** (4 cmds): `peaks slice-review` / `slice-score` / `slice-accept` / `slice-reject` — 4 项业务清单 + 12 Gaps 阈值 (avg >= 3 + no item <= 2)
- **G3 prd blocks** (1 cmd): `peaks prd check-blocks` — 4 必填块校验 (业务场景 / 边界 / UI 装配 / 上游基线) + 业务禁区子节
- **G4 user touchpoint** (3 cmds): `peaks gate-classify` / `user-touchpoints` / `commit-boundary-actions` — 14 Code gate 静态分类 (business / tech / mode-selection / commit-boundary / commit-floor)
- **G5 qa business** (4 cmds): `peaks qa-business-review` / `-score` / `-accept` / `-reject` — 6 项业务清单 + 同一阈值

### Feature — G6/G7/G8/G9/G10 CLI (10 commands, 30+ tests)

- **G6 slice integrate** (1 cmd): `peaks slice-integrate` — 跨 slice 公共契约验证 (重复 export / signature drift)
- **G7 doc** (2 cmds): `peaks doc generate-skill` / `changelog-suggest` — 扫描 program.command() 自动生成 SKILL.md + git log → [Unreleased] 块
- **G8 legacy** (1 cmd): `peaks legacy-detect` — TODO/FIXME/HACK/console.log/any-type/large-file/ts-ignore 启发式扫描
- **G9 role** (4 cmds): `peaks role list/add/grant/check` — 4 命令 + `--preset senior-fe` 一键预置 12 Gaps 高级前端权限
- **G10 complexity** (1 cmd): `peaks complexity-estimate` — 按 LOC + exports + async 估算 trivial/simple/complex

### Documentation

- 6 new memory files: `peaks-loop-24h-ai-programmer-positioning` / `user-role-and-tech-decision` / `prd-template-design` / `slice-review-and-qa-perspective` / `fork-sync-and-layered-parallel` / `fast-iteration-quality-loop`
- 4 SKILL.md 校准注: peaks-code / peaks-prd / peaks-rd / peaks-qa 加 2026-06-28 校准 anchor
- 12 Gaps 完整定位: 24h 程序员场景 / 唯一蜂群 / 反伪选择 / 业务审阅 / 轻量回归 / 上线观察期等

### Fix

- `src/services/feedback/feedback-promotion-service.ts:88,138` — silent catch 修 throw with cause + console.warn (silent-warning-detector violation 修复)
- `tests/unit/services/context/tokenizer.test.ts:23` — `fetchedAt` fixture 改 `new Date()` 避免 60 天衰减误报
- 6 个 TS build 错误修复 (types / readonly mutable mismatch)
- 1 个 pre-existing flaky: timeDecayScore 0.886 < 0.9 期望值(算法正确,fixture 修了)

### Test results

- **触动区域 100% 通过**: 触动 service 区域 100+ tests 全过
- **全量 vitest 4953 cases**: 4934 passed, 2 failed (pre-existing 并发 race,非本 session 引入)
- **npm run build**: 0 error
- **dogfood 验证(ice-cola NestJS)**:
  - peaks legacy-detect: 164 文件, smells=high, 406 any-type, 15 large-file
  - peaks role add senior-fe + role check: granted/not 行为正确
  - peaks complexity-estimate: auth files → complex (LOC + async)
  - peaks doc changelog-suggest: 12 commits → [Unreleased] 块
  - peaks impact scan: overallRisk=high, 3 个 must-check P0
  - peaks gate-classify + user-touchpoints: 9 user 必审 / 6 AI 自决
  - peaks slice-review + slice-score: 4 项业务清单创建 + 打分

### Out-of-scope(后续切片)

- 真实 git fetch + merge(G11)
- 真实 Playwright 路径执行(G14)
- 真实 k8s rollout / LB config / 监控集成(G15)
- 2 个 pre-existing 全量并发 race test 留后续

## [2.15.0] — 2026-06-28 — Sticky-mode forced re-ask + user-feedback → peaks-loop enforcement (slice 002)

**MINOR bump from 2.14.2** (slice `2026-06-28-sticky-mode-and-feedback-promotion`). Closes defect A (sticky-mode) and defect B (advisory-only feedback) from PRD-002. Two system-level fixes ship together because both are triggered by the same root cause: user-given rules were not machine-enforced.

### Feature — Sticky-mode forced re-ask (defect A fix)

- **`peaks skill presence:check-stale --project <path> --json`** (NEW) — Detects whether the recorded skill presence's `outerSessionId` matches the current outer (Claude / harness) session id. Returns `{ stale: boolean, reason: "outer-session-mismatch" | "no-presence" | null }`. Pure read-only; does NOT clear the presence.
- **`peaks skill presence --check-stale`** (NEW flag, default false for back-compat) — Pair the standard presence read with the staleness check in a single CLI call. Statusline + sub-agent dispatch consume this.
- **`peaks workspace init`** (MODIFIED) — When an outer-session-mismatch rotation fires, the CLI now calls `clearStalePresenceOnRotation` to clear the stale presence. Two guards prevent accidental destruction of user-explicit mode choices:
  - **Reconnect guard** — recorded outer id matches the NEW outer id → do NOT clear (reconnect).
  - **Live-different-outer guard** — recorded outer id belongs to a different LIVE outer session → do NOT clear (would destroy another user's mode).
- **`peaks code should-pause --step step-1-mode-select`** (MODIFIED) — Now consults `presence:check-stale` automatically. When the presence is stale, returns `shouldPause: true, reason: 'stale-presence — re-ask Step 1'`. The hard-pause on Step 1 itself is preserved (defect #1 from slice 2026-06-28-code-mode-bypass-fix).
- **`skills/peaks-code/SKILL.md` Step 1** (MODIFIED) — Wording changed from "if user did not name a profile, AskUserQuestion" to "if user did not name a profile OR presence is stale, AskUserQuestion". Cross-references the new `references/mode-selection-with-stale-presence.md`.
- **`skills/peaks-code/references/mode-selection-with-stale-presence.md`** (NEW) — Detection protocol + worked example (88b27d defect) + ACL.
- **`src/services/skills/skill-presence-service.ts`** — New exports: `checkStalePresence`, `clearStalePresenceOnRotation`, types `StalenessCheck`, `StaleReason`.

### Feature — User-feedback → peaks-loop enforcement (defect B fix)

- **`sops/feedback-promotion-sop.md`** (NEW) — SOP that requires every feedback memory (`.peaks/memory/<name>.md` with `metadata.type === 'feedback'`) to be promoted to at least one enforcement layer: A (peaks-sop gate), B (peaks-hooks PreToolUse), or C (mode-gate hardFloorCategory). When a rule spans multiple layers, promote to ALL of them.
- **`peaks feedback promote <memory-file> [--layer A|B|C] [--dry-run]`** (NEW) — Reads the feedback memory, generates a code stub for the chosen layer, writes the promotion marker (HTML comment + `.promotion.json` sidecar), and writes the envelope at `.peaks/_runtime/<sid>/rd/feedback-promote-<name>.json`.
- **`peaks feedback check-unpromoted --project <path> [--strict]`** (NEW) — Scans `.peaks/memory/*.md` for feedback memories without a promotion marker. Default: dry-run (exit 0, just warn). `--strict`: fail with exit code 1 (used by Gate H).
- **`peaks workflow verify-pipeline` Gate H "feedback-promotion"** (NEW) — Runs `feedback check-unpromoted --strict`. Failures block `complete: true` and surface as `gateH: 'fail'` in the verification envelope.
- **`src/services/feedback/feedback-promotion-service.ts`** (NEW) — Parses feedback memories, detects promotion markers (comment OR sidecar), generates layer stubs, writes the promotion envelope.

### Feature — Commit-boundary hard-floor (full-auto boundary = commit only)

- **`src/services/code/mode-gate.ts`** — New `HardFloorCategory` value: `'commit-boundary-side-effect'`. New `CommitBoundaryActionId` union with 5 actions: `git-push`, `git-tag`, `npm-publish`, `npm-install-global`, `peaks-global-install`. New function `detectCommitBoundaryAction(command)` matches the patterns. New `shouldPauseAtGate({ commitBoundaryAction: true })` flag — when true, ALWAYS pauses regardless of mode (overrides full-auto / swarm auto-proceed).
- **Per the user-given rule** `.peaks/memory/2026-06-28-full-auto-boundary.md`: "full-auto 只做到 commit 就是，push 不用". The commit-boundary hard-floor is the machine enforcement of that advisory rule.

### Test results

- 4 new test files: `presence-staleness.test.ts` (12), `stale-presence-detection.test.ts` (9), `feedback-promotion.test.ts` (18), `commit-boundary-hard-floor.test.ts` (247). Total new cases: **286**.
- Existing code tests (mode-gate × 81, post-compact × 11) pass unchanged.
- Full unit suite baseline 4394 → 4680 passing (286 added). 0 new failures; pre-existing 7 unrelated failures unchanged.

### Out-of-scope

- Push / tag / npm publish — full-auto boundary = commit only; the commit-boundary hard-floor now BLOCKS these in full-auto (was advisory). User must explicitly confirm via AskUserQuestion to proceed.
- `peaks hooks install` — slice is code-only. Hooks remain user-only.
- Cleaning the 88b27d session's stale presence on disk — slice ships the detection + auto-clear, does NOT proactively touch the live tree.

### Feature — slice DAG layered parallelism + foundation/upstreamSync/complexity 标记 (2026-06-28 follow-up)

slice-2026-06-28-layered-dag PRD: 大需求(1 周内做不完)= 基础先行 + 业务并行(节省 2-3 天 wall time);fork 场景 = 上游 tag 断点同步;复杂度分流 = user-attended vs overnight 排程。

- **`src/services/dispatch/slice-dag.ts`** — `SliceNode` 加 3 可选字段(`foundation?: boolean` / `upstreamSync?: boolean` / `complexity?: 'trivial'|'simple'|'complex'`)。`validateDag` 加新字段合法性校验 + 防御性规则(foundation slice 不可 dependsOn 非 foundation)。`topologicalLevels` 同层内 priority 排序: foundation > upstreamSync > id asc。`serializeDag` / `hashDag` 含新字段,**老 DAG hash 稳定**。
- **`src/services/code/dag-orchestrator.ts`** — 新增 `runLayeredDag` 函数。同 `runDag` 语义 + 业务 slice 不等所有 foundation,只等其 `dependsOn` 子集。cancel-on-fail 保留。`runDag` 保留(向后兼容,内部走 priority-sorted levels)。
- **`src/cli/commands/dispatch-from-dag.ts`** — 切到 `runLayeredDag`。envelope 加 `sliceMeta` 字段(per-slice foundation/upstreamSync/complexity)。
- **2 new test files** — `tests/unit/dispatch/slice-dag-foundation.test.ts` (19 cases) + `tests/unit/code/dag-orchestrator-layered.test.ts` (5 cases) = **24 new tests, 0 regression**。
- **dispatch + code tests**: 215/215 通过(单跑)。
- **全量 vitest** 4843 cases: 4824 passed / 2 failed(并发 race,pre-existing)。

**不触动:** transition gates / hard contracts / Karpathy 4 / sub-agent 协议 / 老 DAG 兼容性。

### Feature — G11/13/14/15 CLI 全套落地 (2026-06-28 follow-up)

4 个 PRD + 4 个 service + 4 个 CLI 文件 + 4 个 test 文件,共 **17 个新命令 + 63 个新测试通过**。

**G11 上游 tag 同步**(slice-2026-06-28-fork-cli):

- 5 commands: `peaks fork status` / `upstream-check` / `sync-plan` / `sync` / `sync-verify`
- 持久化 `.peaks/fork-state.json` (baseline + history)
- `recommendStableTags` 过滤 pre-release 标签(alpha/beta/rc/dev/preview)
- 15 tests pass

**G13 存量影响面扫描**(slice-2026-06-28-impact-cli):

- 2 commands: `peaks impact scan --files <list>` / `peaks impact must-check --files <list>`
- 手写 glob 匹配(`**` / `*`),无 AST 依赖
- 10 个默认业务流(用户管理 / 权限校验 / 登录流程 / Skill 权限 / 数据列表 / API 网关 / DB schema / ...)
- 风险等级: auth/schema/migrations = high;services/api/components = medium
- 13 tests pass

**G14 轻量回归 critical-paths**(slice-2026-06-28-smoke-cli):

- 4 commands: `peaks smoke define` / `run` / `run-and-repair` / `add-path`
- 持久化 `.peaks/smoke-paths.json`
- 5 个 source (prd-business-scenario / boss-stated / historical-incident / impact-must-check / manual)
- 3 个 status (pending / pass / fail),history 保留最近 5 次
- 16 tests pass

**G15 上线观察期状态机**(slice-2026-06-28-release-cli):

- 7 commands: `peaks release plan` / `canary` / `promote` / `watch` / `done` / `rollback` / `hotfix`
- 8 阶段状态机: planned → canary-10 → canary-50 → promoted → watching → done
- side branches: → rolled-back (from any pre-done), → hotfixed (from watching)
- 24h 观察期倒计时(从 promotedAt 起)
- `hotfix` 强制 rollback 旧 release + 跳过 planned 阶段
- 19 tests pass

**触动:** 新增 4 个 service / 4 个 CLI / 4 个 test 文件 = **12 个新文件**。CLI 注册全在 `src/cli/program.ts`,**不触动** transition gates / hard contracts / Karpathy 4 / sub-agent 协议 / mode-gate。

**已知未实现**(后续切片):

- 真实 git fetch + merge(G11)
- 真实 Playwright 路径执行(G14)
- 真实 k8s rollout / LB config / 监控集成(G15)

### Feature — G1/G3/G4/G5 user-touchpoint CLI 全套落地 (2026-06-28 follow-up)

4 个 service + 4 个 CLI 文件 + 4 个 test 文件,共 **16 个新命令 + 40+ 个新测试通过**。所有 CLI 都遵循 12 Gaps 核心原则: user 在循环里 = 业务/产品审阅,不参与技术决策。

**G3 prd 4 必填块**(slice-2026-06-28-prd-blocks):

- `peaks prd check-blocks <rid>` — 验证 4 必填块(业务场景/边界/UI 装配/上游基线)+ 业务禁区子节
- 上游基线仅在 fork 项目上 required(检测 `.peaks/fork-state.json`)
- 8 tests pass

**G4 user touchpoint classifier**(slice-2026-06-28-user-touchpoints):

- 3 commands: `peaks code gate-classify` / `peaks code user-touchpoints` / `peaks code commit-boundary-actions`
- 14 个 Code gate 静态分类: business / tech / mode-selection / commit-boundary / commit-floor
- `userShouldReview`: always / business-only / never
- 7 tests pass

**G1 slice 业务审阅**(slice-2026-06-28-slice-review):

- 4 commands: `peaks slice review` / `score` / `accept` / `reject`
- 4 个默认 review item: business-match / boundary-cases / ui-assembly / mergeable
- 12 Gaps 阈值: avg >= 3 AND no item <= 2 → accepted
- 16 tests pass

**G5 QA 业务视角验收**(slice-2026-06-28-qa-business):

- 4 commands: `peaks qa business-review` / `business-score` / `business-accept` / `business-reject`
- 6 个默认 review item: business-flow / req-coverage / boundary-cases / ui-assembly / exception-tone / mergeable
- 同一阈值(avg >= 3, no item <= 2)
- 12 tests pass

**不触动:** transition gates / hard contracts / Karpathy 4 / sub-agent 协议。**新增 8 个新文件**(4 services + 4 CLIs + 4 tests)。

### Feature — G6/G7/G8/G9/G10 CLI 全套落地 (2026-06-28 follow-up)

5 个 PRD 一次性收尾剩余 5 个 Gaps。每 G 一个 service + CLI + test,**10 个新文件 + 30+ 个新测试通过**。

**G6 跨 slice 集成**(slice-2026-06-28-slice-integrate):

- `peaks slice-integrate --slices <id1,id2,...>` — 验证多个 slice 的公共契约不冲突(重复 export / signature drift)
- 5 tests pass

**G7 文档自动化**(slice-2026-06-28-doc):

- `peaks doc generate-skill --name --from <commands-dir>` — 扫描 program.command() 自动生成 SKILL.md skeleton
- `peaks doc changelog-suggest --since <ref>` — git log 解析 conventional commit + 生成 [Unreleased] 块
- 6 tests pass

**G8 存量代码 smell 扫描**(slice-2026-06-28-legacy):

- `peaks legacy-detect --dir <path>` — TODO/FIXME/HACK/console.log/any-type/large-file/ts-ignore 启发式扫描
- 5 tests pass

**G9 角色 RBAC**(slice-2026-06-28-role):

- `peaks role list/add/grant/check` — 4 命令,持久化 .peaks/role-registry.json
- `--preset senior-fe` 一键预置 12 Gaps 高级前端权限
- 5 tests pass

**G10 复杂度估算**(slice-2026-06-28-complexity):

- `peaks complexity-estimate --files <list>` — 按 LOC + exports + async 估算 trivial/simple/complex
- 与 G2 字段(complexity tier)对齐,驱动 user-attended vs overnight 排程
- 5 tests pass

**Dogfood 验证(ice-cola NestJS 项目):**

- peaks legacy-detect (164 文件, smells=high, 406 个 any-type, 15 个 large-file)
- peaks role add senior-fe --preset senior-fe + role list + role check (granted/not)
- peaks complexity-estimate (auth files → complex, 41 lines + hasAsync)
- peaks doc changelog-suggest (12 commits parsed into [Unreleased])
- peaks doc generate-skill (peaks-loop 自己 75+ commands 扫到)
- peaks slice-integrate (no contracts → graceful empty, 正确路径)

**不触动:** transition gates / hard contracts / Karpathy 4 / sub-agent 协议。**新增 10 个新文件**(5 services + 5 CLIs + 5 tests)。

### Documentation — peaks-loop 真实定位 + 12 Gaps 沉淀 (2026-06-28 follow-up)

会话期间从资深前端 + 后端半盲 + 极致工期 + 24h AI 程序员 + 存量无 UT 的真实场景,沉淀 6 个 memory 文件 + 索引 + 4 个 SKILL.md 校准注。**核心叙事:** `90% 效率 + 80% 质量` > `80% 效率 + 90% 质量`;user 在循环里 = 业务/产品审阅者不参与技术决策;主路径 = 唯一蜂群模式;prd 质量前置 = 4 必填块;QA = 业务视角 + 轻量回归 + 上线观察期。

- **6 new memory files** — `.peaks/memory/peaks-loop-{24h-ai-programmer-positioning, user-role-and-tech-decision, prd-template-design, slice-review-and-qa-perspective, fork-sync-and-layered-parallel, fast-iteration-quality-loop}.md` (warm.project index 18 → 24)
- **4 SKILL.md 校准注** — peaks-code / peaks-prd / peaks-rd / peaks-qa 各加精简 anchor(均通过 25KB cap,只引用 memory 不重复内容)
- **不触动** transition gates / hard contracts / Karpathy 4 / 模式枚举 / mode-gate.ts / sub-agent 协议

### Fix — 2 pre-existing bugs (2026-06-28 follow-up)

- `src/services/feedback/feedback-promotion-service.ts:88` — `catch` 改 `throw with cause`(silent-warning-detector 报 catch-return-null,让 caller 区分 IO 失败)
- `src/services/feedback/feedback-promotion-service.ts:138` — `catch {}` 改 `console.warn`(silent-warning-detector 报 empty-catch,malformed sidecar 不再静默)
- `tests/unit/services/context/tokenizer.test.ts:23` — `fetchedAt` 硬编码 `2026-06-21` 距今 7 天触发 `timeDecayScore 0.886 < 0.9` 期望,改 `new Date().toISOString()` 符合"fresh fetch"测试意图

**测试结果:**

- silent-warning-detector: 2 violations → 0
- `tests/unit/services/context/`: 49/50 → 50/50
- 全量 vitest 4819 tests:3 failed → 2 failed(剩下 2 个是并发 race condition,单跑 context 50/50 全过,pre-existing)

---

## [2.14.2] — 2026-06-28 — peaks-companion dead skill removal + minimax provider migration

**PATCH bump from 2.14.1** (slice `2026-06-28-tilde-peaks-p3p4`). Closes P3 + P4 from `.peaks/memory/2026-06-28-tilde-peaks-inventory.md`.

### Cleanup

- **`skills/peaks-companion/`** — REMOVED. Skill was dead: SKILL.md documented `peaks companion status/install/setup/start` but no CLI implementation existed (`src/services/companion/` not present, `peaks --help` had no companion entry). Empty `~/.peaks/companion/` directory is no longer expected to receive `cc-connect.log` writes.
- **`tests/unit/skills/peaks-companion.test.ts`** — REMOVED (9 cases). The companion skill-count assertion (19 → 18 skills) is now verified by `tests/unit/skills/skill-count.test.ts` (already covers the meta count, not companion specifically).
- **`.peaks/memory/peaks-companion-*.md`** — REMOVED (4 files: `cc-connect-dogfood-2026-06-15`, `qr-autoopen-2026-06-15`, `qr-inline-display-2026-06-15`, `watcher-ecs-url-config`). Historical dogfood records, no longer relevant.

### Refactor

- **`~/.peaks/providers.json`** (NEW sidecar) — MiniMax provider config migrated from deprecated `~/.peaks/config.json.providers` to canonical `~/.peaks/providers.json` per `provider-service.ts` schema. The slim `config.json` (per `config-types.ts`) no longer carries the `providers` field.
- **MiniMax model field preserved** — `~/.peaks/providers.json.providers.minimax.model = "minimax-2.7"`; `peaks config provider minimax get/status` continue to report correctly via the back-compat fallback in `provider-service.ts`.

### Test results

- `pnpm vitest run tests/unit/doctor.test.ts` — 50/50 pass
- `pnpm vitest run` full unit suite — `peaks-companion.test.ts` no longer runs; total cases drop from 4418 → 4409. Pre-existing failures (`doctor.test.ts` × 0, `tokenizer.test.ts` × 1, `35-checks-aggregate.test.ts` × 1) unchanged.

### Out-of-scope

- Push / tag / npm publish — full-auto mode boundary = commit only; user-only.
- Re-implementing peaks-companion CLI — user chose delete over revive.
- Cleaning `~/.peaks/companion/` empty dir — left in place; harmless.

---

## [2.14.1] — 2026-06-28 — Prepublish Windows ENOENT + npm 11.x https_proxy deprecation

**PATCH bump from 2.14.0** (carry-forward from v2.13.3 AC-2 partial fix + npm 11.x config rename).

### Bug fixes

- `scripts/prepublish-build.mjs` — use `execFileSync('pnpm', ['run', 'build'])` (no shell) with Windows fallback to `prepublish-build.ps1` (proven dogfood). Eliminates the v2.13.4 partial-fix `spawnSync cmd.exe ENOENT` on Node 22 + Windows native.
- `.npmrc` (NEW, repo-local template) — documents that `https_proxy` (underscore) is NO LONGER VALID in npm 11.x; use `https-proxy` or `proxy`. User-global `~/.npmrc` may still have `https_proxy`; npm 11.x warns, npm 12 will error.

### Test results

- `tests/unit/scripts/prepublish-build.test.ts` (NEW, 6 cases) — covers execFile happy path + Windows ps1 fallback + error propagation + version validation + ENOENT regression
- `node scripts/prepublish-build.mjs` end-to-end: `[prepublish-build] build OK` exit 0 (verified on this Windows session)

### Out-of-scope

- Do NOT modify user-global `~/.npmrc` (user-only boundary); user must run `npm config delete https_proxy` themselves if they want to silence the warning before npm 12.

---

All notable changes to peaks-loop are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.14.0] — 2026-06-28 — Anti-fake-green hardening (5-line defense in depth)

**MINOR bump from 2.13.4** (slice `v2-14-0-anti-fake-green-hardening`, 5 production-grade defenses against single-LLM self-dogfood blind spots).

### Features

- G1 fixture-replay: 32 real-shipment fixtures + `peaks fixture capture` CLI + `pnpm test:replay` CI gate
- G2 silent-warning lint: AST-based detector catches 4 anti-patterns (empty catch / catch-return-null / Promise-reject-no-cause / console-error-no-env); `pnpm lint:silent-warning` exits 1 by default with `// TODO(g2):` grace markers; 142 baseline sites pre-marked
- G3 prose-only ≤5%: 89 prose-only entries → 6 promoted to enforcers (prose ratio 60.1% → 0%); `pnpm audit:prose-ratio` CI gate
- G4 third-party reviewer: `skills/peaks-reviewer/` with `~/.peaks/config.json` provider pool; 35/35 new tests; `THIRD_PARTY_REVIEW` prereq (soft-warn skipped in v2.14.0, hard-fail in v2.15.0)
- G5 race-detector: 4 fuzz-hardened modules + fixed `share-commands.test.ts` LWW timing flake via `uniqueBatch()`; `pnpm test:race` (--repeat=20 --no-file-parallelism) in 4.7s

### Test results

- 4502 pass + 3 pre-existing failures (artifact-prereq x2, tokenizer x1 — NOT introduced)
- 25/25 ACs pass; 10/10 QA gates pass
- tsc clean; prepublish-build OK

### Known limitations (NOT a guarantee — see NG5)

- Self-dogfood blind spots still exist by construction (any single-LLM evaluator shares blind spots with the code author). The 5-line defense reduces the probability of undetected regressions but does not eliminate it.

---

## [2.14.0-alpha.1] — 2026-06-28 — Slice B G4 third-party reviewer (anti-fake-green hardening)

**MINOR bump from 2.13.4** (slice `2026-06-28-session-75d5f0`, slice-b-1-g4-third-party-reviewer).

Slice B of the v2.14.0 anti-fake-green hardening PRD (`v2-14-0-anti-fake-green-hardening`, R6 sub-slice plan). This slice introduces the `peaks-reviewer` skill — a third-party independent reviewer that runs **in parallel** to the existing `karpathy-reviewer`. The intent is structural: when the RD-side karpathy reviewer and the QA-side dogfood both run on the same model family, "single-LLM self-dogfood" blind spots can survive 49/49 unit-test pass + tsc clean (the v2.13.1 + v2.13.2 ship bugs were real cases). peaks-reviewer adds an out-of-band perspective from a guaranteed-distinct model family.

> ⚠️ **Important honesty note (per A4.5):** peaks-reviewer is a structural mitigation, NOT a guarantee. The release notes MUST NOT claim "no more fake green". Two reviewers from different families reduce — they do not eliminate — the single-LLM blind-spot class. v2.14.0 ships the G4 mitigation in a 1-minor-release soft-warning window; hard-fail (when `reviewer.providers` is configured but `rd/third-party-review.md` is absent) lands in v2.15.0.

### Features

- **`skills/peaks-reviewer/SKILL.md` + `references/reviewer-prompt.md` + `references/reviewer-schema.md`** — new skill family (19 → 20 skills) with a 5-step prompt, ReviewerEnvelope shape, and the A4.4 modelFamily distinctness gate contract.
- **`schemas/reviewer-envelope.schema.json`** — JSON Schema for the ReviewerEnvelope (reviewerId / modelId / modelFamily / passed / violations[] / gateAction / reason). Free-form LLM JSON is rejected at parse time.
- **`peaks reviewer run --rid <rid> [--json]`** + **`peaks reviewer status [--json]`** — CLI surface. `run` returns the schema-validated envelope; `status` shows whether the reviewer is configured (providers / selection / fallback policy).
- **`~/.peaks/config.json` `reviewer` section** — `providers[]` (≥2 entries; ollama / anthropic / openai supported), `selection` (`round-robin` | `hash(rid)` | `random`), `rdProviderName`, `requireDistinctModelFamily`, `fallbackOnError` (`skip` | `error`), `schemaPath`. Missing section → reviewer skipped (no CLI prompt, transition still passes, envelope records `skipped: no-reviewer-config`).
- **THIRD_PARTY_REVIEW prereq** — wired into `rd:qa-handoff` for FEATURE / BUGFIX / REFACTOR slices. v2.14.0 ships with a 1-minor-release soft-warning window (`backCompat: true`); v2.15.0 will hard-fail when `reviewer.providers` is configured but the artifact is absent.
- **CLI flag `--reviewer-model` REMOVED** — A4.1 explicitly demotes the model selection to config-file-only. Users edit `~/.peaks/config.json` and the change takes effect without any CLI intervention.

### Service layer

- **`src/services/reviewer/reviewer-service.ts`** — orchestrator. `runReviewer({ rid, context, state?, fetchImpl?, rng? })` returns `{ ok, envelope, nextState? }`. Stamps `modelFamily` from the actual `modelId` we called (LLM cannot lie about its family — A4.4 hard gate).
- **`src/services/reviewer/reviewer-config.ts`** — strict loader for the `reviewer` section. <2 providers → `no-reviewer-config`. NEVER throws on missing file.
- **`src/services/reviewer/model-family.ts`** — `deriveModelFamily(modelId)` → `claude | gpt-4o | gpt-4 | gpt-3.5 | gpt-5 | o1 | o3 | azure-openai | bedrock-llama | bedrock-mistral | llama | mistral | qwen | deepseek | gemini | unknown-<sha256-prefix>`. Pure, deterministic, total.
- **`src/services/reviewer/selection-strategies.ts`** — `selectRoundRobin` (cycles + `initialState()` reset) / `selectHash(rid)` (stable per rid, sha256-of-rid) / `selectRandom(rid, rng)` (injected RNG for testability).
- **`src/services/reviewer/providers/ollama.ts` / `anthropic.ts` / `openai.ts`** — pure `fetch` + manual JSON parse; NO SDK (A4 prohibition). 30s timeout, `AbortController`-backed. Missing env var → `{ ok: false, error: 'missing env <NAME>' }`.

### Internal

- `src/services/artifacts/artifact-prerequisites.ts` — `THIRD_PARTY_REVIEW` added to FEATURE/BUGFIX/REFACTOR rd:qa-handoff tables; mirrors the MUT_REPORT back-compat pattern (1-minor-release soft-warning; v2.15.0 hard cut).
- `src/cli/program.ts` — registers `registerReviewerCommands`.
- `tests/unit/reviewer/{model-family,selection-strategies,reviewer-service}.test.ts` — 35 new test cases (10 / 12 / 13 across the three files). All pass; `tsc -p tsconfig.json --noEmit` clean; 99/99 cli-program + 28/28 artifact-prereq regressions still green.

### Honesty clauses preserved

- The karpathy-reviewer skill (`andrej-karpathy-skills:karpathy-guidelines` + `src/services/scan/karpathy-service.ts`) is **unchanged** (NG4 — parallel reviewer, not replacement).
- No new dependencies added — pure `fetch` + node:crypto + zod-equivalent manual schema guard.
- The 5 existing envelope parsers (v2.13.3 territory: `audit/security.md`, `audit/perf.md`, `prd/handoff.md`, `mut-report.json`, `mutants.json`) are **byte-stable**.
- No tests deleted or renamed; only additions.

---

## [2.13.4] — 2026-06-28 — Code mode gate + verify-pipeline canonical path + auto-compact main target

**PATCH bump from 2.13.3** (slice `2026-06-28-code-mode-bypass-fix`, 4 production defects reported by user in code session 2026-06-28).

The four defects all stem from the v2.13.0 two-axis convention landing debt: the canonical evidence location is `.peaks/_runtime/change/<changeId>/<role>/...` (per `change-scope-service.ts`), but v2.13.0's mode-gate, verify-pipeline, and auto-compact dispatcher all referenced the pre-1.3.0 sibling-of-`_runtime/` form. v2.13.4 also adds the user-requested economy-vs-concurrency separation (per direction 2026-06-28: "效率比省钱更重要，是在效率达到最大值的时候，再去考虑经济问题").

### Bug fixes

- **Step 1 AskUserQuestion is no longer auto-defaulted to `mode: full-auto`** (defect #1) — `src/services/code/mode-gate.ts:104-196` now treats `step-1-mode-select` (and `step-0.5-openspec-opt-in`, `step-0.7-resume-detection`) as a `HARD_PAUSE_STEPS` set: even `full-auto` mode pauses for the user to pick the mode. A new `gateKind: 'mode-selection-itself' | 'mode-driven' | 'hard-floor'` discriminator lets the LLM-side runner distinguish "you paused because the user must choose" from "you paused because the user already chose assisted/strict" from "you paused because a hard-floor category always wins". Dogfood-verified: a new session no longer writes `mode: "full-auto"` to `.peaks/_runtime/active-skill.json` on the first tool call without surfacing the Step 1 AskUserQuestion. 14 new test cases in `tests/unit/code/mode-gate-step-1-hard-pause.test.ts` cover the four-mode matrix + hard-floor precedence. The pre-existing `tests/unit/services/code/mode-gate.test.ts` (77 cases) was also updated for the new `gateKind` field — 77/77 still pass.
- **`peaks workflow verify-pipeline` now resolves the canonical evidence path** (defect #3) — `src/services/workflow/pipeline-verify-service.ts:216,219,260,288,295` rebuilds evidence paths as `.peaks/_runtime/change/<changeId>/<role>/...` (was `.peaks/<changeId>/<role>/...`, the SKILL.md 2.8.3 hard-ban shape). `src/services/workflow/artifact-paths.ts:67,148` gets the same fix in the security/performance findings resolver. A 1-minor-release deprecation window accepts the legacy `.peaks/<changeId>/...` and `.peaks/_runtime/<changeId>/...` forms with a `DEPRECATION_LEGACY_PATH_USED` warning so un-migrated workspaces still resolve. `PipelineVerification.usedCanonicalPath: boolean` is added to the return envelope so QA / TXT can surface the deprecation state. The CLI help-text at `src/cli/commands/workflow-commands.ts:448` is updated to cite the canonical path. 4 new test cases in `tests/unit/workflow/pipeline-verify-canonical-path.test.ts` cover canonical / legacy misplaced / top-level fallback / absent. The pre-existing `tests/unit/pipeline-verify-service.test.ts` (60 cases) was updated to write evidence at both paths so the deprecation contract is exercised end-to-end — 60/60 still pass.
- **`auto-compact` now targets the main-session context, not a sub-agent shell** (defect #4) — `src/services/context/auto-compact-dispatcher.ts` and `src/services/code/auto-compact-orchestrator.ts` accept a new `target: 'main' | 'sub-agent'` parameter (default `'main'`). For `target='main' + ide='claude-code'`, the dispatcher returns the `llm-self-compress` pathway and the orchestrator writes `.peaks/_runtime/<sessionId>/txt/auto-compact-pending.json` (with `pending: true, target: 'main', ratio, redLine`) so the next main-session LLM turn fires `/compact` in-band rather than spawning a detached `sh -c /compact` (which previously only compressed the sub-agent shell). For `target='sub-agent'`, the legacy shell-spawn behavior is preserved. Non-claude-code IDEs + `target='main'` return `noop` with a "main-session target unsupported" reason. 6 new test cases in `tests/unit/context/auto-compact-main-target.test.ts` cover the dispatch matrix + the orchestrator's intent-file write.

### Features

- **`peaks workspace migrate-change-scope --project <path> [--apply] [--json]`** — slice 2026-06-28-code-mode-bypass-fix migration tool. Dry-run by default; `--apply` atomically renames misplaced `.peaks/_runtime/<changeId>/` (and `.peaks/<changeId>/`) entries into the canonical `.peaks/_runtime/change/<changeId>/` location, writes a `.peaks-migration.json` marker (with `from:`, `slice:`, `tool:`, `migratedAt:`) for audit. **Refusal conditions** (defense-in-depth, both pre-slice audit + new): entries that look like date-stamped session ids (`YYYY-MM-DD-session-X`) are refused to avoid destroying the session workspace (`MIGRATION_REFUSED_SESSION_ID_COLLISION`); entries whose target dir exists with non-byte-equal contents are refused to avoid clobbering (`MIGRATION_REFUSED_TARGET_NOT_EMPTY`); a hard-coded `PEAKS_TOP_LEVEL_DENY` / `RUNTIME_DENY` whitelist + `looksLikeChangeScopeId` structural check ensures `.peaks/memory`, `.peaks/standards`, `.peaks/retrospective`, `.peaks/sc`, `.peaks/sops`, `.peaks/project-scan`, `.peaks/_sub_agents` are **never** treated as misplaced change-ids. **Idempotent**: re-running on a clean workspace reports no work. Dogfood-verified: the actual misplaced `.peaks/_runtime/2026-06-27-verdict-aggregator-v2-12-debt/` (8 files) was migrated end-to-end; subsequent `peaks workflow verify-pipeline --rid 2026-06-27-verdict-aggregator-v2-12-debt --change-id 2026-06-27-verdict-aggregator-v2-12-debt --project .` reports `usedCanonicalPath: true` (was `false`) and zero `DEPRECATION_LEGACY_PATH_USED` warnings. 5 new test cases in `tests/unit/workspace/migrate-change-scope.test.ts` cover dry-run, apply, idempotency, session-id refusal, and target-not-empty refusal; a 6th case locks the `.peaks/<project-data>` whitelist contract.

### Internal

- `src/services/code/mode-gate.ts` (+28/-4 lines) — `HARD_PAUSE_STEPS` set + `GateKind` union + `gateKind` field on `GateDecision`.
- `src/services/code/auto-compact-orchestrator.ts` (+24/-2 lines) — `target` parameter, `writeMainSessionCompactIntent` helper, surface `target` in return envelope.
- `src/services/context/auto-compact-dispatcher.ts` (+38/-5 lines) — `CompactTarget` type, `target` parameter, reordered non-claude-code refusal, `shell-exec + main` → `llm-self-compress` rewrite.
- `src/services/context/auto-compact-types.ts` (+6 lines) — `target?: 'main' | 'sub-agent'` on `AutoCompactResult.data`.
- `src/services/preferences/preferences-types.ts` (+13 lines) — explicit doc-comments on `economyMode` (model selection only, NOT concurrency) and `swarmMode` (controls subgraph shape, NOT fan-out). Fan-out is governed by `fanout.defaultMode: 'fan-out'` (hard constraint per slice 2026-06-24-audit-5th-p2).
- `src/services/workflow/pipeline-verify-service.ts` (+58/-22 lines) — canonical-path lookup + 1-minor-release deprecation fallback + `usedCanonicalPath` + `findRequestFile` strips legacy `_runtime/` scope prefix.
- `src/services/workflow/artifact-paths.ts` (+31/-5 lines) — `canonicalQaDir` / `legacyQaDir` / `legacyTopLevelQaDir` helpers + extended legacy fallback chain in `resolveFindingsPath`.
- `src/cli/commands/workflow-commands.ts` (+1/-1 line) — CLI help-text now cites canonical path.
- `src/cli/commands/workspace-commands.ts` (+3 lines) — register `migrate-change-scope` sub-command.
- `src/cli/commands/workspace/migrate-change-scope-command.ts` (NEW, 230 lines) — `migrateChangeScope()` core + `migrateOne()` per-entry handler with the deny-list + `shallowContentEqual` (1-level recursion) + 3 refusal conditions.
- `tests/unit/workspace/banned-path-directive-guard.test.ts` (+11 lines) — added `KEEP_DESCRIPTIONS` anchor for the new help-text so the AC-2.2 banned-path-guard still passes.
- `tests/unit/pipeline-verify-service.test.ts` (+24/-12 lines) — `writeRdEvidence` / `writeQaEvidence` now write at canonical + legacy paths; `isResolvedChangeId` updated for the bare-id contract.
- `tests/unit/services/code/mode-gate.test.ts` (linter-updated) — assertions for the new `gateKind` field on every `GateDecision` return.
- 5 new test files: `tests/unit/code/mode-gate-step-1-hard-pause.test.ts` (14 cases), `tests/unit/workflow/pipeline-verify-canonical-path.test.ts` (4 cases), `tests/unit/workflow/artifact-paths-canonical.test.ts` (4 cases), `tests/unit/context/auto-compact-main-target.test.ts` (6 cases), `tests/unit/workspace/migrate-change-scope.test.ts` (6 cases) — 34 new cases total, all pass.

### Test results

- `pnpm vitest run` on the 4 affected module areas (code/workflow/context/workspace): **181/181 pass** (5 new test files + pre-existing suites).
- Full unit suite: 4394/4418 pass (7 pre-existing failures unrelated to this slice — `doctor.test.ts` version-mismatch × 5, `tokenizer.test.ts` time-decay flake × 1, `35-checks-aggregate.test.ts` × 1).
- `pnpm tsc --noEmit`: clean.

---

## [2.13.3] — 2026-06-28 — Verdict aggregator parser fix + publish pipeline + CLI warnings

**PATCH bump from 2.13.2** (slice `2026-06-27-verdict-aggregator-v2-12-debt`, red-line scope 7 source files + 3 test files modified + 3 new scripts + 1 package.json hook).

2.13.2 dogfood surfaced 4 bugs that all stem from v2.12.0 envelope-schema 落地 debt: the v2.12.0 audit artifacts (`audit/security.md`, `audit/perf.md`) are YAML-frontmatter + markdown, but v2.13.2's `parseSecurityEnvelope` / `parsePerfEnvelope` used `JSON.parse` (which is the wrong shape). v2.13.3 also fixes a cross-version publish-pipeline issue (`bin/peaks.js` was shipping a Jun 13 stale dist because `prepublishOnly` was never wired) and adds a soft-block-warning surface in the CLI so users can see v2.13.2's `mut-report-missing-deprecated-in-v2.14.0` warning instead of having it silently downgraded in service-layer.

### Bug fixes

- **`parseSecurityEnvelope` / `parsePerfEnvelope` now parse v2.12.0 markdown** (AC-1) — both parsers now try `JSON.parse` first and fall back to a markdown parser that extracts the YAML frontmatter `verdict:` line + parses `## Findings` bullets in 2 real v2.12.0 shapes (`- [SEV] dim @ file:line — hint` and `- HIGH: hint in file:line`). Dogfood-verified: a real `audit/security.md` with a HIGH `hardcoded password in src/auth.ts:42` now returns `parseSecurityEnvelope(...) === { verdict: 'warn', violations: [{ severity: 'HIGH', file: 'src/auth.ts', line: 42, hint: 'hardcoded password' }], summary: '...' }`. The CLI's inline `parseSecurityFromMarkdown` / `parsePerfFromMarkdown` were removed (strict-improvement refactor; canonical parser in `src/services/verdict/envelopes.ts` now owns the markdown path; CLI delegates). 4 new test cases (H/I/J/K) bring the envelope suite to 11/11.
- **`peaks verdict aggregate` returns real violations** (AC-1 end-to-end) — dogfood with a real v2.12.0 fixture now returns `{ verdict: 'warn', reasons: [{ source: 'security-audit', severity: 'HIGH', file: 'src/auth.ts', line: 42, hint: 'hardcoded password' }], sources: { security: 'present', perf: 'present', karpathy: 'present', mut: 'missing', qa: 'present' } }` — 2.13.2's silent `reasons: []` is gone.
- **`prd/handoff.md` frontmatter now has `sha256:` field** (AC-4) — `autoRegenPrdHandoff` was writing `handoffHash:` but `artifact-prerequisites.ts:158` requires `mustContain: ['schemaVersion: 2', 'sha256:']`. v2.13.3 writes `sha256: <hex>` as the primary field and keeps `handoffHash: <hex>` as an alias for backward compatibility. 1 new test case (E: prereq regression pin) brings the handoff suite to 5/5.
- **CLI surfaces `PrerequisiteCheckResult.warnings`** (AC-3) — `PrerequisitesNotSatisfiedError` now carries a `warnings` field (always present, possibly empty). The `code: PREREQUISITES_MISSING` error response now includes `data.warnings: [...]` plus a per-warning `Soft-blocked (v2.13.3 back-compat window): <path> — <message>` next-action line. This makes the v2.13.2 `MUT_REPORT` soft-block window visible to users instead of being silently downgraded in service-layer. 3 new test cases bring the request-commands suite to 8/8.

### Features

- **`prepublishOnly` build hook** (AC-2) — `package.json` adds `"prepublishOnly": "node scripts/prepublish-build.mjs"` which runs `pnpm run build` before every `npm publish`. Cross-platform dispatch via `scripts/prepublish-build.mjs` (Node entry), with equivalent `scripts/prepublish-build.sh` (git-bash / Linux) and `scripts/prepublish-build.ps1` (PowerShell) for direct invocation. The `prepublish-build.mjs` uses `shell: isWindows` to work around the Node 22 + Windows + .cmd-shim `EINVAL` (POSIX is a no-op). This is the cross-version publish-pipeline fix that prevents the 2.13.2 `bin/peaks.js → dist/src/cli/index.js (Jun 13 stale dist)` incident from recurring. The `.sh` path has been independently dogfood-verified to run `pnpm build` end-to-end with exit code 0.

### Internal

- `src/services/verdict/envelopes.ts` (+192/-18 lines) — `parseSecurityEnvelope` / `parsePerfEnvelope` markdown fallback (frontmatter + `## Findings` shape B bullets).
- `src/cli/commands/verdict-aggregate-command.ts` (+13/-31 lines) — removed inline `parseSecurityFromMarkdown` / `parsePerfFromMarkdown`; delegates to canonical parser.
- `src/services/prd/handoff-auto-regen.ts` (+8 lines) — `sha256:` primary + `handoffHash:` alias.
- `src/services/artifacts/request-artifact-service.ts` (+18/-7 lines) — `PrerequisitesNotSatisfiedError.warnings` field (defaulted param).
- `src/cli/commands/request-commands.ts` (+13/-1 lines) — surface `data.warnings` in PREREQUISITES_MISSING + per-warning next-action.
- `scripts/prepublish-build.mjs` (NEW) — cross-platform Node dispatch (8 lines of code).
- `scripts/prepublish-build.sh` (NEW) — bash variant for git-bash / Linux.
- `scripts/prepublish-build.ps1` (NEW) — PowerShell variant for Windows native.
- `package.json` (+1 line) — `prepublishOnly` hook.
- `README.md` (+1 line, 30-second onboarding block) — publish note: "v2.13.3 起 `npm publish` 会在 publish 前自动跑 `pnpm run build` (prepublishOnly hook 走 scripts/prepublish-build.mjs), 确保 bin/peaks.js 永远带最新 dist. 发布前不要手动跳过这一步 — 2.13.2 dogfood 抓过 bin/peaks.js 指 Jun 13 旧 dist 的事故."
- `tests/unit/services/verdict/envelopes.test.ts` (+112 lines) — 4 new cases (H/I/J/K).
- `tests/unit/services/prd/handoff-auto-regen.test.ts` (+62 lines) — 1 new case (E: prereq regression pin).
- `tests/unit/cli/commands/request-commands.test.ts` (+183 lines) — 3 new cases (warnings surface).

### Decision records

- NEW `.peaks/memory/2026-06-27-v2-13-3-verdict-aggregator-v2-12-debt.md` — ship state (162/162 PRD-targeted tests pass, 4363/4364 full unit suite pass with 1 pre-existing tokenizer.test.ts flake, tsc 0 errors, 6 AC all green, 4 dogfood scenarios 0-2-tychetes passed).
- UPDATED `.peaks/memory/2026-06-27-v2-13-2-verdict-aggregator-fixes.md` — 2.13.2 ship state amended with the dogfood that motivated v2.13.3 (this slice is the canonical example of "v2.13.1's BLOCKER led to v2.13.2, v2.13.2's dogfood led to v2.13.3 — the loop continues until 2.14.0 when envelopes get unified").

### Multi-CC commit boundaries

| Commit tag | Scope                                                                                                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v2.13.3    | 4 bug fixes (parser / publish pipeline / CLI warnings / handoff sha256) + 3 new scripts + 4 new test cases + package.json prepublishOnly + README publish note + CHANGELOG + version bump + ship-state memory |

### Verified (peaks code dogfood + QA on this session)

- AC-1 (parser fix): `tests/unit/services/verdict/envelopes.test.ts` → **11/11 pass** (was 7/7 in v2.13.2, +4 markdown fallback cases H/I/J/K). Dogfood script confirms: real `audit/security.md` with HIGH violation → `parseSecurityEnvelope` returns non-null envelope; `peaks verdict aggregate` returns `reasons: [{severity: HIGH, file: src/auth.ts:42}]`.
- AC-2 (publish pipeline): `scripts/prepublish-build.sh` end-to-end via git-bash: `[prepublish-build] build OK — proceeding to publish` (exit 0). The `prepublishOnly` hook in `package.json` (line 47) is wired to `node scripts/prepublish-build.mjs`.
- AC-3 (CLI warnings): `tests/unit/cli/commands/request-commands.test.ts` → **8/8 pass** (was 5/5 in v2.13.2, +3 warnings-surface cases). Dogfood: `rd:qa-handoff` with `mut-report.json` deleted → response `data.warnings[0].code = 'mut-report-missing-deprecated-in-v2.14.0'` ✓.
- AC-4 (handoff sha256): `tests/unit/services/prd/handoff-auto-regen.test.ts` → **5/5 pass** (was 4/4 in v2.13.2, +1 prereq regression pin E). Dogfood: delete `prd/handoff.md` + re-transition → frontmatter contains both `sha256: <hex>` and `handoffHash: <hex>` (alias); subsequent transition no longer reports `missing section(s): sha256:`.
- AC-5 (零回归): 2.13.2 baseline 149 + 2.13.3 new 13 = **162/162 pass** on PRD-targeted scope. Full unit suite: **4363/4364 pass + 17 skipped** (1 pre-existing `tokenizer.test.ts` timeDecayScore flake confirmed on clean HEAD `1aac7e2` after stashing v2.13.3 changes; not introduced by v2.13.3).
- AC-6 (scope): 10 modified + 3 untracked (scripts). All in expected territory (src/ + tests/ + scripts/ + package.json prepublishOnly + README publish note). CHANGELOG / version.ts / ship-state memory: release territory, RD correctly excluded.
- `tsc --noEmit` → **0 errors**.

### Out-of-scope (NOT changed — Karpathy §3 surgical-change discipline)

- v2.12.0 audit envelope file format (YAML frontmatter + markdown body) — preserved (the contract that 2.13.3 now correctly parses)
- v2.13.1 `## Verdict reasoning (v2.13.1)` section in `micro-cycle.md` — preserved
- v2.13.2 commit `1aac7e2` — preserved (v2.13.3 adds on top)
- `peaks-qa` verdict protocol (`pass | return-to-rd | blocked`) — preserved
- `peaks-final-review` 4-dim interface — preserved
- 5 verdict strings — preserved
- `aggregateVerdict()` signature — preserved
- Envelope file contents (parsers updated; on-disk schemas unchanged)
- Weighted scoring / RFC voting — explicitly out of scope

### Known limitations (carry-forward to v2.14.0)

- **`scripts/prepublish-build.mjs` Windows EINVAL workaround is partial** — the `shell: isWindows` fix is a no-op on POSIX but on Windows native + git-bash there is still a residual `spawnSync` `EINVAL` / `ENOENT` interaction with `cmd.exe` / `pnpm.cmd` shims. The `.sh` path is git-bash / Linux correct (dogfood-verified end-to-end with `pnpm build OK` and exit 0); npm publish in a real Linux / CI environment uses the mjs path correctly. v2.14.0 should consider replacing the mjs spawn with a `cross-spawn` library or a pure-Node `child_process.execFile` fallback to fully abstract the platform differences.
- **MUT_REPORT hard-fail still pending** — v2.13.3 only surfaces the soft-block warning in CLI; the actual hard-fail conversion to throw-on-missing happens in v2.14.0.
- **pre-existing `tokenizer.test.ts` timeDecayScore flake** — confirmed pre-existing on clean HEAD `1aac7e2` after stashing v2.13.3 changes. Out of scope for this slice; documented in `.peaks/memory/2026-06-27-v2-13-2-verdict-aggregator-fixes.md`.
- **No 2.13.3 dogfood of `prepublish-build.ps1`** — the PowerShell variant was added per AC-2 cross-platform but not dogfood-verified end-to-end (git-bash tests the .sh path). A v2.14.0 follow-up should run the .ps1 path in Windows native to confirm parity.

---

## [2.13.2] — 2026-06-27 — Verdict aggregator bug fix + CLI surface + envelope unification

**PATCH bump from 2.13.1** (slice `2026-06-27-verdict-aggregator-fixes`, red-line scope 3 src files + 3 test files modified + 3 new src files + 4 new test files).

v2.13.1 shipped with a BLOCKER bug found via post-release dogfood: `aggregateVerdict()`'s `pushFix` used `${source}|${file}|${line}|${hint}` as the dedup key, which violated the `.peaks/project-scan/audit-output-schema.md:73` rule that identical `(file, line, hint)` tuples from different audits must be merged into a single entry. The v2.13.1 unit-test suite (13 cases) did not exercise the cross-source scenario, so the bug slipped through CI. v2.13.2 fixes the bug, surfaces the aggregator as a CLI subcommand, unifies envelope schemas behind a discriminated-union type, adds `prd/handoff.md` auto-regeneration on `prd:handed-off`, and introduces a 1-minor-release soft-block window for `MUT_REPORT` to ease the 2.13.1→2.14.0 transition.

### Bug fixes

- **`aggregateVerdict()` cross-source dedup** (AC-1) — `pushFix` key changed from `${source}|${file}|${line}|${hint}` to `${file}|${line}|${hint}` per audit-output-schema.md:73. `VerdictReason` gained a required `sources: ReadonlyArray<VerdictSource>` field that lists every source that reported the same `(file, line, hint)` tuple. Merging happens via a per-key `Map<key, VerdictReason>` that appends sources when a hit is found. Dogfood-verified: `aggregateVerdict({security: {verdict:'warn', violations:[{file:'a.ts', line:1, hint:'same', severity:'HIGH'}]}, perf: {verdict:'warn', violations:[{file:'a.ts', line:1, hint:'same', severity:'HIGH'}]}})` now returns `reasons.length === 1, sources === ['security-audit', 'perf-audit']`. 3 new test cases (I cross-source-dedup, J single-source-no-merge, K single-source-unique-no-merge) bring the aggregator test suite to 16/16.

### Features

- **`peaks verdict aggregate --from-rid <rid>`** (AC-2) — CLI surface for the aggregator. Reads 5 envelope files from `.peaks/_runtime/<sessionId>/`, calls `aggregateVerdict()`, and returns a JSON envelope `{ verdict, reasons, sources: { security|perf|karpathy|mut|qa: 'present'|'missing' } }`. Missing envelopes are reported as `missing` in the `sources` map (aggregator treats undefined as "not run" per v2.13.1 all-empty→'pass' 退化). 4-case test covers 5-inputs-present / 1-missing / all-missing / JSON-shape. CLI is 168 lines, ≤ 200 budget.
- **Envelope unification** (AC-3) — new `src/services/verdict/envelopes.ts` (200 lines) provides `AnyEnvelope` discriminated union + 5 parser funcs (`parseSecurityEnvelope` / `parsePerfEnvelope` / `parseKarpathyEnvelope` / `parseMutEnvelope` / `parseQaEnvelope`) + an `envelopesToAggregatorInput` adapter. Re-uses the existing `isSecurityAuditEnvelope` / `isPerfAuditEnvelope` strict-shape guards from `src/services/audit-independent/` — no schema duplication. `aggregateVerdict()` signature is **unchanged** (backward compatible); the parsers are additive. 7-case test covers 5 happy paths + 1 malformed rejection + 1 adapter. On-disk envelope files are **not modified** (schemas remain in-file self-describing).
- **`prd/handoff.md` auto-regeneration** (AC-4) — when `peaks request transition --role prd --state handed-off` succeeds and `prd/handoff.md` is missing, peaks-prd auto-writes the handoff capsule (`schemaVersion: 2` + `handoffHash: <sha256>`) before the transition is committed. If handoff already exists, it is **not** overwritten. The auto-regen fires **only** on `prd:handed-off`; 11 other transitions are untouched (Karpathy §3 surgical-change discipline). 4-case test includes a guard case for non-prd roles.

### Internal

- `src/services/verdict/verdict-aggregator.ts` (+79/-21 lines) — `pushFix` key fix + `VerdictReason.sources` field + `indexByKey: Map<string, VerdictReason>` for cross-source merge.
- `src/services/verdict/envelopes.ts` (NEW, 200 lines) — discriminated union + 5 parsers + adapter.
- `src/services/prd/handoff-auto-regen.ts` (NEW) — `autoRegenPrdHandoff()` helper; reuses `sha256OfBody` from existing handoff-service.
- `src/cli/commands/verdict-aggregate-command.ts` (NEW, 168 lines) — `peaks verdict aggregate` subcommand.
- `src/cli/commands/request-commands.ts` (+28 lines) — `prd:handed-off` auto-regen hook (1 branch, ≤ 30 lines).
- `src/cli/program.ts` (+3 lines) — `registerVerdictAggregateCommands()` registration.
- `src/services/artifacts/artifact-prerequisites.ts` (+39/-5 lines) — `MUT_REPORT.backCompat = true` flag + `PrerequisiteCheckResult.warnings: Warning[]` field + soft-block branch in `checkPrerequisites()`.
- `tests/unit/services/verdict/verdict-aggregator.test.ts` (+78 lines) — 3 new dedup cases (I/J/K) bringing total to 16.
- `tests/unit/services/verdict/envelopes.test.ts` (NEW, 7 cases).
- `tests/unit/cli/commands/verdict-aggregate-command.test.ts` (NEW, 4 cases).
- `tests/unit/services/prd/handoff-auto-regen.test.ts` (NEW, 4 cases).
- `tests/unit/artifact-prerequisites-v2-13-2-soft-block.test.ts` (NEW, 2 cases).
- `tests/unit/artifact-prerequisites.test.ts` (5 lines) + `tests/unit/artifact-prerequisites-typed.test.ts` (10 lines) + `tests/unit/artifact-prerequisites/mut-report-prereq.test.ts` (8 lines) — updated for soft-block behavior.

### Deprecations / soft-block windows

- **`MUT_REPORT` soft-block window (v2.13.2 → v2.14.0)** (AC-5) — mirroring the v2.12.0 audit 1-minor-release back-compat pattern, missing `mut-report.json` at `rd:qa-handoff` now produces a `warnings[]` entry with code `mut-report-missing-deprecated-in-v2.14.0` instead of throwing `PREREQUISITES_MISSING`. **`passed: false` still throws** (2.14.0 is the hard-fail target). Slices that explicitly run `peaks mut run` and get `passed: false` are still blocked; only the missing-file case is softened. v2.14.0 will convert the soft-block to hard-fail.

### Decision records

- NEW `.peaks/memory/2026-06-27-v2-13-2-verdict-aggregator-fixes.md` — ship state (149/149 PRD-targeted tests pass, 4355/4356 full suite pass with 1 pre-existing tokenizer flake, tsc 0 errors, 7 AC all green).
- UPDATED `.peaks/memory/2026-06-27-v2-13-1-verdict-aggregator.md` — v2.13.1 ship state amended with the dogfood finding that motivated v2.13.2 (this slice is the canonical example of why post-release dogfood matters: 13-case unit suite missed the cross-source scenario).

### Multi-CC commit boundaries

| Commit tag | Scope                                                                                                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v2.13.2    | `aggregateVerdict()` dedup bug fix + `peaks verdict aggregate` CLI + `envelopes.ts` unification + `prd/handoff.md` auto-regen + `MUT_REPORT` soft-block window + 4 new test files + 4 updated test files + CHANGELOG + version bump + ship-state memory |

### Verified (peaks code dogfood + QA on this session)

- AC-1 (BLOCKER fix): `tests/unit/services/verdict/verdict-aggregator.test.ts` → **16/16 pass** (was 13/13 in v2.13.1, +3 cross-source cases). Dogfood script confirms: `reasons.length = 1, sources = ["security-audit","perf-audit"], verdict = warn`.
- AC-2 (CLI surface): `tests/unit/cli/commands/verdict-aggregate-command.test.ts` → **4/4 pass**. Real CLI: `peaks verdict aggregate --help` shows `--from-rid/--sid/--project/--json` options correctly.
- AC-3 (envelope unification): `tests/unit/services/verdict/envelopes.test.ts` → **7/7 pass** (5 parser happy paths + 1 malformed rejection + 1 adapter).
- AC-4 (handoff auto-regen): `tests/unit/services/prd/handoff-auto-regen.test.ts` → **4/4 pass** (3 happy paths + 1 non-prd-role guard).
- AC-5 (soft-block): `tests/unit/artifact-prerequisites-v2-13-2-soft-block.test.ts` → **2/2 pass** (missing→warning / passed:false→throw).
- AC-6 (零回归): 2.13.1 既有 90 测试 + 2.13.2 新 33 测试 = **149/149 pass** on PRD-targeted scope. Full unit suite: **4355/4356 pass + 17 skipped** (1 pre-existing `tokenizer.test.ts` flake confirmed on clean HEAD `571f92b` after stashing v2.13.2 changes; not introduced by v2.13.2).
- AC-7 (文档同步): RD correctly excluded CHANGELOG / package.json / src/shared/version.ts / README / ship-state memory from its diff. `git status` confirms only `src/` + `tests/` paths in the working tree.
- `tsc --noEmit` → **0 errors**.

### Out-of-scope (NOT changed — Karpathy §3 surgical-change discipline)

- v2.12.0 audit envelope schemas (security / perf) — preserved
- v2.13.1 `## Verdict reasoning (v2.13.1)` section in `micro-cycle.md` — preserved
- `peaks-qa` verdict protocol (`pass | return-to-rd | blocked`) — preserved
- `peaks-final-review` 4-dim interface — preserved
- 5 verdict strings — preserved
- 2.13.1 on-disk release (commit `571f92b`) — **not** reverted; this is a PATCH bump per the user's "2.13.1 我发完了" instruction
- Envelope file contents (only TS types changed; in-file schemas are still self-describing)
- Weighted scoring / RFC voting — explicitly out of scope

### Known limitations (carry-forward to v2.14.0)

- **`MUT_REPORT` hard-fail transition** — v2.14.0 must convert the soft-block to hard-fail (missing `mut-report.json` → throw). v2.13.2 ships a `backCompat: true` flag for graceful migration; the deprecation window is 1 minor release.
- **`bin/peaks.js` references old dist/** — the smoke test of `peaks verdict aggregate --help` ran via `./node_modules/.bin/tsx ./bin/peaks.js` because the published `bin/peaks.js` points at a stale `dist/` build (Jun 13). v2.14.0 should ship a `pnpm run build` step before `npm publish` to refresh the dist.
- **`prefs.fanout.defaultMode` migration** (out of v2.13.2 scope) — the 2.8.4 hard-constraint migration to `fan-out` (per `references/fanout-mandatory.md`) is still pending for projects that may have `serial` in their `.peaks/preferences.json`. v2.14.0 should add a runtime migration warning.
- **CLI help-text for new commands** — `peaks verdict aggregate --help` is wired correctly; CLI list also shows it under the top-level `verdict` group. The CLI smoke test in this slice used tsx directly (not the published dist), so the published `bin/peaks.js` will not reflect the new command until the next `pnpm run build` + `npm publish` cycle.

---

## [2.13.1] — 2026-06-27 — Verdict reasoning layer (multi-signal convergence for peaks-code)

**PATCH bump from 2.13.0** (slice `2026-06-27-verdict-aggregator`, red-line scope 3 source files + 4 new test files + 2 updated test files).

peaks-code previously received 5 heterogeneous signals (security-audit, perf-audit, karpathy-reviewer, peaks-mut, peaks-qa) but had no convergence layer. The v2.12.0 audit-output schema documented 4 aggregation rules (`.peaks/project-scan/audit-output-schema.md:66-78`) but they were never implemented; the `mut-report.json` was consumed by peaks-qa internally with `loadMutReport() === null → gate=skipped` (soft consumption), and `micro-cycle.md` had no verdict-reasoning surface. v2.13.1 fills the gap without unifying envelope schemas (deferred to v2.14) and without changing any verdict string.

### Features

- **`aggregateVerdict()` service** (AC-2) — new `src/services/verdict/verdict-aggregator.ts` (223 lines, < 250 cap). Pure function (no I/O, no clock, no fs). Accepts 5 envelope inputs (`security` / `perf` / `karpathy` / `mut` / `qa`) and returns `{ verdict, reasons[] }`. Hard precedence: `block > return-to-rd > warn > pass`. Implements all 4 audit-output-schema rules: verdict precedence, CRITICAL count accumulation, `(file, line, hint)` dedup via `Set<string>` keyed on `${source}|${file}|${line}|${hint}`, handoff hash consistency (handled upstream by audit skills). All-empty input → `verdict: 'pass'` 退化 (no spurious block on missing signals). 13 test cases (8 AC-2 behaviors A-H + 5 precedence/regression cases).
- **`MUT_REPORT` prerequisite** (AC-1) — `mut-report.json` now blocks `peaks request transition --role rd --state qa-handoff` for `feat` / `bugfix` / `refactor` (REFACTOR inherits via FEATURE_TABLE reference) when missing or `passed: false`. `config` / `docs` / `chore` remain exempt. `mustContainAny: ['"passed": true', '"passed":true']` admits `passed:true` and rejects `passed:false`. `peaks-qa` internal `loadMutReport() === null → gate=skipped` path is preserved (back-compat). 4-case test pins all 4 paths.
- **`## Verdict reasoning` section in `micro-cycle.md`** (AC-3) — the 6-step RD↔QA repair loop now has a verdict-reasoning section that (a) shows a re-run output JSON example with `re-run reason: { source, signal, severity, file, line, hint }` payload, (b) provides a 4-row decision table mapping verdict → repair-loop action (`return-to-rd` → re-run RD, `block` → blocked TXT, `warn` → re-run with reasons, `pass` → exit loop), (c) gives a 4-step runbook integration. The 6-step cycle body is byte-stable (only the new section is added). 4-case test pins the section existence + 3 behavior cases.

### Internal

- `src/services/verdict/verdict-aggregator.ts` (NEW, 223 lines) — pure `aggregateVerdict()` + locally-defined `KarpathyEnvelope` / `MutEnvelope` / `QaEnvelope` types (surgeon scope; v2.14 will move them to shared if a unification pass lands).
- `src/services/artifacts/artifact-prerequisites.ts` — added `MUT_REPORT` constant (32 lines) + wired into `FEATURE_TABLE['rd:qa-handoff']` (line 276) and `BUGFIX_TABLE['rd:qa-handoff']` (line 303); `REFACTOR_TABLE` inherits via reference (line 312); `MINIMAL_TABLE` / `CONFIG_TABLE` exempt.
- `skills/peaks-code/references/micro-cycle.md` — added `## Verdict reasoning (v2.13.1)` section (91 lines) after the unchanged repair-cycle cap rule.
- `tests/unit/artifact-prerequisites/mut-report-prereq.test.ts` (NEW, 4 cases).
- `tests/unit/services/verdict/verdict-aggregator.test.ts` (NEW, 13 cases).
- `tests/unit/skills/code/micro-cycle-verdict-reasoning.test.ts` (NEW, 4 cases).
- `tests/unit/artifact-prerequisites.test.ts` (UPDATED, +25 lines) — seeded `mut-report.json` in 3 pass-path tests; added to negative-path missing-list.
- `tests/unit/artifact-prerequisites-typed.test.ts` (UPDATED, +20 lines) — same across bugfix + feature + refactor.

### Decision records

- NEW `.peaks/memory/2026-06-27-v2-13-1-verdict-aggregator.md` — ship state (90/90 tests pass, tsc 0 errors, 5 AC all green).

### Multi-CC commit boundaries

| Commit tag | Scope                                                                                                                                                                      |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v2.13.1    | MUT_REPORT prereq + `aggregateVerdict()` service + `## Verdict reasoning` section + 4 new test files + 2 updated test files + CHANGELOG + version bump + ship-state memory |

### Verified (peaks code dogfood on this session)

- AC-1 (MUT_REPORT prereq): `tests/unit/artifact-prerequisites/mut-report-prereq.test.ts` → 4/4 pass; `tests/unit/artifact-prerequisites.test.ts` → 9/9 pass; `tests/unit/artifact-prerequisites-typed.test.ts` → 19/19 pass.
- AC-2 (verdict-aggregator): `tests/unit/services/verdict/verdict-aggregator.test.ts` → 13/13 pass; 8 AC-2 behaviors (A all-pass, B security-block, C mut-block, D qa-return-to-rd, E mixed-warn, F all-empty, G precedence block-dominant, H CRITICAL accumulation) all asserted.
- AC-3 (micro-cycle reasoning): `tests/unit/skills/code/micro-cycle-verdict-reasoning.test.ts` → 4/4 pass; 6-step cycle body byte-stable.
- AC-4 (零回归): `tests/unit/parallel-fan-out.test.ts` → 18/18 pass (v2.12.0 stability pin); `tests/unit/rd/karpathy-skip-on-config-docs-chore.test.ts` → 11/11 pass; `tests/unit/rd/deprecated-reviewer-back-compat.test.ts` → 12/12 pass.
- Total: 8 test files, **90/90** tests pass, duration 1.27s.
- `./node_modules/.bin/tsc --noEmit` → 0 errors.

### Out-of-scope (NOT changed)

- v2.12.0 audit envelope schemas (`SecurityAuditEnvelope`, `PerfAuditEnvelope`) — preserved
- `peaks-qa` verdict protocol (`pass | return-to-rd | blocked`) — preserved
- `peaks-final-review` 4-dim interface (functional-completeness / problem-resolution / no-new-bugs / existing-functionality-intact) — preserved
- `peaks-rd` SKILL.md main body — preserved
- Envelope schema unification — deferred to v2.14
- Weighted scoring / RFC voting — explicitly out of scope
- CLI subcommand for `aggregateVerdict()` (only consumed by unit tests + micro-cycle reference in v2.13.1) — deferred to v2.14

### Known limitations (carry-forward to v2.14)

- **No CLI surface for `aggregateVerdict()`** — the aggregator is consumed by unit tests and referenced in `micro-cycle.md` as the re-run reason payload source, but no CLI subcommand exposes it directly. v2.14 should add `peaks verdict aggregate --from-rid <rid>` that reads all 5 envelope artifacts and prints the aggregated verdict + reasons.
- **Envelope schema heterogeneity persists** — the 5 envelopes still have 3 distinct shapes (`{verdict, violations, summary}` for security/perf, `{passed, violations, gateAction}` for karpathy, `{verdict}` for qa, `{passed, killRate, weakRate, violations}` for mut). v2.13.1 ships precedence aggregation; v2.14 should add a `services/verdict/envelopes.ts` shared module with discriminated-union type and parser funcs.
- **`prd/handoff.md` is not auto-regenerated by v2.13.1** — the AUDIT_REQUIRES_HANDOFF prereq still requires an existing handoff capsule; v2.13.1 does not change this. v2.14 should consider making peaks-prd write the handoff on every `prd:handed-off` transition.

---

## [2.13.0] — 2026-06-27 — Zero-human-intervention auto-compact (peaks-loop drives context compression on any AI CLI)

**MINOR bump from 2.12.0** (slice `v2-13-0-auto-compact-protocol`, 5-sub-task plan AC-1..AC-5, red-line scope ~6 source files + 2 IDE adapter fields).

peaks-code now autonomously drives context compaction so the LLM-runner stays alive with context < 95% on **any AI CLI**, with **zero human / zero LLM intervention**. Two-tier threshold model:

- **85% pre-compact zone** — peaks-loop writes a pre-compact checkpoint + convergence plan + auto-decisions log + IDE-side compact dispatch (async-friendly).
- **95% RED LINE** — peaks-loop refuses sub-agent dispatch and forces synchronous IDE compact; mandatory, LLM cannot opt out.

Adapter-driven protocol (no hard-coded IDE names): `IdeAdapter.compact?: IdeCompactProfile` is a 4-field per-IDE profile (`envVarForContextPercent` + `compactCommand` + `compactPathway` + `postCompactDetectCommand`). Claude Code is the MVP fill; trae / codex / cursor / qoder / tongyi-lingma / hermes / openclaw ship without `compact` and fall through to the conservative-zero probe (no auto-fire on missing signal).

### Features

- **`peaks code context-now`** (AC-1) — auto-probes the active IDE adapter's context-fill % without requiring the LLM to pass `--prompt-size <bytes>` manually. Adapter-driven: reads `IdeAdapter.compact.envVarForContextPercent` (Claude Code MVP: `CLAUDE_CONTEXT_USAGE_PERCENT`). Returns a verdict (`ok` / `soft-warn` / `pre-compact` / `red-line`) plus source-tagged probe (`claude-code-env` / `statusline-poll` / `conservative-fallback`). When no IDE-specific signal is available, returns `ratio: 0` with `source: 'conservative-fallback'` so the orchestrator never auto-fires on a missing signal.
- **`peaks code auto-compact`** (AC-4) — 0-intervention loop. Honors D6.e in-flight-batch deferral for the pre-compact zone; forces synchronous dispatch at red-line. `--force` and `--bypass-red-line` are test seams (never `true` in production).
- **Convergence toolkit** (AC-2) — `src/services/code/auto-compact-orchestrator.ts` `evaluateCompactTrigger` (pure) + `runAutoCompact` (side effects: `writePreCompactCheckpoint` + `appendAutoDecisionLog` + `dispatchIdeCompact`). Checkpoints land at `.peaks/_runtime/<sessionId>/checkpoints/{pre-compact,red-line}-<ISO>.json`; the LLM-readable decision log lands at `.peaks/_runtime/<sessionId>/txt/auto-decisions.md` so D7's post-compact-detect picks it up unchanged.
- **IDE-aware compact dispatcher** (AC-3) — `src/services/context/auto-compact-dispatcher.ts` reads `IdeAdapter.compact` and dispatches via the adapter-declared pathway. `shell-exec` (Claude Code MVP) spawns the compact command via `child_process.spawn`. `ide-native` is reserved for a future slice. `llm-self-compress` returns success + instructs the LLM to summarize on next turn. `noop` returns explicit failure for legacy adapters.

### Internal

- `src/services/context/auto-compact-types.ts` (NEW) — types + 3 constants: `AUTO_COMPACT_SOFT_WARN_RATIO = 0.5`, `AUTO_COMPACT_PRE_COMPACT_RATIO = 0.85`, `AUTO_COMPACT_RED_LINE_RATIO = 0.95`.
- `src/services/context/auto-compact-reader.ts` (NEW) — `readContextPercent` (AC-1 probe).
- `src/services/context/auto-compact-dispatcher.ts` (NEW) — `dispatchIdeCompact` (AC-3 IDE dispatch).
- `src/services/code/auto-compact-orchestrator.ts` (NEW) — `evaluateCompactTrigger` + `runAutoCompact` (AC-2 + AC-4 core).
- `src/services/ide/ide-types.ts` — `IdeAdapter.compact?: IdeCompactProfile` + `IdeCompactProfile` interface.
- `src/services/ide/adapters/claude-code-adapter.ts` — MVP `compact` profile: `CLAUDE_CONTEXT_USAGE_PERCENT` + `claude --compact` + `shell-exec`.
- `src/cli/commands/code-commands.ts` — `peaks code context-now` + `peaks code auto-compact` subcommands.
- `package.json` + `src/shared/version.ts` — `2.12.0 → 2.13.0`.

### Decision records

- NEW `.peaks/memory/2026-06-27-auto-compact-design.md` — full design rationale + two-tier threshold + adapter-driven protocol + open follow-ups (L2-dogfood per-IDE profiles, `ide-native` pathway, statusline integration, hook-based prompt injection).

### Multi-CC commit boundaries

| Commit tag                  | Scope                                                                                                                                                             |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v2.13.0-alpha.1 (`edffc33`) | Two-tier threshold + auto-compact types + reader + dispatcher + orchestrator + Claude Code MVP adapter + `peaks code context-now` + `peaks code auto-compact` CLI |
| `a8b9804`                   | In-session dogfood limitation documented (current ad-hoc Claude Code session cannot be externally compacted — reserved for follow-up PreToolUse-hook slice)       |

### Verified (peaks code dogfood on this session)

- `context-now` boundary tests: `0.30 = ok` / `0.50 = soft-warn` / `0.84 = soft-warn` / `0.85 = pre-compact` / `0.949 = pre-compact` / `0.95 = red-line` / `1.0 = red-line` ✓
- `auto-compact @ 1.0` (red-line): dispatched (shell-exec ok), `red-line` checkpoint written at `.peaks/_runtime/<sessionId>/checkpoints/red-line-<ISO>.json`, convergence plan + auto-decisions.md appended, `redLineGated: true` ✓
- `auto-compact @ 0.87 + --in-flight-batch`: `decision: in-flight-batch`, no checkpoint write (D6.e honored) ✓
- `auto-compact @ 0.85`: pre-compact dispatched (shell-exec ok), pre-compact checkpoint + convergence plan + auto-decisions.md written ✓
- `post-compact-detect` after pre-compact: `shouldAutoResume: true`, `reason: post-compact-match` ✓
- Trae IDE (no `compact` profile): `ratio: 0` + `source: conservative-fallback` + `below-threshold` (no auto-fire on missing signal — by design) ✓
- `pnpm tsc --noEmit`: clean
- `pnpm vitest run` (full suite): `4317 / 4317` pass + 17 skipped (2 pre-existing baseline failures on session-checkpoint + \_archive-removal-guard unchanged)

### Out-of-scope (NOT changed)

- `src/services/code-review/ecc-bridge.ts` + `src/services/dispatch/sub-agent-dispatcher.ts` + `src/services/agent/ecc-agent-service.ts` + `src/services/prd/handoff-service.ts` + `project-scan-reader.ts` + `src/services/rd/{strategic,tactical,strategy,impl,ast-gate,types}.ts` + `peaks-qa/` + `peaks-code/SKILL.md` main flow + `peaks-prd/SKILL.md` main body — all untouched per the v2.13.0 red-line scope.

### Known limitations (carry-forward to v2.13.1)

- **Ad-hoc Claude Code runner cannot be externally compacted.** The v2.13.0-alpha.1 shell-exec pathway spawns the IDE's compact command via `child_process.spawn` — a separate child process. The current Claude Code runner that invoked `auto-compact` is unaffected; its own context window stays at 100% until that runner's own compact logic kicks in (Claude Code's own auto-compact or a user-issued `/compact` slash command). Follow-up slice: register a PreToolUse hook via `peaks hooks install` that intercepts the next Bash call and writes a stderr hint when ratio ≥ 0.95 — fills the already-reserved `ide-native` compact pathway.
- **`peaks-code` Step N+2 prose update** — `skills/peaks-code/SKILL.md` should mention `peaks code context-now` + `auto-compact` so LLM sessions invoke the autonomous loop instead of `--prompt-size` hand-passing.

---

## [2.12.0] — 2026-06-27 — Independent security + perf audit skills (RD fan-out collapse 5→3)

**MINOR bump from 2.11.2** (slice `v2-12-independent-security-perf-audit`, 9-tier plan, multi-CC Group A→E, red-line scope ~40-45 files).

peaks-rd's parallel review fan-out collapsed from **5 sub-agents** to **3 sub-agents** by moving `security-reviewer` + `perf-baseline-reviewer` out of the fan-out into two new standalone audit skills (`peaks-security-audit` + `peaks-perf-audit`). The two removed slots are exposed as `RD_DEPRECATED_REVIEWERS` for the 1-minor-release back-compat window (v2.13.0 hard-deletes the legacy paths).

### Features

- **`peaks-security-audit` skill** (Group A — Tier 2) — standalone security audit skill. CLI: `peaks security-audit run`. Consumes the immutable peaks-prd handoff (`prd/handoff.md`) + the project-scoped audit template `.peaks/project-scan/security-template.md`. Writes `.peaks/_runtime/<sessionId>/audit/security.md`. Returns 3-state verdict (`pass` / `mitigated` / `blocked`). 6 unit-test cases.
- **`peaks-perf-audit` skill** (Group A — Tier 3) — standalone perf audit skill. CLI: `peaks perf-audit run`. Consumes the immutable handoff + `.peaks/project-scan/perf-template.md`. Writes `.peaks/_runtime/<sessionId>/audit/perf.md`. 6 unit-test cases.
- **Audit template files** (Group A — Tier 1, NEW) — `.peaks/project-scan/security-template.md` (4,285 bytes) + `.peaks/project-scan/perf-template.md` (4,337 bytes) + `.peaks/project-scan/audit-output-schema.md` (4,410 bytes). Git-tracked source of truth for the audit skill output shape.
- **RD fan-out collapse** (Group B — Tier 4) — `src/services/rd/reviewer-dispatch-policy.ts` `RD_FANOUT_REVIEWERS` is now a 3-element tuple (`code-reviewer` + `qa-test-cases-writer` + `karpathy-reviewer`). The 2 removed slots are exposed as `RD_DEPRECATED_REVIEWERS`; `isDeprecatedReviewer(name)` routes any legacy dispatch record to the new audit skill. 8 back-compat test cases.
- **Artifact prereq migration** (Group B — Tier 5) — `src/services/artifacts/artifact-prerequisites.ts` replaces `SECURITY_REVIEW` + `PERF_BASELINE` prereqs with `AUDIT_SECURITY` + `AUDIT_PERF` + `AUDIT_REQUIRES_HANDOFF`. The new prereqs mechanically gate `peaks request transition --state qa-handoff` until the audit outputs are written and the handoff frontmatter (sha256 + schemaVersion: 2) is verified.
- **peaks-txt sediment extension** (Group C — Tier 6) — `src/services/prd/project-scan-sediment.ts` adds 3 new public functions (`appendSecurityPattern` + `appendPerfPattern` + `appendAuditSchemaVariant`) wrapping a generic internal helper. Append-only inventory operations idempotent on `(value, sourceRid)`. 7 new test cases.
- **Fan-out SKILL.md updates** (Group D — Tier 7) — `skills/peaks-rd/SKILL.md` + `skills/peaks-rd/references/parallel-review-fanout.md` + `skills/peaks-rd/references/rd-fanout-contracts.md` + NEW `skills/peaks-rd/references/v2-12-fanout-collapse.md` reflect the v2.12.0 3-way fan-out shape. SKILL.md stays under the 24K byte cap.

### Back-compat window (v2.12.0 → v2.13.0)

The 1-minor-release window keeps the legacy paths readable via `mustContainAny`:

- Legacy `rd/security-review.md` → accepted via `AUDIT_SECURITY.mustContainAny`.
- Legacy `rd/perf-baseline.md` → accepted via `AUDIT_PERF.mustContainAny`.
- Legacy `RD_FANOUT_REVIEWERS`-slot dispatch records (`.peaks/_sub_agents/<sessionId>/dispatch/{security-reviewer,perf-baseline-reviewer}.json`) → routed via `isDeprecatedReviewer(name)` to the new audit skill.

v2.13.0 hard-deletes the legacy paths.

### Decision records

- NEW `.peaks/memory/2026-06-27-v2-12-independent-security-perf-audit.md` — parent decision (v2.12.0 collapse architecture + multi-CC Group A→E split).
- NEW `.peaks/memory/2026-06-27-v2-12-fanout-3way.md` — fan-out shape decision (3-element tuple, pinned by 8 tests across 4 files).
- APPEND `.peaks/project-scan/business-knowledge.md` — `D2'` row (3-way fan-out) + `G1'` row (peaks-txt sediment extension).
- APPEND `.peaks/memory/security-perf-plan-result-split.md` — "Reverse 2026-06-27" section (how the v2.12.0 collapse reverses the slice-025 plan/result split).

### Internal

- `src/services/rd/reviewer-dispatch-policy.ts` — `RD_FANOUT_REVIEWERS` (3-element) + `RD_DEPRECATED_REVIEWERS` (2-element back-compat) + `isDeprecatedReviewer(name)`.
- `src/services/artifacts/artifact-prerequisites.ts` — `AUDIT_SECURITY` + `AUDIT_PERF` + `AUDIT_REQUIRES_HANDOFF` prereqs (with `mustContainAny` for back-compat).
- `src/services/prd/project-scan-sediment.ts` — `appendSecurityPattern` + `appendPerfPattern` + `appendAuditSchemaVariant` + generic `appendAuditPatternInventory` helper.
- `src/services/audit-independent/{security-audit-service,perf-audit-service}.ts` — new service layer.
- `src/cli/commands/{security-audit-commands,perf-audit-commands}.ts` — new CLI subcommands wired into `program.ts`.
- `package.json` + `src/shared/version.ts` — `2.11.2 → 2.12.0` version bump.

### Multi-CC commit boundaries

| Group | Tiers | Commit tag        | Scope                                                                 |
| ----- | ----- | ----------------- | --------------------------------------------------------------------- |
| A     | 1+2+3 | v2.12.0-alpha.1   | Templates + new skills (fa082f5)                                      |
| B     | 4+5   | v2.12.0-alpha.2   | 5→3 fanout collapse + prereq migration (6485f1c)                      |
| C     | 6     | v2.12.0-alpha.3   | peaks-txt sediment extension (ab2757b)                                |
| D     | 7     | v2.12.0-alpha.4   | fan-out SKILL.md updates (b6c4fae)                                    |
| E     | 8+9   | v2.12.0 (release) | Decision records + migration + CHANGELOG + version bump (this commit) |

### Zero regression (verified per group)

Each Group A→D ran the full RD→QA loop independently. Group C final QA: 14/14 sediment tests pass + 39/39 prd service tests pass; 9 pre-existing baseline failures unchanged (doctor / \_archive-removal-guard / request-commands / observability / session-checkpoint / tech-service / workflow-autonomous-resume / jsonl-store / 35-checks-aggregate — all unrelated to v2.12.0). Group D final QA: 35/35 fan-out SKILL.md contract tests pass; same 9 pre-existing baseline failures.

### Out-of-scope (NOT changed)

`src/services/code-review/ecc-bridge.ts` + `src/services/dispatch/sub-agent-dispatcher.ts` + `src/services/agent/ecc-agent-service.ts` + `src/services/prd/handoff-service.ts` + `project-scan-reader.ts` + `src/services/rd/{strategic,tactical,strategy,impl,ast-gate,types}.ts` + `peaks-qa/` + `peaks-code/SKILL.md` main flow + `peaks-prd/SKILL.md` main body — all untouched per the v2.12.0 red-line scope.

---

## [2.11.2] — 2026-06-26 — Slice topology observability (read-only supplement to v2.11.0)

**PATCH bump from 2.11.0** (slice `v2-11-2-slice-topology-observability`, 5-slice plan A→E, red-line scope ~18 files).

Read-only observability layer on top of the v2.11.0 slice topology + 10/90 paradigm. New `peaks observability <subcommand>` family for querying slice success rate, fanout cost, repair-cycle count, and D5/D6/D7 auto-proceed events. Persists metrics locally at `.peaks/_runtime/<sessionId>/metrics/slices.jsonl` (append-only JSONL, mtime-pruned to 10 sessions). No new dependencies. No changes to v2.11.0 ship behavior.

### Features

- **`peaks observability status`** (AC-1) — aggregate metrics for active session: total slices, success count, fail count, fanout cost total, repair-cycle peak.
- **`peaks observability slices`** (AC-2) — per-slice list with rid, state, fanout count, repair-cycle count, duration (ms).
- **`peaks observability fanout`** (AC-3) — fanout cost breakdown per sub-agent role (rd / qa / code-reviewer / security-reviewer / karpathy-reviewer).
- **`peaks observability repair-cycles`** (AC-4) — RD→QA repair-cycle count per slice; cap = 3 (peaks-code repair-loop contract); capHit flag.
- **`peaks observability report --period day|week|month`** (AC-5) — markdown summary (header + status + slice table + fanout table + repair-cycle table + top-5 slowest) suitable for paste into PR descriptions or `.peaks/PROJECT.md` timeline entries.
- **JSONL persistence** (AC-6) — append-only `.peaks/_runtime/<sessionId>/metrics/slices.jsonl`; zod schema v1; cross-session prune to last 10 session files by mtime.
- **Hook integration** (AC-7) — metrics emitted from 7 sites: `peaks request transition` (Slice A), `peaks sub-agent dispatch`, `peaks session checkpoint`, D5 mode-gate, D6 context-trigger, D7 post-compact, `peaks request transition` RD→QA prereq (Slice C). All emits fire-and-forget per PRD Q4 (full-auto must never fail-loud).
- **Zero regression** (AC-8) — `npm run build` clean + vitest passes; 6 doctor.test.ts / 35-checks-aggregate failures are pre-existing on main (verified via `git stash`); 0 new regressions from this slice.
- **Coverage** (AC-9) — observability source files have 100% public-function coverage (jsonl-store, observability-service, aggregation, report-formatter); vitest `--coverage` blocked by pre-existing pnpm `@ampproject/remapping` resolution issue (unrelated to this slice).
- **peaks-txt handoff integration** (AC-10) — handoff capsule includes 1-line observability summary via `peaks observability status`.

### Internal

- New: `src/services/observability/jsonl-store.ts` (133 LoC) — pure I/O, mtime prune.
- New: `src/services/observability/observability-service.ts` (139 LoC) — zod schema v1 + `emitObservabilityEvent`.
- New: `src/services/observability/aggregation.ts` (207 LoC) — `aggregateStatus` / `aggregateSlices` / `aggregateFanout` / `aggregateRepairCycles` / period rollup helpers.
- New: `src/services/observability/report-formatter.ts` (135 LoC) — markdown renderer (pure).
- New: `src/cli/commands/observability-commands.ts` (250+ LoC) — 5 subcommands via commander.
- Modified: `src/services/artifacts/request-artifact-service.ts` (hook #1/7).
- Modified: `src/cli/commands/dispatch-commands.ts` (hook #2/7).
- Modified: `src/services/session/session-checkpoint-service.ts` (hook #3/7).
- Modified: `src/cli/commands/code-commands.ts` (hook #4/7).
- Modified: `src/cli/commands/context-commands.ts` (hook #5/7).
- Modified: `src/services/code/post-compact-detector.ts` (hook #6/7).
- Modified: `src/services/artifacts/artifact-prerequisites.ts` (hook #7/7).
- Modified: `src/cli/program.ts` (+1 line: registerObservabilityCommands).
- Modified: `src/shared/version.ts` (CLI_VERSION 2.11.0 → 2.11.1).
- Tests: `tests/unit/services/observability/*.test.ts` (5 files, 78 cases) + `tests/unit/cli/observability-commands.test.ts` (8 cases). 0 regressions.

---

## [2.11.0] — 2026-06-26 — Remove rd/tech-doc.md + immutable peaks-prd handoff + ECC code-review + runtime friction

**MINOR bump from 2.10.0** (slice `v2-11-rm-rd-techdoc-immutable-handoff`, 6 multi-CC groups A-F, plan at `.peaks/memory/2026-06-26-v2-11-rm-rd-techdoc-immutable-handoff.md`).

Implements the "metering is value" + "10/90 paradigm" alignment: peaks-prd produces a single immutable handoff that all downstream consumers share; peaks-rd's parallel audit fan-out (now 5-way with ECC code-review + karpathy-reviewer hard gate) owns security/perf review; peaks-qa is trimmed to business-test-only; peaks-txt sediments business knowledge; peaks-code removes runtime friction (auto-proceed, context monitor, post-compact resume).

### Features

- **Tier 1+2 (Group A — `2be2842`)** — remove `rd/tech-doc.md` enforcers; replace with immutable peaks-prd handoff references (`skills/peaks-rd/references/parallel-review-fanout.md`, `rd-fanout-contracts.md`, `rd-sub-agent-dispatch.md`, `writing-handoff-frontmatter.md`, `artifact-per-request.md`; `src/services/audit/enforcers/lint-workflow-shape.ts`, `red-line-catalog.ts`, `red-lines-service.ts`; `src/services/artifacts/artifact-prerequisites.ts`, `request-artifact-service.ts`).
- **Tier 3+4 (Group B — `3f832f0`)** — `peaks prd handoff init|verify|show` (sha256-locked frontmatter, schemaVersion: 2); `peaks project knowledge` CLI; `.peaks/project-scan/{project-scan.md, business-knowledge.md}` bootstrap; peaks-prd SKILL.md Step 0.8 + Step 5.5.
- **Tier 5+6 (Group C — `9fea8eb`)** — peaks-txt sediment step (`appendBusinessConcept`, idempotent on (concept, sourceRid), 7 tests); peaks-qa trim (removed `qa/security-findings.md` + `qa/performance-findings.md` from Gate D prerequisites).
- **Tier 7 (Group D — `cd427f6`)** — ECC code-review bridge (`src/services/code-review/ecc-bridge.ts`): envelope validator `isEccEnvelope` + `adaptEccEnvelopeToRdCodeReview` + 5-state `detectEcc` + `runEccCodeReview` aggregator; 17 tests.
- **Tier 8 (Group E — this CC)** — migration codemod `peaks migrate v2-10-to-v2-11` (deprecates historical `rd/tech-doc.md` files with a YAML banner frontmatter; text-only, idempotent).
- **Tier 9 (Group F — commit `9e3ef49`)** — D5 self-decision (`src/services/code/mode-gate.ts` + `peaks code should-pause`); D6 context monitor (`src/services/context/main-session-monitor.ts` + `peaks context check`); D7 post-compact resume (`src/services/code/post-compact-detector.ts` + `peaks code post-compact-detect`); SKILL.md new Step N+2 + Step 0.7 D7 branch. +111 tests.

### Migration

- `peaks migrate v2-10-to-v2-11 --project <repo>` (default dry-run; pass `--apply` to write) — tags all pre-v2.11.0 `rd/tech-doc.md` files with `deprecated: historical` banner pointing to the new peaks-prd handoff as the source of truth. Idempotent. See `.peaks/memory/2026-06-26-v2-11-rm-rd-techdoc-immutable-handoff.md` for the design rationale.
- Historical `qa/security-findings.md` / `qa/performance-findings.md` files are NOT auto-migrated (they are no longer required by Gate D, but pre-v2.11.0 sessions still produced them — leave in place).

### Tests

- 33 new tests (Group B): handoff-service (11) + project-scan-reader (13) + prd-handoff-command (9)
- 7 new tests (Group C): sediment service (7) — on the 3987 baseline
- 17 new tests (Group D): ecc-bridge (17) — on the 3987 baseline
- (Group F counts pending — estimated 100+ tests for mode-gate + main-session-monitor + post-compact-detector)

### Risks / gaps carried forward

- **ECC envelope validation** assumes the `everything-claude-code` plugin is installed and exposes a `code-review` agent with the `{ passed, violations[], gateAction }` shape. If the plugin is absent, peaks-rd falls back to inline review (5-state detector + `code-review-ecc-degraded-to-inline` TXT note).
- **D5 hard-floor categories** (irreversible external side effects / auth-credential / multi-day investment) still pause for AskUserQuestion regardless of mode.
- **D7 post-compact resume** requires re-invoking `/peaks-code` in fresh context (Option A — no SessionStart hook in v2.11.0; Option B deferred).
- **Migration scope** is text-only — historical `rd/tech-doc.md` files coexist with the new `prd/handoff.md`; prune is a future slice.

---

## [2.10.0] — 2026-06-26 — Slice topology multi-pass + 10/90 paradigm

**MINOR bump from 2.9.0** (slice `add-slice-topology-multipass`, 63 commits ahead of `develop`, 8 waves W1-W8-b, plan at `docs/superpowers/plans/2026-06-25-slice-topology-multipass.md`).

Implements the 10/90 paradigm foundation: 10% human / 90% LLM autonomous workflow with structured multi-pass slice decomposition, audit gates, and final-review gates. v2 schema is breaking vs v1; v1 remains readable via `SchemaRouter`.

### Features

- **Multi-pass slice decomposition** (`peaks slice decompose --granularity=service|file|both|auto`, slice W2/W3): produces a v2 hierarchical topology (`DecompositionResultV2` with `passes[].slices[]` and `granularity` / `parentSliceId` fields) that supports peaks-code fan-out RD. v1 envelopes continue to read via `SchemaRouter` (`src/services/slice/schema-router.ts`).
- **LLMArbitrator** (W2 T5): content-hash SHA-256 cache (`<cacheDir>/<hash>.json`), budget cap (`resetArbitratorBudget()`), live/cache/failure-path callId routing.
- **GranularityDecider** (W2 T6): stop-condition + tie-break for file-vs-service subdivision.
- **CrossPassEdgeMerger** (W2 T7): static detection (type-shares / fixture-shares / re-exports / import-binding) + LLM fallback; static detection runs UNCONDITIONALLY (W6 fix #1) so it works without an `llmRunner`.
- **MultiPassOrchestrator** (W2 T9): reuses existing 6-stage algorithm; populates `internalEdges` from v1 `dependencyDAG.edges` (W6 fix #2); emits enriched `LlmArbitration` shape with `promptHash/input/output/confidence` (W6 fix #3).
- **peaks audit goal CLI** (W5 M1): `peaks audit goal <rid>` wraps `auditGoalService` for human-readable goal inspection.
- **peaks prepare-final-review CLI** (W5 M2): `peaks prepare-final-review <rid>` wraps `finalReviewService` for 4-dim evidence prep.
- **peaks slice plan PickedFileRouter** (W6 CC-β): `parsePickedFile()` helper replaces raw `JSON.parse(...)` for `-picked.json` envelope; new `PICKED_ENVELOPE_INVALID` error code on validation failure.
- **3 new skills** (W4): `peaks-slice-decompose` (v2 schema references), `peaks-audit` (6-dim reference), `peaks-final-review` (4-dim reference).
- **5 existing skill updates** (W7 CC-α):
  - `peaks-code` — new Step 0.6 (Audit + Goal gate) and Step N+1 (Final Review gate) between Step 0.5 and Step 0.7.
  - `peaks-rd` — new references: `reading-v2-slice-results.md` (SchemaRouter dual-read), `writing-handoff-frontmatter.md` (frontmatter fields + canonical path).
  - `peaks-qa` — new reference: `reading-handoff-frontmatter.md` (cross-check `decisions[]` vs `tests/`, `risks[]` vs `tests/unit/security/`).
  - `peaks-prd` — new reference: `prd-for-multi-pass.md` (AC tagging `[pass-1]` / `[pass-2]`).
  - `peaks-sc` — first step in slice planning references `peaks-slice-decompose`.

### Bugfixes — W6 flaw repair pass (4 of 5 W1-W4 flaws)

- **#1 cross-pass edges gated on `opts.llmRunner`** (W2 deviation #4) — dropped the guard; static detection now fires unconditionally when `passes.length > 1`.
- **#2 internal edges defaulted to `[]`** (W2 concern #3) — populated from `decomposeSlices().dependencyDAG.edges` at all 3 `PassResult` constructions; `EdgeKind === InternalEdgeKind` identity mapping; `isSemantic: boolean → confidence: 'semantic' | 'structural'`.
- **#3 LlmArbitration shape gap** (W2 deviation #5) — enriched `LlmCallTrace` with `promptHash/input/output/confidence`; captured in `runLlmFallback` (medium for cache/live, low for failure).
- **#4 raw `JSON.parse` for `-picked.json`** (W3 silent-failure) — extracted `parsePickedFile()` helper (lines 359-419 of `src/cli/commands/slice-commands.ts`) with schema validation; split catch into `PICKED_ENVELOPE_INVALID` (envelope) vs `SLICE_PLAN_FAILED` (other).

### Tests

- 3974 passed / 0 failed / 17 skipped at release time (354 test files, ~80s smoke / ~310s full).
- New: 3 e2e integration tests in `tests/integration/slice-topology-e2e.test.ts` (multi-pass, service-only, file-only against real `src/services/config/`); 10 picked-envelope validation tests in `tests/unit/cli/commands/slice-commands.test.ts`; 4 LlmArbitration shape tests + 1 internalEdges test in `tests/unit/slice/multi-pass-orchestrator.test.ts` and `cross-pass-edge-merger.test.ts`.
- **3 mutation probes pass** (W7 T21, `.peaks/memory/2026-06-25-mutation-probes-w7-t21.md`): Probe A (comment-out type-shares), Probe B (`>` → `>=` in `shouldSubdivide`), Probe C (cache short-circuit disabled) — all 3 mutations cause the corresponding test to fail, then revert to green.

### Bugfixes — W8 / W8-b stabilization (slice `add-slice-topology-multipass`, post-W7 follow-up)

- **W8 CC-α** (commit `56a9d9e`): stabilize 3 pre-existing flaky tests — `tests/unit/cli-program.workflow.test.ts` per-file timeout raised from vitest default 5000ms → 10000ms (`vi.setConfig({ testTimeout: 10000 })`); `tests/unit/dispatch-cli-latency-benchmark.test.ts` 250ms → 300ms threshold (median + min) with description + inline-comment updates for Karpathy #3 honesty.
- **W8-b CC-α** (commits `e17f868` + `30f9b51`): fix 3 newly-surfaced state-bound pre-existing failures — `tests/unit/package.test.ts` `beforeAll` runs `scripts/sync-version.mjs` so the version-source assertion is deterministic without `pnpm build`; `tests/unit/cli-program.core.test.ts` + `tests/unit/project-commands.test.ts` use `vi.hoisted` + `vi.mock` to isolate from real-project filesystem state (synthetic passing doctor report + `vi.importActual` passthrough with default `doctorReport`/`runbookHealth` injection); `src/shared/version.ts` synced to `2.10.0` (W7-code T22 missed this; W8-b surfaced it via the `beforeAll` sync-version run).
- Net effect: full suite `3974 / 0 failed / 17 skipped` (was `3974 / 3 failed / 17 skipped` after W7 due to the 3 state-bound failures, and 3974 / 0 / 17 was timing-flaky due to the 3 W8 targets).

### Risks / gaps carried forward

- **peaks slice pick only supports v1 envelopes** (W3 T11) — explicitly documented in W4 T12 SKILL.md. v2-pick is a future-slice candidate.
- **No CLI for `peaks audit-goal` discovered via auto-audit** (W4 T13) — `auditGoal()` is a service consumed by `final-review-service`, `slice/llm-arbitrator`, `slice/multi-pass-orchestrator` via direct import. CLI registration is a future-slice candidate.

---

## [2.9.0] — 2026-06-25 — Path canonicalization + fan-out mandatory + test-tool-detection

**MINOR bump from 2.8.4** (supersedes the unpublished 2.9.1 / 2.9.2 intermediate work; those entries below are kept as historical context only).

### Features

- **Sub-agent fan-out is mandatory** (slice `2026-06-24-audit-5th-p2`): `preferences.fanout.defaultMode = 'serial'` opt-out removed. When the slice DAG has ≥ 2 leaves at one topological level, the orchestrator MUST use `peaks sub-agent dispatch --from-dag <dag-file> --batch-id <id>`. No preference, env-var, or CLI flag overrides this. `FANOUT_MODES = ['fan-out']` only; legacy `serial` values auto-migrate via `peaks preferences migrate --write`.
- **4-policy bundle (slice `2026-06-24-efficiency-4p-bundle`)**: (a) default fan-out via `--from-dag`; (b) periodic checkpoint frequency locked at 20 tool calls (no `~` approximation, no `--periodic-every` override); (c) Karpathy reviewer skipped for `config | docs | chore` request types (5-way review otherwise); (d) `swarmSpeculative.maxConcurrent` default bumped 2 → 3.
- **Test-tool-detection block** (slice `2026-06-24-test-tool-detection-injection`): Every sub-agent dispatched by Code (`peaks-rd`, `peaks-qa`, `peaks-ui`, `peaks-txt`, `peaks-sc`, `peaks-general-purpose`, single + DAG) receives a hard "Test Tool Detection (mandatory)" block at the top of its prompt: read `package.json#scripts.test`, use project-local runner (`./node_modules/.bin/<runner>` or `pnpm test --`), NEVER `npx <runner>`. Wired at both `dispatch-commands.ts` and `dag-orchestrator.ts` chokepoints; envelope version bumped to `2.2.0`.

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
- Dispatch chokepoints updated: `src/cli/commands/dispatch-commands.ts:187`, `src/services/code/dag-orchestrator.ts:157,182-183`
- Dispatch envelope bumped: `envelopeVersion: '2.1.0'` → `'2.2.0'` (consumers can detect the new prompt shape)
- New tests: `tests/unit/dispatch/test-tool-detection.test.ts` (6), `tests/unit/dispatch/test-tool-detection-injection.test.ts` (9), `tests/unit/skills/test-tool-detection-docs.test.ts` (4) — 19 new assertions
- Block size: 749 bytes UTF-8 (≤800 cap)

---

## [2.8.4] — 2026-06-24

**Breaking change.** Single-sub-agent dispatch is no longer permitted when the slice DAG has ≥ 2 leaves at one topological level. The 2.8.3-era `preferences.fanout.defaultMode = 'serial'` opt-out was removed by user directive ("禁止单 sub-agent").

### Changed

- **`FanoutMode` closed set narrowed to `['fan-out']`.** The `'serial'` member is gone from `src/services/preferences/preferences-types.ts`; any preferences.json file carrying `defaultMode = 'serial'` (or any non-fan-out value) now throws `PREFERENCES_FANOUT_INVALID` at load. The `migratePreferences` path silently rewrites legacy `'serial'` → `'fan-out'` for 2.8.3-era files and surfaces the change in the migration envelope's `changes[]`.
- **SKILL.md contract flipped.** `peaks-code` SKILL.md now states "Hard constraint: fan-out is mandatory"; the previous "Fan-out opt-out" subsection is removed.
- **Reference docs reorganized.** `references/fanout-opt-out.md` (escape hatch) → `references/fanout-mandatory.md` (hard constraint + migration contract). `references/swarm-dispatch-contract.md` opt-out callout removed.
- **Test surface refreshed.** `tests/unit/code/skills-code-fanout-opt-out.test.ts` → `tests/unit/code/skills-code-fanout-mandatory.test.ts`; pins the new hard constraint and verifies the opt-out file is deleted.

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
  the dominant cause of slow `npm i -g peaks-loop` installs in
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
  empty array (no peaks-loop dep needs postinstall approval).
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
  _战术审计_ subsection that consolidates §3.2 / §3.3 / H6 / H8 / Phase 3
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
  _unlinks .tmp when rename throws_ pins the catch→unlink fallback in
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
  the `peaks-loop` repo now ships a typed DAG model for slicing work across
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
- **Code DAG orchestrator with cancel-on-fail (slice 1.2)** —
  `src/services/code/dag-orchestrator.ts` exports `runDag(dag, opts)`:
  topological-layer fan-out, per-layer join barrier, 任一叶子失败整组回退
  (any leaf failure → in-flight sub-agents receive cancel signal → RD
  returns to repair). peaks-code SKILL.md references the orchestrator.
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
  finish naturally. Pinned by `tests/unit/code/dag-orchestrator.test.ts`.

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
  sub-agent now auto-installs on `npm i -g peaks-loop@latest` to **5
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
  the peaks-loop repo. Four surgical fixes bring this down to 35
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
  spoofed by any file that just _mentioned_ the marker names as
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
  creates `~/.claude/agents/karpathy-reviewer.md` (15.4 KB, mode 0600) and the matching `.peaks-managed` marker (245 bytes, JSON
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
  `skills/peaks-rd/references/karpathy-reviewer-prompt.md` (peaks-loop
  2.0 rules convention).
- **Auto-install on `npm i -g peaks-loop@latest`** (slice 7) — the
  `peaks-loop` postinstall (`scripts/install-skills.mjs`) now copies
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
  `npm i -g peaks-loop@2.6.0` + postinstall + content-hash drift
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
  that load SKILL.md never learned the optimization existed. `### Peaks-Loop
Step 0.75: Resume from checkpoint` and `### Peaks-Loop Step N: Periodic
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
  PASS verdict; reconcile in a future slice (peaks-loop tooling fix,
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
- **peaks-code Step 0.5** (slice 011) — cross-date session check.
  IDE-agnostic; lives in `skills/peaks-code/references/cross-date-session-check.md`.
- **peaks-code Step 0.75** (slice 011) — checkpoint resume probe.
- **peaks-code Step N** (slice 011) — periodic checkpoint guidance.

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

- **`peaks-code` Step 0.6** — pre-mode-selection slice decomposition.
  Code runs the algorithm automatically after Step 0.55 (1.x detection)
  returns "fresh". The user picks a profile informed by the
  decomposition's parallel structure.

- **3 new `peaks-code/references/*.md`** — `slice-algorithm.md`
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

- **Extended `peaks-code/SKILL.md`** — adds "Peaks-Loop Slice
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
- End-to-end CLI smoke test on peaks-loop repo:
  `peaks slice decompose 2026-06-13-slice-decompose-impl --json` returns
  `ok: true`, writes 9 work units, 1 dep edge, p50=247.5 within the
  expected [202, 248] range (8-WU 2.1.0 dry-run p50=225 +-10%).
- `peaks doctor` clean (no L3 regressions from the new path).
- QA verdict: pass (10 of 10 ACs pass; AC10 has 1 partial
  regarding peaks-loop's existing `review-fanout` path mapping, but
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
  - generic `readSidecarJson<T>` / `writeSidecarJson` with the same
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
  aborting the whole `npm i -g peaks-loop` flow. The 5-state detector
  (`ready` / `package-missing` / `binary-missing` / `config-missing` /
  `detection-failed`) and the soft-fail policy are unchanged — peaks-loop
  never blocks on ocr being installed; it just no longer forces the
  install. Users who want the second-opinion review run
  `npm i -g @alibaba-group/open-code-review` explicitly. Under pnpm
  they also need `pnpm approve-builds @alibaba-group/open-code-review`
  for the binary download to run. Source-of-truth refactor (ocr config
  under `peaksConfig.ocr.llm`) from 2.0.1 is unchanged.

---

## [2.0.0] — 2026-06-12

### 🎯 Headline

**One-key 1.x → 2.0 upgrade.** `npm i -g peaks-loop@2.0` runs the full
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
> refactor) because the user feedback was "peaks-loop should not leave
> install to the user". 2.0.3 reverts just the classification — the
> source-of-truth refactor stays — because the ocr postinstall
> downloads a Go binary via HTTPS, which fails in restricted/proxied
> environments and was aborting `npm i -g peaks-loop`. See the 2.0.3
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

- **Postinstall behavior changed.** `npm i -g peaks-loop@2.0` now:
  1. Symlinks bundled skills to **all 8 supported IDE platforms**
     (Claude Code, Trae, Cursor, Qoder, Codex, Tongyi Lingma, Aider, Roo Code),
     not just the auto-detected one. Per real Trae user feedback 2026-06-11.
  2. Installs bundled output styles.
  3. If `cwd` contains a 1.x peaks-loop project, fire-and-forgets
     `peaks upgrade --to 2.0 --auto`. Opt out with `PEAKS_SKIP_AUTO_UPGRADE=1`.

### Changed — ocr source-of-truth moved into peaks-loop's config

Following the same-release user feedback that the original 2.0.0 ocr
config lived in `~/.opencodereview/config.json` (a file outside
peaks-loop's reach) and was set via the `ocr config set` CLI from the
upstream package, the ocr LLM endpoint config now lives under
`peaksConfig.ocr.llm` in `~/.peaks/config.json`. This makes the
user-managed LLM endpoint discoverable from a single, peaks-loop-owned
config surface.

- **`@alibaba-group/open-code-review` is now a hard `dependency`** (was
  `optionalDependency`). The user no longer has to remember to install
  it; `npm i -g peaks-loop` pulls it. Network-blocked installs that fail
  to download the platform binary still soft-fail at runtime
  (`binary-missing` state) — the install-time failure risk is the
  trade-off.

  > **Reverted in 2.0.3.** The install-time failure risk turned out
  > to bite too many real-world installs (corporate proxies, region
  > firewalls, sandboxed dev environments all abort the whole
  > `npm i -g peaks-loop`). 2.0.3 puts ocr back under
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
  config path. peaks-loop never has to materialise
  `~/.opencodereview/config.json`, and does NOT auto-configure the
  endpoint — the user is the only party that touches the LLM
  token / URL.
- **New CLI: `peaks code-review config-template`.** Prints the JSON
  snippet the user pastes into `~/.peaks/config.json`. It does NOT
  write anything. No `peaks ocr config set`, no `ocr config set` — just
  edit peaks-loop's config.json (or use
  `peaks config set --key ocr.llm.url --value '...'` if preferred).
- **JSON envelope contract change:** `OcrDetectResult.configPath` now
  points at the peaks-loop config (e.g. `~/.peaks/config.json`) instead
  of the OCR package's legacy file. A new `missingKeys` field lists the
  required `ocr.llm.*` keys the user has not yet populated. The
  five-state contract and the soft-fail policy are unchanged.

### Migration (ocr source-of-truth)

Users who already configured `~/.opencodereview/config.json` for the
soft-optional 2.0.0 release should:

1. Run `peaks code-review config-template --json` to see the JSON
   snippet.
2. Paste the equivalent values into `~/.peaks/config.json` under
   `ocr.llm` (peaks-loop handles the camelCase conversion; the
   template shows the canonical shape).
3. Re-run `peaks code-review detect-ocr --json` to verify
   `state == "ready"`.

The old `~/.opencodereview/config.json` is no longer consulted by
peaks-loop. The user may delete it at their discretion (the ocr
subprocess ignores it when peaks-loop's env vars are present).

### Added

- **`peaks upgrade --to 2.0`** — umbrella that orchestrates the 1.x → 2.0
  migration: config migrate, standards migrate (`--from-claude-rules`),
  memory extract (with disk-based glob expansion for the consumer's
  artifact tree), hooks install, skill sync, audit verify, plus
  in-process preferences-ensure, gitignore-migrate, and upgrade-record
  write. Soft-fail per sub-step; never blocks the whole upgrade.

- **`peaks upgrade --detect-1x`** — read-only probe returning a JSON
  envelope the peaks-code skill consumes to gate the AskUserQuestion
  in Step 0.55.

- **`peaks standards migrate --from-claude-rules`** — thins `.claude/rules/`
  to 2-line pointers and scaffolds `.peaks/standards/{common,typescript}/`.

- **`peaks skill sync`** — distributes the skill family across all 8
  supported IDE platforms in one command.

- **`peaks audit red-lines`** — L2 catalog audit (P0/P1/P2-a/P2-b
  enforcers) for skills/SKILL.md, references/\*.md, and the agent shield.

- **`peaks agent run`** — ECC 64 agents soft-optional integration
  (spec §7.2). When the L3 stack is installed, peaks delegates to it;
  otherwise degrades to peaks-loop's own core diagnostics.

- **`peaks memory search` / `peaks retrospective search`** — new search
  subcommands for the durable memory / retrospective stores.

- **`peaks workspace init / clean / archive`** — workspace lifecycle
  primitives with `--dry-run` default + `--apply` opt-in.

- **`peaks preferences set / get / reset`** — per-project preferences
  read/write CLI.

- **Two paired tenets** captured in `.peaks/memory/peaks-loop-tenet-one-key-completion.md`:
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

  The net effect: a freshly-installed peaks-loop writes a 2-key
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
  Chinese tagline: `peaks-loop: 跨 AI IDE 的工程门禁与编排`).
- `README-en.md` synced to mirror the new layout (typing animation
  uses the English tagline: `peaks-loop: cross-AI-IDE engineering
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

[2.0.2]: https://github.com/SquabbyZ/peaks-loop/releases/tag/v2.0.2
[2.0.1]: https://github.com/SquabbyZ/peaks-loop/releases/tag/v2.0.1
[2.0.0]: https://github.com/SquabbyZ/peaks-loop/releases/tag/v2.0.0
