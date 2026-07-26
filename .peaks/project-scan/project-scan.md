---
schemaVersion: 1
capturedAt: 2026-07-26T12:20:00.000Z
techStack:
  language: typescript
  packageManager: pnpm
  runtime: "node>=20.0.0 (active v22.22.1)"
  buildTool: tsc -p tsconfig.json
  testRunner: vitest
  mutationRunner: "@stryker-mutator/core ^8.7.1"
libraryVersions:
  commander: "^12.1.0"
  yaml: "^2.9.0"
  zod: "^3.25.76"
  zod-to-json-schema: "^3.25.2"
  fzf: "^0.5.2"
  vitest: "^4.1.10"
  "@vitest/coverage-v8": "^4.1.10"
  "@vitest/coverage-istanbul": "^4.1.10"
  c8: "^10.1.3"
  vite: "^6.0.0"
  typescript: "^5.7.2"
  tsx: "^4.19.2"
  better-sqlite3: "^12.11.1"
  headroom-ai: "0.22.4"
  "@stryker-mutator/core": "^8.7.1"
  "@stryker-mutator/vitest-runner": "^9.6.1"
  "@colbymchenry/codegraph": "0.7.10"
  "@alibaba-group/open-code-review": "1.3.1 (optional peer)"
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
    coverage via c8 (scripts/coverage-c8.mjs) — NOT vitest's built-in coverage (4.x has structural per-project config overwrite)
karpathySelfCheck:
  simpleFirst: "800-line file cap + Karpathy §2 enforced by peaks scan file-size. Every new module is the minimum code that solves the problem."
  surgicalChanges: "Touch only what the request requires. Every changed line traces to a PRD AC or risk note. No refactor-adjacent cleanup in feature slices."
  goalDriven: "Every slice declares verifiable ACs in the PRD/RD artifact; tsc + vitest + scan gates verify before qa-handoff."
  thinkBefore: "Every dispatch prompt carries the 4 Karpathy guidelines verbatim (andrej-karpathy-skills:karpathy-guidelines). RD artifact names red-line scope before any code change."
---

# Peaks-Loop Project Scan (v2.11.0 → v2.13.0 baseline)

> Auto-bootstrap of `.peaks/project-scan/project-scan.md`. Refresh with
> `peaks project knowledge --project .` after every major dependency bump.

## Tech stack

| Concern | Value |
|---|---|
| Language | TypeScript (`^5.7.2`) |
| Package manager | pnpm (`10.11.0`) |
| Node runtime | `>= 20.0.0` (active: v22.22.1) |
| Build | `tsc -p tsconfig.json` (root) + per-package `tsc -p tsconfig.json` |
| Tests | vitest (`^4.1.10` — **pinned, do NOT bump to 5.x**) |
| Coverage | c8 (`^10.1.3`) via `scripts/coverage-c8.mjs`; vitest's built-in coverage is **disabled** (4.x has structural per-project config overwrite bug — see `2026-07-25-b1-vitest-coverage-tooling-closure.md`) |
| Mutation | `@stryker-mutator/core ^8.7.1` (slice-only) |
| Lint | (none configured; formatting per `.editorconfig` + Prettier hooks) |

## Library versions

| Package | Pinned range | Notes |
|---|---|---|
| `commander` | `^12.1.0` | CLI subcommand tree |
| `yaml` | `^2.9.0` | frontmatter serialize/parse (handoff-service) |
| `zod` | `^3.25.76` | schema validation across services |
| `zod-to-json-schema` | `^3.25.2` | CLI schema export |
| `fzf` | `^0.5.2` | fuzzy selector (sub-agent dispatch) |
| `vitest` | `^4.1.10` | unit + integration tests (LOCKED 2026-07-25) |
| `@vitest/coverage-v8` | `^4.1.10` | bundled but unused (c8 reads raw V8 output directly) |
| `@vitest/coverage-istanbul` | `^4.1.10` | bundled but unused |
| `c8` | `^10.1.3` | post-test coverage merge (100% threshold via `--100`) |
| `vite` | `^6.0.0` | vitest peer (no runtime use) |
| `tsx` | `^4.19.2` | `peaks dev` runtime |
| `better-sqlite3` | `^12.11.1` | native binding for retrospective state |
| `headroom-ai` | `0.22.4` | sub-agent context compression (optional) |
| `@stryker-mutator/core` | `^8.7.1` | mutation testing (slice-only) |
| `@stryker-mutator/vitest-runner` | `^9.6.1` | stryker↔vitest bridge |
| `@colbymchenry/codegraph` | `0.7.10` | optional project analysis (untrusted, supporting evidence only) |
| `@alibaba-group/open-code-review` | `1.3.1` | optional peer (ECC code-review bridge — Group D) |

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
6. **Coverage tool** is c8, not vitest — do not switch back without re-validating the 4.x per-project config bug