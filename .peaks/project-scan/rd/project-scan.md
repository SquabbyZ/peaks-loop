# Project Scan: peaks-loop
**Date:** 2026-06-04
**Session:** 2026-06-04-session-b60252

## Archetype
- Type: legacy-frontend
- Confidence: high
- Signals matched:
  - backend-presence: false (no backend framework, no next API routes, no backend dirs)
  - swagger-or-proto: false (no swagger/openapi/proto)
  - monorepo-config: false (no monorepo config)
  - src-size: true (128 source files in src/)
  - lockfile-age: false (0 days)
- Detected:
  - hasPackageJson: true
  - hasBackendFramework: false
  - backendFrameworks: []
  - hasSwaggerOrProto: false
  - swaggerPaths: []
  - hasMonorepoConfig: false
  - monorepoConfigs: []
  - hasNextApiRoutes: false
  - srcFileCount: 128
  - backendDirsPresent: []
  - lockfileAgeDays: 0

## Project mode
- Frontend-only: true
- Reason: archetype=legacy-frontend (no backend framework detected; peaks-loop itself is a CLI, not a web app, so the legacy-frontend label is the closest archetype match in the absence of dedicated CLI detection)

## Build tool
- Framework: TypeScript (no React/Vite/Next.js; this is a Node CLI built with `tsc` directly)
- Config file: tsconfig.json
- Compiled by: `tsc -p tsconfig.json` → `dist/src/cli/index.js`
- Mixed builds: false
- Package manager: pnpm@10.11.0
- Engines: node >=20.0.0

## Component library
- Library: none (this is a CLI; UI surfaces are terminal output only — chalk + ora + terminal-kit)
- Terminal styling: chalk ^5.6.2, ora ^8.2.0, terminal-kit ^3.1.2
- In-house design system: none (no UI component directory)

## CSS solution
- Primary: N/A (no web frontend)
- Conflicts detected: none

## State management, routing, data fetching
- State: in-memory + on-disk artifact store (`.peaks/_runtime/<session>/`, JSON files; no React/store library)
- Routing: commander.js (`peaks <cmd>` CLI tree, not URL routing)
- Data fetching: native fs + child_process spawn (no HTTP client by default; codegraph uses optional `@colbymchenry/codegraph`)

## CLI command surface
- `peaks` (root command, `bin/peaks.js` → `dist/src/cli/index.js`)
- Top-level groups: workspace, skill, request, scan, sc, sop, gate, memory, project, standards, openspec, hooks, statusline, doctor, workflow, mcp, capabilities, codegraph
- Output envelope: stable `{ok, command, data, warnings, nextActions}` JSON shape (per project memory)

## Legacy constraints
- N/A for greenfield-style CLI. No React, no class components, no Enzyme, no moment, no jQuery.
- "Legacy" here means: large existing surface area (128 src files) and many shipped features, but modern stack (TypeScript strict, ESM, Vitest, pnpm).
- Stated user preferences to honor:
  - Edit main directly, no worktree by default (see [[main-branch-iteration]])
  - Stay within current project directory; do not touch `~/.claude` / `~/.peaks` (see [[peaks-current-directory-scope]])
  - Coverage must come from meaningful tests, not padding (see [[coverage-red-line]])

## Skills shipped (under `skills/`)
- peaks-solo (orchestrator), peaks-rd, peaks-qa, peaks-prd, peaks-sop, peaks-sc, peaks-txt, peaks-ui
- Skill manifest installed by `scripts/install-skills.mjs` on `postinstall`

## Recent feature history (from project memory)
- Feature A (custom SOP authoring) SHIPPED 2026-05-29: scaffolder + `peaks sop lint` + gate registry + project-layer SOP support (Slice 2, 2026-05-30)
- Feature B (tiered SOP metering, open-core商业层) DEFERRED 2026-05-29 — dogfood first
- PreToolUse hook for un-bypassable gate enforcement (commit b289cd6)
- **2026-06-02** `e611daf` — feat(memory): hot/warm index + session extract with idempotency + --dry-run/--apply parity. Closes BLOCKER 1 (idempotency) / 2 (session-id containment via `assertSafeSessionDir`) / 3 (CLI parity) + MEDIUM (index provenance: `sourcePath` + `sourceArtifact` + file-mtime `updatedAt`) + minor (dedup walkers via `listMarkdownFiles({maxDepth, skipDotfiles})`). 4 new tests. Adds 2 new commands: `peaks project memories:extract` + `peaks project memory-index`. Wired into `peaks-rd` / `peaks-qa` / `peaks-sop` / `peaks-solo` runbook handoff.
- **2026-06-02** `d876569` — fix(memory): extract --apply is now idempotent + always regens index.json (precursor to e611daf).
- **2026-06-03** `cc9edc4` — chore(memory): clear 2 minor findings + retire stale review memory. Extracts `MIN_BODY_SENTENCE_LENGTH=20` / `MAX_DESCRIPTION_LENGTH=120` / `ELLIPSIS_RESERVE=3` constants; adds `shouldRegenerateIndex` mtime guard (strict `>`). The review memory `review-memories-extract-and-memory-index` is now **CLOSED** in `index.json` (`closedAt: 2026-06-02, closedBy: e611daf, remainingMinorSlice: 2026-06-03-memory-housekeeping-minor-findings` which is itself closed).
- **2026-06-03** `2171d03` — chore(memory): close 2 test-coverage gaps from slice final review. Adds 2 tests (118-char `summarizeMemoryBody` boundary + equal-mtime `shouldRegenerateIndex` strict-`>`). 38 → 40 tests in `tests/unit/project-memory-service.test.ts`.
- **2026-06-03** `d94df96` — Revert "2171d03" (transient; re-applied via subsequent fix).
- **2026-06-03** `5c194f1` — chore(memory): fix equal-mtime test precision on Windows NTFS.
- 4 supporting docs in `docs/superpowers/{plans,specs}/2026-06-03-memory-housekeeping-{minor-findings,test-coverage-close-outs}*.md` (design + plan artifacts for the two slices).

## Known minor issues (non-blocking)
- `index.json` `sourcePath` field still contains the **Windows dev-machine absolute paths** (e.g. `C:\Users\smallMark\Desktop\peaks-loop\...`) committed by an earlier Windows run. Functionally harmless — `sourcePath` is informational and not used to open files (the read path uses `listMarkdownFiles` against the live memory dir, and `shouldRegenerateIndex` does mtime comparison, not path comparison). Worth a 5-line cleanup PR to switch `sourcePath` to a repo-relative path so cross-platform dev (Windows reviewer + Mac user) doesn't surface this as a false-positive bug.
