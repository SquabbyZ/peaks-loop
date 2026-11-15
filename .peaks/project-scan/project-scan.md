---
schemaVersion: 1
capturedAt: 2026-11-15T09:15:00.000Z
techStack:
  language: typescript
  packageManager: "pnpm@10.11.0"
  runtime: "node>=24.0.0 (active v24.12.0)"
  buildTool: tsc -p tsconfig.build.json
  testRunner: vitest
  mutationRunner: "@stryker-mutator/core ^9.6.1"
  lintTool: eslint@8.57.1
libraryVersions:
  commander: "^12.1.0"
  yaml: "^2.9.1"
  zod: "^4.6.7"
  fzf: "^0.5.2"
  picomatch: "4.0.7"
  vitest: "^4.1.10"
  "@vitest/coverage-v8": "^4.1.10"
  "@vitest/coverage-istanbul": "^4.1.10"
  c8: "^10.1.3"
  vite: "^6.0.0"
  typescript: "^5.7.2"
  tsx: "^4.19.2"
  eslint: "8.57.1"
  prettier: "^3.9.8"
  husky: "^9.1.7"
  lint-staged: "^15.5.2"
  "@types/node": "^24.19.1"
  "@stryker-mutator/core": "^9.6.1"
  "@stryker-mutator/vitest-runner": "^9.6.1"
  "@colbymchenry/codegraph": "1.6.2"
  "@upstash/context7-mcp": "^4.4.4"
  "@alibaba-group/open-code-review": "^1.13.1 (required dep, see slice PRD-002 sediment)"
architecture: |
  peaks-loop is a TypeScript Node CLI monorepo for AI-coding workflow orchestration.
  Architecture:
    skills/             — 17 top-level skill dirs; 9 bee roles live under skills/bee/
                          (peaks-prd / peaks-rd / peaks-qa / peaks-ui / peaks-txt / peaks-sc
                          / peaks-reviewer / peaks-perf-audit / peaks-security-audit)
    src/services/       — 99 typed business modules (one concern each)
    src/cli/commands/   — 424 Commander subcommand registration files
    src/{hooks,lib,reporters,shared,skills,templates}/ — cross-cutting surfaces
    packages/           — 5 workspace packages (see "Workspace packages" below)
    .peaks/             — runtime artifact workspace (requests, memory, project-scan)
  Hard contracts enforced mechanically:
    800-line file cap (peaks scan file-size gate, Karpathy §2 simplicity-first)
    sha256-locked handoff (services/prd/handoff-service.ts, schemaVersion: 2)
    two-axis workspace (.peaks/_runtime/<sessionId>/... plus .peaks/_runtime/change/<changeId>/...)
    workspace hard ban on .peaks/_runtime/<change-id>/ or <YYYY-MM-DD-*>/ at top level
    vitest pinned at ^4.1.10 (locked 2026-07-25 — do NOT propose 5.x; user directive)
    coverage floor (.peaks/lint/coverage-floor.json, raised only by .husky/coverage-ratchet.mjs) — the c8 100% gate was removed 2026-10-17 (backlog §13.4 rule 2)
karpathySelfCheck:
  simpleFirst: "800-line file cap + Karpathy §2 enforced by peaks scan file-size. Every new module is the minimum code that solves the problem."
  surgicalChanges: "Touch only what the request requires. Every changed line traces to a PRD AC or risk note. No refactor-adjacent cleanup in feature slices."
  goalDriven: "Every slice declares verifiable ACs in the PRD/RD artifact; tsc + vitest + scan gates verify before qa-handoff."
  thinkBefore: "Every dispatch prompt carries the 4 Karpathy guidelines verbatim (andrej-karpathy-skills:karpathy-guidelines). RD artifact names red-line scope before any code change."
---

# Peaks-Loop Project Scan (4.2.0 baseline)

> Auto-bootstrap of `.peaks/project-scan/project-scan.md`. Refresh with
> `peaks project context --project .` after every major dependency bump.
>
> 2026-09-12: the data below was refreshed in place rather than regenerated —
> `peaks project context` preserves existing files, and this one carries
> hand-authored reasoning (the vitest pin, the c8-over-built-in-coverage note)
> that a regeneration would have destroyed.
>
> 2026-10-20: refreshed in place again after the production-dependency bump
> (`@alibaba-group/open-code-review` 1.13.1, `@upstash/context7-mcp` 4.4.4,
> `picomatch` 4.0.7, `yaml` 2.9.1, `zod` 4.6.7). Stale rows for removed
> `better-sqlite3` / `headroom-ai` dropped, `codegraph` corrected to 1.6.2,
> `engines.node` corrected to `>=24.0.0`.
>
> 2026-11-15: refreshed in place for the 4.2.0 release. Corrections that had
> drifted from `package.json` and the tree: `@stryker-mutator/core` moved
> `^8.7.1` → `^9.6.1` (runner already 9.6.1; the two must move together);
> build script is `tsc -p tsconfig.build.json`, not `tsconfig.json`; lint is
> **configured** (`eslint@8.57.1` + `pnpm lint` → `scripts/lint/run-lint.mjs`),
> so the old "no lint configured" row is gone; workspace-package, skill-dir and
> surface counts refreshed (5 packages / 17 skill dirs / 9 bee roles /
> 99 services / 424 CLI command files). Design and conventions from the earlier
> revisions were kept verbatim.

## Archetype

| Field | Value |
|---|---|
| Type | `cli` |
| Confidence | `high` |

## Project mode

| Field | Value |
|---|---|
| Integration mode | prd-only |
| Integration mode reason | no-backend-no-interface-doc |
| Frontend-only | `false` |
| Reason | archetype=cli |

## Tech stack

| Concern | Value |
|---|---|
| Language | TypeScript (`^5.7.2`) |
| Package manager | pnpm (`10.11.0`) |
| Node runtime | `>= 24.0.0` (active: v24.12.0) |
| Monorepo | pnpm workspace — 5 packages under `packages/` (see below) |
| Build | `tsc -p tsconfig.build.json` (root, via `pnpm build`) + per-package `tsc -p tsconfig.json` |
| Tests | vitest (`^4.1.10` — **pinned, do NOT bump to 5.x**) |
| Coverage | vitest's built-in coverage, driven by `.husky/coverage-ratchet.mjs` against the floor in `.peaks/lint/coverage-floor.json` (`c8` `^10.1.3` remains a devDependency); the c8 100% gate (`scripts/coverage-c8.mjs`) was removed 2026-10-17 (backlog §13.4 rule 2) |
| Mutation | `@stryker-mutator/core ^9.6.1` + `@stryker-mutator/vitest-runner ^9.6.1` (slice-only) |
| Lint | `eslint 8.57.1` via `pnpm lint` → `scripts/lint/run-lint.mjs` (covers `src/` + `packages/`; **`tests/` is not linted**) |
| Format | Prettier `^3.9.8` + lint-staged `^15.5.2` on pre-commit |

## Library versions

| Package | Pinned range | Notes |
|---|---|---|
| `commander` | `^12.1.0` | CLI subcommand tree (newest 12.x) |
| `yaml` | `^2.9.1` | frontmatter serialize/parse (handoff-service) |
| `zod` | `^4.6.7` | schema validation across services |
| `fzf` | `^0.5.2` | fuzzy selector (sub-agent dispatch) |
| `picomatch` | `4.0.7` | extended-glob matching (codegraph-exclude-reconciler); exact pin preserved |
| `vitest` | `^4.1.10` | unit + integration tests (LOCKED 2026-07-25) |
| `@vitest/coverage-v8` | `^4.1.10` | the provider `.husky/coverage-ratchet.mjs` measures through |
| `@vitest/coverage-istanbul` | `^4.1.10` | bundled but unused |
| `c8` | `^10.1.3` | kept as a devDependency; the `--100` gate that used it was removed 2026-10-17 |
| `vite` | `^6.0.0` | vitest peer (no runtime use) |
| `tsx` | `^4.19.2` | `peaks dev` runtime |
| `eslint` | `8.57.1` | lint gate (`pnpm lint`); 8.x, not flat-config 9.x |
| `prettier` | `^3.9.8` | formatting; `pnpm format` / `format:check` |
| `husky` | `^9.1.7` | pre-commit + pre-push gate hooks |
| `lint-staged` | `^15.5.2` | staged-file formatting on commit |
| `@types/node` | `^24.19.1` | matches the Node 24 runtime floor |
| `@stryker-mutator/core` | `^9.6.1` | mutation testing (slice-only); moved from 8.x on 2026-11-15 |
| `@stryker-mutator/vitest-runner` | `^9.6.1` | stryker↔vitest bridge (must match core major) |
| `@colbymchenry/codegraph` | `1.6.2` | optional project analysis (untrusted, supporting evidence only) |
| `@upstash/context7-mcp` | `^4.4.4` | declared but not yet imported (`scan-orchestrator.ts` TODO) |
| `@alibaba-group/open-code-review` | `^1.13.1` | required runtime dep; 1.13.x per-platform optionalDependencies replaces 2.0.3 HTTPS postinstall |

## Workspace packages (`packages/`)

| Package | Version | Consumed as | Provides |
|---|---|---|---|
| `peaks-loop-shared` | `0.0.116` | `peaks-loop-shared/<subpath>` | `result` / `paths` / `paths-resolve` / `fs` / `version` primitives imported across `src/` |
| `peaks-loop-mut` | `0.1.81` | `peaks-loop-mut` | mutation-testing + assertion-scan engine (behind `peaks mut`) |
| `peaks-loop-internal-runtime` | `0.0.67` | `peaks-loop-internal-runtime` | internal runtime primitives |
| `peaks-loop-shared-channel` | `0.0.84` | `peaks-loop-shared-channel` | cross-batch sub-agent shared channel |
| `peaks-loop-workspace-runtime` | `0.0.1` | `peaks-loop-workspace-runtime` | `lease/` + `worktree/` + `state-root` — extracted 2026-11-05 (S1) |

`packages/*/dist` is **untracked and not built by `pnpm test`** — a gate leg that
needs it must build first, or it reports TS2307/TS7016 as *blocked*, not red.

## Architecture (one-paragraph)

skills/ (declarative, 17 top-level dirs + 9 bee roles) + src/services/ (99 typed modules) +
src/cli/commands/ (424 Commander files) + 5 workspace packages.
Hard contracts: 800-line cap, sha256-locked handoff, two-axis workspace, workspace hard ban.
See `src/services/prd/handoff-service.ts` (immutable handoff) and
`src/services/prd/project-scan-reader.ts` (this file's reader).

## Index artifacts

| Artifact | Location | Tracked? | Refresh |
|---|---|---|---|
| codegraph index | `.codegraph/` (sqlite, backend `node:sqlite`) | **no** — `.gitignore:14` | `peaks codegraph repair-index --project .` (full rebuild; the only path that drops stale rows) |
| codegraph config | `codegraph.json` | yes | manual |
| project context | `.peaks/PROJECT.md` | yes | `peaks project context --project .` (regenerates the session timeline) |
| project scan | `.peaks/project-scan/project-scan.md` | yes | **manual, in place** — `peaks project context` skips an existing scan (`skipped: true`), so a regeneration cannot refresh it |

## Karpathy self-check

| Guideline | Where enforced |
|---|---|
| §1 Think Before Coding | Every dispatch prompt + RD artifact `## Red-line scope` |
| §2 Simplicity First | `peaks scan file-size` 800-line gate |
| §3 Surgical Changes | RD plan + cascade scope ("primary N only + fix build breaks") |
| §4 Goal-Driven Execution | PRD ACs → RD tech-doc → vitest gates → qa-handoff |

## Refresh procedure

1. `pnpm test --coverage` to verify nothing regressed against the schema
2. Manually update `libraryVersions` from `package.json` after any bump
3. Update `capturedAt` to current ISO timestamp
4. Commit alongside the dependency bump
5. **Vitest bump requires explicit user approval** — 4.1.10 is a hard pin per `peaks-vitest-locked-4-1-10` memory
6. **Coverage tool** is vitest's built-in coverage, driven by `.husky/coverage-ratchet.mjs` against the floor in `.peaks/lint/coverage-floor.json` — the c8 100% gate was removed 2026-10-17
7. **Stryker `core` and `vitest-runner` must stay on the same major** — bump them in one commit
8. This file is refreshed **by hand**: `peaks project context` reports
   `projectScan.skipped: true` when the file already exists, so re-running it
   never refreshes the rows below