---
title: JS/TS ESLint Gate (Gate B5 卡控)
rid: 2026-08-06-eslint-jsts-gate
session: 2026-08-06-session-cacde8
status: shipped-4.0.16
---

# JS/TS ESLint Gate (Gate B5 卡控)

## Section 1 — what the runner does

`peaks lint` is a read-only ESLint verifier for the peaks-rd Gate B5
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
- call `peaks lint --scope src/` after pre-installing the plugin
  in their environment.

## Section 4 — soft-fail table

| Runner state | Gate B5 verdict |
|---|---|
| `ok` with zero findings | pass |
| `ok` with findings | warn (findings printed; never block) |
| `npx-failed` / `eslint-missing` | warn — Gate B5 still passes |
| `execution-failed` | warn — user must inspect the toolchain |

peaks-rd never blocks a slice on lint; per the G-lint-2 red line,
peaks lint is a verifier, not a formatter.

## Section 5 — Gate B5 transitions

- `rd:qa-handoff` reads the lint envelope. A missing `peaks lint`
  run is acceptable if the project is non-JS/TS (Gate B5 is per-language).
- peaks-rd's own 4-dim lint (placeholder hunt) runs alongside ESLint.
- The unified verdict is the worst of the two lint families (ESLint
  warn never escalates to block).

## Section 6 — Configuration precedence

`config/eslint/.peaks-rules.cjs` composes its rule set by extending
four upstream configs in this order (last-wins on rule overrides):

1. `eslint:recommended` — base ES syntax + best practices.
2. `plugin:@typescript-eslint/recommended-type-checked` — TS rules
   that require type info. Requires `@typescript-eslint/parser` to
   resolve with `project: true`.
3. `plugin:import/recommended` — module-boundary / import-resolution
   rules. Reports unresolved imports as errors.
4. `plugin:import/typescript` — TypeScript-aware import resolver
   layered on top of `import/recommended`.

User-level `.eslintrc.cjs` (or `--config <path>`) overrides extend in
priority order: the closer the config is to the source file, the
higher its precedence. `peaks lint` honours the `--config` flag
so projects that carry a non-default config can point the runner at
it without copying into the peaks-loop repo.

The `import/recommended` and `import/typescript` layers in particular
make the wrapper sensitive to the project's `tsconfig.json` `paths`
config. A monorepo with `baseUrl` + `paths` aliases must keep its
tsconfig in scope; otherwise `import/no-unresolved` reports
spurious errors that downgrade Gate B5 to a noisy warn.

`recommended-type-checked` likewise depends on a resolvable
`tsconfig.json`; projects that ship a non-default config must pass
it via `--config` so ESLint can locate the program files for type
introspection. Without a reachable tsconfig the type-aware rules
silently no-op, which the runner reports as zero type-checked
findings (not as an error).

The L3 framework plugins (react / vue / svelte / nestjs) are NOT
included in the four pinned packages. `peaks lint` will not
auto-resolve them; the project's own devDependencies must list the
plugin and the local `.peaks-rules.cjs` must extend its config.
This keeps the peaks-loop devDeps surface flat while still letting
per-project opt-in.

## Section 7 — Project-aware baseline (PRD-002b D6 + S1)

`.peaks/lint/baseline.json` is a **project-level** file. Each project
generates its own baseline via `peaks lint baseline`; downstream
projects **do not** inherit peak-loop's baseline even when they share
the same language (TypeScript) — language similarity ≠ project
structure / toolchain / coding style.

| Project type | Baseline source | Why |
|---|---|---|
| `peaks-loop` itself | Ship as reference + fixture | TS CLI; reference value high |
| Downstream React TS | MUST run `peaks lint baseline` | Different framework / hooks / component patterns |
| Downstream Python / Go / Java | Language-specific toolchain (future slice) | Cross-language; zero reference value today |

The baseline.json schema (internal contract, not public):

```jsonc
{
  "version": 1,
  "generatedAt": "2026-08-06T...",
  "toolVersion": "peaks-loop-4.0.16+",
  "violations": [
    { "ruleId": "max-lines", "file": "src/x.ts", "line": 401,
      "severity": "error", "message": "..." }
  ]
}
```

`peaks lint baseline` writes this file at the cwd (default
`.peaks/lint/baseline.json`); the file is gitignored by default —
projects that want to ship it (peak-loop itself) use `git add -f`.

## Section 8 — Red-line (LLM development red line; PRD-002b S2)

The lint envelope carries a `redLine` section whenever
`redLineMode='baseline-aware'` (the default). It aggregates
baseline.json violations by `ruleId`, sorted by count desc, with the
top 5 file:line buckets per rule. Sample shape:

```jsonc
{
  "redLine": [
    { "ruleId": "max-lines-per-function", "count": 7,
      "topFiles": [
        { "file": "src/services/foo.ts", "count": 3 },
        { "file": "src/services/bar.ts", "count": 2 }
      ] }
  ]
}
```

LLM workflow:

1. Before writing JS/TS, read `.peaks/memory/lint-redline-summary.md`
   (auto-generated by `peaks lint check --red-line` or
   `peaks lint baseline --red-line`).
2. If `redLine[0].ruleId === 'max-lines-per-function'` shows 5+
   existing occurrences, the LLM MUST split any function ≥ 30 lines
   it would otherwise write; this prevents the violation count from
   climbing while存量 stays at baseline.
3. The red-line is **low value when baseline is empty** (project
   bootstrap) and **high value when baseline is saturated** (≥ 5
   per rule). The CLI prints a one-line warning when the red-line
   would help; the LLM should still consult it on every Gate B5.

The red-line is informational, not blocking — Gate B5 still passes
when redLine has entries. Its job is to keep存量 violation counts
flat as new code lands, not to escalate存量 work.

## Cross-references

- PRD: `.peaks/_runtime/2026-08-06-session-cacde8/prd/requests/002-2026-08-06-eslint-jsts-gate-and-ocr-multilang-rebuild.md`
- Sediment: `.peaks/memory/2026-08-06-eslint-jsts-gate-and-ocr-multilang-rebuild-sediment.md`
- Skills: `skills/bee/peaks-rd/SKILL.md` Gate B5 paragraph
- Skills: `skills/peaks-code/SKILL.md` Quality-gate commands cheat sheet
- Config: `config/eslint/.peaks-rules.cjs`
- Runner: `src/services/lint/eslint-runner.ts`
- Detect: `src/services/lint/detect-eslint.ts`
- CLI: `src/cli/commands/lint-commands.ts`
