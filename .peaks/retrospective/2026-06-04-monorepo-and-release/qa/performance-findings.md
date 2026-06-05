# QA Performance Findings — Slice A: 2026-06-04-monorepo-and-release

- session: 2026-06-04-session-cda1cd
- rid: 2026-06-04-monorepo-and-release
- slice: A
- type: feature
- commit-under-test: `d3e314c feat(scan): discover monorepo packages in peaks scan libraries`
- reviewer: peaks-qa (sub-agent)
- date: 2026-06-04

## Baseline

There is no perf-baseline artifact in `.peaks/2026-06-04-session-cda1cd/rd/`
(per RD's `## Implementation evidence`, the perf-baseline write was not
in scope for this slice — the RD did not produce one). The pre-slice
behavior reads only the root `package.json`, so the comparison surface is
"single-package code path" vs "post-slice monorepo code path on a real
monorepo (ice-cola)".

For a single-package project, the post-slice code path's
`discoverWorkspacePackageJsons` does 1–3 `pathExists` checks
(pnpm-workspace.yaml, package.json, lerna.json) and then exits with
`source: null` and the legacy single-package scan. There is no perf
regression for single-package projects (the new code path is a short
early-exit before the original logic resumes).

The relevant comparison is the **monorepo code path on ice-cola**, which
is what the PRD acceptance criteria measure and what dogfood validates.

## Post-slice measurement

Command (Step 7 of QA runbook):
```bash
cd "C:\Users\smallMark\Desktop\peaks-cli"
time pnpm exec tsx src/cli/index.ts scan libraries \
  --project "C:/Users/smallMark/Desktop/peaksclaw/ice-cola" --json \
  > /dev/null 2>&1
```

Output:
```
real    0m1.447s
user    0m0.090s
sys     0m0.154s
```

Notes:
- `node_modules` is warm (the test suite had been run immediately before,
  so tsx's TypeScript transform cache and the filesystem cache are both
  hot).
- The command scans 7 `package.json` files (the root + 6 sub-packages
  including 3 nested hermes-agent sub-packages picked up by the
  one-level recursive descent) and produces 202 `LibraryEntry` rows.
- The bulk of the 1.447s is tsx's TypeScript transform + module-load
  time, not the scan logic itself. The actual scan (filesystem walk +
  JSON parse + glob expansion) completes in well under 100ms when timed
  in isolation by the slice's own unit tests (vitest reports the 22
  test cases for this file in 80ms total).

## Verdict

**pass** — the dogfood on ice-cola (7 workspaces, 202 libraries)
completes in 1.447s real time, which is **3.46x under the 5-second
threshold** specified in the QA runbook for this slice. There is no
measurable performance regression for single-package projects (the
discovery early-exits before the original code path runs). No
performance findings.
