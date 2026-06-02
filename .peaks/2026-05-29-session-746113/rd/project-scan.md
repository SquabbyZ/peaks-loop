# Project scan — peaks-cli (RD preflight)

> Generated 2026-06-01 for RD request `2026-06-02-sop-global-reuse-ux-v2` (PR 005 v2).
> Reused for RD 2026-06-02-grep-strip-meta (PRD 006) on 2026-06-02 with the additions noted at the bottom.
> Re-run only if the project surface changes.

## Build tool and framework

- Build: `tsc -p tsconfig.json` (Node CLI; no React/Vite/Next/Umi).
- Runtime: Node 20+ on Windows / POSIX; entry `bin/peaks.js` wraps `dist/cli/index.js`.
- Package manager: npm; lockfile `package-lock.json` present.
- Test: `vitest` (`npx vitest run`); coverage via `c8` per `vitest.config.ts`.

## Component library / CSS

- N/A. CLI project. No component library, no CSS framework.
- Console output via `src/shared/result.ts` envelope (`{ok, command, data, warnings, nextActions}`).

## State management / routing / data fetching

- N/A. No frontend; no client state, routing, or data-fetching libraries.
- CLI state lives in `<project>/.peaks/` and `~/.peaks/` (per [sop-paths.ts](src/services/sop/sop-paths.ts) — dual layer: project-first, global fallback, merged registry view).

## SOP architecture (in-scope for this iteration)

- Definitions: `src/services/sop/sop-service.ts` (init/lint), `sop-registry-service.ts` (register/read).
- Enforcement: `sop-check-service.ts` (per-gate evaluate), `sop-advance-service.ts` (phase advancement with gate blocking and phase-skip guard), `gate-enforce-service.ts` (PreToolUse hook handler).
- Types: `sop-types.ts` (gate check variants: file-exists / grep / command; gate, phase guard, manifest).
- Paths: `sop-paths.ts` (homedir, PEAKS_HOME override, project layer, merged view).
- CLI: `src/cli/commands/sop-commands.ts` (`sop init/lint/register/registry/check/advance`) and `gate-commands.ts` (`gate enforce/bypass/status/install`).

## Existing tests (reused, no new scaffolds needed)

- `tests/unit/sop-check-service.test.ts` — `grep absent` AC1/AC2 already covered (test on line 69 "absent:true inverts").
- `tests/unit/sop-advance-service.test.ts` — `SOP_PHASE_SKIP` AC3 already covered (line 136 "phase order (no skipping ahead)").
- `tests/unit/sop-commands.test.ts` — `init` `nextActions` shape AC5 already covered (lines 47/59/60).
- `tests/unit/sop-project-layer.test.ts` — `grep absent` end-to-end with project layer (line 32) covers AC2 in real workflow.
- This iteration **adds** one test for `sop registry` default-cwd behavior (AC6 for `registry`).

## Project-mode markers

- No `openspec/changes/2026-06-02-sop-global-reuse-ux-v2/` — scope is one CLI default-value change + one test, not enough to justify a new OpenSpec change. (Prior PRD 003/004 also did not create openspec changes; only the engineering-level changes did.)

## Project standards (Gate A3)

- `CLAUDE.md` ✓
- `.claude/rules/common/coding-style.md` ✓
- `.claude/rules/common/code-review.md` ✓
- `.claude/rules/common/security.md` ✓
- `.claude/rules/typescript/coding-style.md` ✓
- All four gate-A3 files present; no `peaks standards init --apply` needed.

## Session-invariant facts (memory markers)

<!-- peaks-memory:start -->
title: sop-grep-absent
kind: module
---
The `grep` check variant in `src/services/sop/sop-types.ts` carries an `absent?: boolean` field. When set, the check passes only when the pattern is NOT found. Implementation lives in `evaluateGrep` (`sop-check-service.ts`).
<!-- peaks-memory:end -->

<!-- peaks-memory:start -->
title: sop-grep-strip-meta
kind: module
---
The `grep` check variant in `src/services/sop/sop-types.ts` carries an optional `stripMeta?: boolean` field (added by PRD 006 on 2026-06-02). When set, `evaluateGrep` strips HTML comments, fenced code blocks, and `/* … */` block comments from the file content before applying the regex. Default `false` preserves byte-identical behavior for existing SOPs. The stripper is a pure string transform; unclosed fences / unclosed block comments fall through un-stripped (conservative).
<!-- peaks-memory:end -->
