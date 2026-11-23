---
name: designlang-integration-facts-the-s2-spike-pinned
description: designlang integration facts the S2 spike pinned
metadata:
  type: reference
  sourceArtifact: .peaks/_runtime/2026-11-23-session-320f58/txt/handoff-s2.md
---

`designlang` is a hard dependency pinned in the lockfile at 13.4.1. Its JSON surfaces are
`designlang <url>`, `drift --tokens --json`, `verify-ui --brand --json` and `slop --json` on
stdout; `grade` writes no stdout JSON — it emits a `*.grade.json` file that the adapter reads
with an mtime freshness check. Exit codes are 0/1/2/3, so exit 0 alone is not evidence: the
adapter requires a non-empty `generatedAt` or a NON-EMPTY `pages` list. The package ships no
Chromium and `designlang install-browser` must not run; `designlang doctor` crashes on Node 24
teardown, so browser detection probes the Playwright cache and known Chrome paths on the
filesystem instead. Spawn it through `process.execPath` with `shell: false` and a timeout,
killing the process tree (taskkill /T /F on Windows, SIGKILL to the detached POSIX group).
