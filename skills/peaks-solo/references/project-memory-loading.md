# Step 2.3 — Load project memory

> Body of `### Peaks-Cli Step 2.3`. Before planning any work, read the project's persistent memory — durable memories that survive across sessions:

```bash
peaks project memories --project <repo> --json
```

This returns durable memories from `.peaks/memory`, grouped by kind:
- **module** — code areas touched, with risk and rationale captured by past sessions
- **decision** — architectural choices, why they were made, what they affect
- **convention** — discovered project patterns (code style, naming, tooling)
- **rule** / **reference** / **project** — standing constraints, external pointers, and project context

Filter with `--kind <decision|convention|module|rule|reference|project|lesson>` when you only need one slice. Use this to understand what exists, what was decided, and what to avoid re-litigating. Memories are LLM-authored at approved checkpoints via `peaks memory extract`. The `lesson` kind is for LLM-discovered runtime lessons (e.g. "this project's antv6 Drawer uses `size` not `width`"); write them as `<!-- peaks-memory:start kind=lesson -->` blocks in the RD handoff or TXT handoff.

`.peaks/PROJECT.md` is a human-readable session timeline only — do NOT use it for LLM context.