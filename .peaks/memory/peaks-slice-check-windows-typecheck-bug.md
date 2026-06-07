---
name: peaks-slice-check-windows-typecheck-bug
description: peaks slice check typecheck stage on Windows has execFileSync+npx.cmd shell-resolution bug; trust direct tsc
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-06-06-session-5b1095/txt/handoff-2026-06-07-session-runtime-dir-regression.md
---

The `peaks slice check` typecheck stage on Windows shells reports `durationMs: 1-2` (too fast for tsc to have actually run) and `exitCode: 1` with empty `stdout`/`stderr`, while the underlying `npx tsc -p tsconfig.json --noEmit` invocation passes cleanly. The cause is `slice-check-service.ts:runTypecheck` using `execFileSync('npx', ['tsc', '--noEmit'], ...)` — on Windows, `npx` resolves to `npx.cmd` (a batch file), and `execFileSync` requires `shell: true` to handle `.cmd` resolution.

**Why:** This produces a false `boundaryReady: false` verdict even when the actual typecheck is clean, blocking the slice at the boundary gate. The same symptom shows up on `main` without any code change (verified via `git stash` + `peaks slice check` + `diff` of the JSON: identical 4/4 fail). The unit-tests stage has the same execFileSync pattern, but the `--allow-pre-existing-failures` flag works around it by counting 0 slice-relevant failures.

**How to apply:** When running `peaks slice check` on Windows, do NOT trust the typecheck stage's `status: "fail"` as evidence of a real typecheck failure. Run `npx tsc -p tsconfig.json --noEmit` directly and trust the exit code for the actual typecheck verdict. Use `--allow-pre-existing-failures` to make the unit-tests stage classify the pre-existing Windows EPERM failures as `skipped` rather than `fail`. The review-fanout and gate-verify-pipeline stages are NOT affected by this bug; trust their verdicts.

**Future fix:** The `runCommand` function in `slice-check-service.ts` should pass `shell: true` (or invoke `npx.cmd` directly via `process.execPath`) on Windows. Worth a separate slice.
