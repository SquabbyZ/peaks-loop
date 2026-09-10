---
name: on-windows-windowshide-covers-only-the-process-you-spawn
description: On Windows, windowsHide covers only the process you spawn
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-09-10-session-528a63/txt/handoff.md
---

`windowsHide: true` applies to the immediate child. Tools that re-spawn internally — the `tsx` CLI
spawns its own loader child, and `@npmcli/run-script` spawns `cmd.exe /d /s /c` with `shell: true` —
ignore that flag, so the grandchild allocates a visible console window. Measured chain:
`node npx-cli → cmd.exe → daemon-entry`, three processes per cold start where one was expected.

**Why:** reading the spawn call shows the flag set and gives false confidence. The window belongs to
a process the code never names.

**How to apply:** verify by **process tree**, not by reading the flag — assert that a spawn produces
exactly one child (`ppid === process.pid`) and that no element of the argv is a shell or `.cmd` path.
Avoid shell-mediated launchers in hot paths entirely; invoke the interpreter directly.
