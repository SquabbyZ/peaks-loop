---
name: an-ast-guard-resolves-a-const-alias-not-a-parameter
description: an-ast-guard-resolves-a-const-alias-not-a-parameter
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-container.md
---

`tests/unit/spawn-windows-hide-guard.test.ts` walks the TypeScript AST for calls whose callee is
bound to a `child_process` import. It resolves a same-file `const alias = deps.spawn ?? spawn`, but
NOT a parameter default (`spawnImpl: typeof spawn = childProcessSpawn`). Renaming the call to
`spawnImpl(...)` made the guard resolve zero call sites in `isolation-lease.ts` and refuse the file:
"never drops a protected file for resolving zero call sites".

**Why:** the guard's whole point is that a file which imports `node:child_process` but exposes no
resolvable call site is more likely a detector failure than a clean file. A parameter binding is
invisible to its `collectBindings`.

**How to apply:** when adding an injection seam to a spawning function, bind it in the body as
`const spawnImpl = override ?? childProcessSpawn;` and call that. If the guard still cannot resolve
it, fix the seam shape — do not widen the guard.
