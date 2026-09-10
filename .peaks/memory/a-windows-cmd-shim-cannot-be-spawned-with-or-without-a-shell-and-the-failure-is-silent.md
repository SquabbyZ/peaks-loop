---
name: a-windows-cmd-shim-cannot-be-spawned-with-or-without-a-shell-and-the-failure-is-silent
description: A Windows .cmd shim cannot be spawned with or without a shell — and the failure is silent
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-09-10-session-528a63/txt/handoff-defect-sweep.md
---

Seven sites in this repo spawned a Windows `.cmd` shim and **all of them were wrong**:

```
shell:true  + a path containing a space -> FAIL  (the shell splits the path)
shell:false + the same .cmd             -> FAIL  EINVAL (Node >=20 refuses .cmd without shell)
```

Neither branch works, so every affected path silently misbehaved for any checkout whose path contains
a space — on the platform this repo is developed on. Found at: `orchestrator-can-do`'s two probes
(dead on Windows, so the tool was wrong in two dimensions and its "context ratio" was a hardcoded `0`),
`peaks slice check` (the whole boundary gate), `version-precheck` (git exited 128 and the layer fell
through to "layer skipped", **reporting a real tag collision as merely deferred**),
`slice-decompose-runners` (swallowed into `indexed:false`, so decompose silently lost its codegraph
signal), `detect-eslint`, `coverage-c8`, and several release scripts.

**Why:** every one of these sits behind a green suite and works perfectly on a path without spaces, so
nothing tests them — and the failure mode is a *fallback*, not an exception. `>0` becomes "unavailable",
"failed" becomes "skipped", a real signal becomes an absence.

**How to apply:** never spawn a `.cmd`/`.bat` shim. Resolve the package's **JS entry** and run it via
`process.execPath` — no shell, no shim, and a path with spaces is just an argument. Reuse the repo's
existing helper rather than writing another. Verify with a project path that **contains a space**; that
is the acceptance case, not the normal one. If you cannot avoid a shell, say in a comment specifically
why — "it is a `.cmd`" is the defect, not a reason.
