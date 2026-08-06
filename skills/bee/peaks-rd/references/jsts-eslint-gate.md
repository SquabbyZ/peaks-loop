---
title: JS/TS ESLint Gate (Gate B5 卡控)
rid: 2026-08-06-eslint-jsts-gate
session: 2026-08-06-session-cacde8
status: shipped-4.0.16
---

# JS/TS ESLint Gate (Gate B5 卡控)

## Section 1 — what the runner does

`peaks code lint` is a read-only ESLint verifier for the peaks-rd Gate B5
surface. It calls `npx` with four pinned packages (no `devDependencies`
added to peaks-loop) and parses the JSON envelope emitted by
`--format json`.

Pinned packages (slice PRD-002; aligned with the rules resolved by
`config/eslint/.peaks-rules.cjs`):

| Package | Pin | Source |
|---|---|---|
| `eslint` | 10.8.0 | npm registry |
| `@typescript-eslint/parser` | 8.66.0 | npm registry |
| `@typescript-eslint/eslint-plugin` | 8.66.0 | npm registry |
| `eslint-plugin-import` | 2.32.0 | npm registry |

The runner lives at `src/services/lint/eslint-runner.ts` and exports
`runEslint({ cwd, scope?, configPath?, fix?, write?, timeoutMs? })`.

## Section 2 — 5-state detect table

`detect-eslint` returns one of:

| State | Meaning | Behavior |
|---|---|---|
| `ready` | npx is on PATH and the registry resolves all 4 pins | run lint |
| `eslint-missing` | lint exited with no findings (likely a toolchain error) | warn |
| `config-error` | config did not parse | block |
| `npx-failed` | npx is not on PATH | warn |
| `detection-failed` | unexpected detection exception | warn |

The wrapper returns `state: 'ok' | 'eslint-missing' | 'npx-failed' |
'execution-failed'` (lint cannot reach `config-error` because the
runner is config-agnostic; the consumer supplies `--config <path>`).

## Section 3 — Layer 3 dynamic loading

`config/eslint/.peaks-rules.cjs` allows the L3 (framework) layer to be
loaded dynamically by `npx --package <pkg> -- eslint`. peaks-loop
itself never installs the L3 packages; the user opts in per-project.
If a project needs `eslint-plugin-react`, it is up to the user to
either:

- run `npm i -D eslint-plugin-react` and update
  `config/eslint/.peaks-rules.cjs` to extend the relevant config, or
- call `peaks code lint --scope src/` after pre-installing the plugin
  in their environment.

## Section 4 — soft-fail table

| Runner state | Gate B5 verdict |
|---|---|
| `ok` with zero findings | pass |
| `ok` with findings | warn (findings printed; never block) |
| `npx-failed` / `eslint-missing` | warn — Gate B5 still passes |
| `execution-failed` | warn — user must inspect the toolchain |

peaks-rd never blocks a slice on lint; per the G-lint-2 red line,
peaks code lint is a verifier, not a formatter.

## Section 5 — Gate B5 transitions

- `rd:qa-handoff` reads the lint envelope. A missing `peaks code lint`
  run is acceptable if the project is non-JS/TS (Gate B5 is per-language).
- peaks-rd's own 4-dim lint (placeholder hunt) runs alongside ESLint.
- The unified verdict is the worst of the two lint families (ESLint
  warn never escalates to block).

## Cross-references

- PRD: `.peaks/_runtime/2026-08-06-session-cacde8/prd/requests/002-2026-08-06-eslint-jsts-gate-and-ocr-multilang-rebuild.md`
- Skills: `skills/bee/peaks-rd/SKILL.md` Gate B5 paragraph
- Config: `config/eslint/.peaks-rules.cjs`
- Runner: `src/services/lint/eslint-runner.ts`
- Detect: `src/services/lint/detect-eslint.ts`
- CLI: `src/cli/commands/lint-commands.ts`
