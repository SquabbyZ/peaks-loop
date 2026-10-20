---
schemaVersion: 1
capturedAt: 2026-10-20T02:10:15.413Z
techStack:
  language: typescript
  packageManager: pnpm
  runtime: "node>=24.0.0 (active v24.12.0)"
  buildTool: tsc -p tsconfig.json
  testRunner: vitest
  mutationRunner: "@stryker-mutator/core ^8.7.1"
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
  "@stryker-mutator/core": "^8.7.1"
  "@stryker-mutator/vitest-runner": "^9.6.1"
  "@colbymchenry/codegraph": "1.6.2"
  "@upstash/context7-mcp": "^4.4.4"
  "@alibaba-group/open-code-review": "^1.13.1 (required dep, see slice PRD-002 sediment)"
architecture: |
  peaks-loop is a TypeScript Node CLI for AI-coding workflow orchestration.
  Architecture:
    skills/             — declarative reference docs (peaks-code / peaks-rd / peaks-qa / peaks-prd / peaks-ui / peaks-txt / peaks-sc)
    src/services/       — typed business services (one module per concern)
    src/cli/commands/   — Commander.js subcommand registration surface
    src/shared/         — cross-cutting types + helpers (result / paths / version / format)
    .peaks/             — runtime artifact workspace (PRD/RD/QA/TXT requests, memory, project-scan)
  Hard contracts enforced mechanically:
    800-line file cap (peaks scan file-size gate, Karpathy §2 simplicity-first)
    sha256-locked handoff (services/prd/handoff-service.ts, schemaVersion: 2)
    two-axis workspace (.peaks/_runtime/<sessionId>/..., .peaks/_runtime/change/<changeId>/...)
    workspace hard ban on .peaks/_runtime/<change-id>/ or <YYYY-MM-DD-*>/ at top level
    vitest pinned at ^4.1.10 (locked 2026-07-25 — do NOT propose 5.x; user directive)
    coverage floor (.peaks/lint/coverage-floor.json, raised only by .husky/coverage-ratchet.mjs) — the c8 100% gate was removed 2026-10-17 (backlog §13.4 rule 2)
karpathySelfCheck:
  simpleFirst: "800-line file cap + Karpathy §2 enforced by peaks scan file-size. Every new module is the minimum code that solves the problem."
  surgicalChanges: "Touch only what the request requires. Every changed line traces to a PRD AC or risk note. No refactor-adjacent cleanup in feature slices."
  goalDriven: "Every slice declares verifiable ACs in the PRD/RD artifact; tsc + vitest + scan gates verify before qa-handoff."
  thinkBefore: "Every dispatch prompt carries the 4 Karpathy guidelines verbatim (andrej-karpathy-skills:karpathy-guidelines). RD artifact names red-line scope before any code change."
---

# Peaks-Loop Project Scan (v2.11.0 → v2.13.0 baseline)

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

## Archetype

| Field | Value |
|---|---|
| Type | `frontend-monorepo` |
| Confidence | `high` |

## Project mode

| Field | Value |
|---|---|
| Integration mode | prd-only |
| Integration mode reason | no-backend-no-interface-doc |
| Frontend-only | `true` |
| Reason | archetype=frontend-monorepo |

## Tech stack

| Concern | Value |
|---|---|
| Language | TypeScript (`^5.7.2`) |
| Package manager | pnpm (`10.11.0`) |
| Node runtime | `>= 24.0.0` (active: v24.12.0) |
| Build | `tsc -p tsconfig.json` (root) + per-package `tsc -p tsconfig.json` |
| Tests | vitest (`^4.1.10` — **pinned, do NOT bump to 5.x**) |
| Coverage | vitest's built-in coverage, driven by `.husky/coverage-ratchet.mjs` against the floor in `.peaks/lint/coverage-floor.json` (`c8` `^10.1.3` remains a devDependency); the c8 100% gate (`scripts/coverage-c8.mjs`) was removed 2026-10-17 (backlog §13.4 rule 2) |
| Mutation | `@stryker-mutator/core ^8.7.1` (slice-only) |
| Lint | (none configured; formatting per `.editorconfig` + Prettier hooks) |

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
| `@stryker-mutator/core` | `^8.7.1` | mutation testing (slice-only) |
| `@stryker-mutator/vitest-runner` | `^9.6.1` | stryker↔vitest bridge |
| `@colbymchenry/codegraph` | `1.6.2` | optional project analysis (untrusted, supporting evidence only) |
| `@upstash/context7-mcp` | `^4.4.4` | declared but not yet imported (`scan-orchestrator.ts` TODO) |
| `@alibaba-group/open-code-review` | `^1.13.1` | required runtime dep; 1.13.x per-platform optionalDependencies replaces 2.0.3 HTTPS postinstall |

## Architecture (one-paragraph)

skills/ (declarative) + src/services/ (typed) + src/cli/commands/ (Commander surface).
Hard contracts: 800-line cap, sha256-locked handoff, two-axis workspace, workspace hard ban.
See `src/services/prd/handoff-service.ts` (immutable handoff) and
`src/services/prd/project-scan-reader.ts` (this file's reader) for the v2.11.0 additions.

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