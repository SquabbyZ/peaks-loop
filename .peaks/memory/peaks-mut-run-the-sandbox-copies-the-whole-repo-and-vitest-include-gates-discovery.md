---
name: peaks-mut-run-the-sandbox-copies-the-whole-repo-and-vitest-include-gates-discovery
description: peaks mut run — the sandbox copies the whole repo, and vitest include gates discovery
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-11-05-session-af31e4/txt/handoff-release.md
---

Two independent traps make `peaks mut run` fail opaquely on this repo. (1) Stryker copies the
entire project into `.stryker-tmp`; `.peaks/_runtime` holds ~1600 directory junctions from old test
fixtures, and the copy dies with `EPERM: operation not permitted, copyfile`. `peaks mut run --ignore
.peaks --ignore dist` fixes it (the flag was added in 4.2.0; `.stryker-tmp` is always excluded).
(2) A tracked `stryker.conf.js` pins `vitest.configFile: ./stryker.vitest.config.mjs`, whose
`include` names only the test files covering the configured mutate targets — any other
`--test-files` value is copied by Stryker but filtered out by vitest, producing
`DryRunExecutor No tests were found`. Add the test file to that `include` AND the source to
`stryker.conf.js`'s mutate list, or the run silently measures nothing. Also: `--ignore` once had
to keep `node_modules`, because excluding it leaves the sandbox without the vitest-runner plugin
and Stryker falls back to the `command` runner, which rejects `--testFiles`.
