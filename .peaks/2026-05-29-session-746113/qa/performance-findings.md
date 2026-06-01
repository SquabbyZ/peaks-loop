# Performance Findings — 2026-06-02-sop-global-reuse-ux-v2

- reviewer: QA
- review date: 2026-06-02
- verdict: **PASS** — no perf regression; no new perf-sensitive code path

## Scope reviewed

- One-line default-value addition to a Commander `.option()` declaration.
- One new test that uses `process.chdir` to a temp project and runs the CLI via the existing `runCommand` harness.

## Why this slice is performance-insensitive

- The default-value change is parsed once at process start; no per-invocation cost.
- `peaks sop registry` is a read-only command that lists a small in-memory JSON map (`{version, sops, gateCount}`). Project-layer merging is `O(P + G)` where P and G are the count of user-authored SOPs and their gates; in the wild, P < 100 and G < 10 per SOP.
- No new dependencies; bundle size impact is one `console.log`-equivalent in the help string (≈ +25 bytes), below the rounding error of the dist tarball.

## Build / size baseline

- `npm run build` → tsc clean, exit 0.
- `dist/` total size: 3.0 MB (unchanged from prior baseline — same dist contents modulo the one-line edit, no new files).
- `dist/src/cli/commands/sop-commands.js` size: 13552 bytes.
- `dist/src/cli/commands/gate-commands.js` size: 5130 bytes.
- No new top-level modules. No new exports. No new imports.

## Test suite runtime

- Focused suite (`sop-commands`, `sop-check-service`, `sop-advance-service`, `sop-service`, `sop-project-layer`, `sop-registry-service`, `gate-enforce-service`): 110 tests in 2.25s (≈ 20 ms/test, dominated by `npm run` + vitest startup; per-test runtime is in the low single-digit ms).
- Full suite: 13.7s (no measurable delta from prior baseline; the new test adds ≈ 15 ms).

## Hot path analysis

- No changes to `evaluateGrep`, `evaluateFileExists`, `evaluateCommand`, `assertNoPhaseSkip`, or `advanceSop` — the new test exercises existing code paths without modifying them.
- The default value flows from Commander parsing (microseconds) into `readRegistry` (a single `readFileSync` of the project-layer JSON, only if the project file exists). For a non-project cwd, the read is skipped (the file does not exist) — same behavior as the old `undefined` default.

## Verdict

PASS. No measurable performance impact. No bundle-size regression. No new dependency. The slice is the minimum-effort implementation of PRD 005 v2 G7 AC6.
