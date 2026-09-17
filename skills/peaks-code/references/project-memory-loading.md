# Step 2.3 — Load project memory

> Body of `### Peaks-Loop Step 2.3`. Before planning any work, read the project's persistent memory — durable memories that survive across sessions:

```bash
peaks project memories --project <repo> --json
```

This returns durable memories from `.peaks/memory`, grouped by kind:
- **module** — code areas touched, with risk and rationale captured by past sessions
- **decision** — architectural choices, why they were made, what they affect
- **convention** — discovered project patterns (code style, naming, tooling)
- **rule** / **reference** / **project** — standing constraints, external pointers, and project context

Filter with `--kind <project|decision|convention|rule|reference|feedback|module|lesson|bug|investigation|technical-pattern|project-rule|design|handoff|session-handoff|project-todo|publish-closure|project-closure|slice-closure|slice-pilot-findings|sediment>` when you only need one slice. Use this to understand what exists, what was decided, and what to avoid re-litigating. Memories are LLM-authored at approved checkpoints via `peaks memory extract`. The `lesson` kind is for LLM-discovered runtime lessons (e.g. "this project's antv6 Drawer uses `size` not `width`"); write them as memory blocks in the RD handoff or TXT handoff.

A memory block is a **bare** start marker, then a header carrying a line-anchored `title:` and `kind:`, then a `---` separator line, then the body, then the end marker:

```markdown
<!-- peaks-memory:start -->
title: Short project memory title
kind: lesson
---
Stable memory body.
<!-- peaks-memory:end -->
```

Two ways a block can be lost — one silent, one reported:

- The start marker carries **no attributes**. It is matched literally, so any text added inside it (e.g. a `kind=…` attribute between `start` and `-->`) makes it not a marker at all: the block is never found, and nothing is extracted from it. `warnings` does name it back at you ("… is not the exact marker …"), which is how you tell this apart from an artifact that simply had no blocks — but the memory itself is still lost, so fix the marker rather than reading past the warning. Put `kind:` on its own line in the header instead.
- `title:` and `kind:` must each be on their own line, and the `---` separator must be present. A marker whose body has only prose is found but rejected, and says which precondition failed.

Preview with `peaks memory extract --project <repo> --artifact <handoff> --dry-run`, then re-run with `--apply` to write.

`.peaks/PROJECT.md` is a human-readable session timeline only — do NOT use it for LLM context.