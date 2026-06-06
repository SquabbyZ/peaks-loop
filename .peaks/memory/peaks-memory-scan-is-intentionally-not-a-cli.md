---
name: peaks-memory-scan-is-intentionally-not-a-cli
description: peaks memory scan is intentionally NOT a CLI
metadata:
  type: decision
  sourceArtifact: .peaks/_runtime/2026-06-06-session-22f08c/txt/handoff.md
---

`peaks memory scan` is intentionally NOT a CLI command. The LLM skill is the only consumer of `peaks-memory:start` blocks, and the LLM has grep. Shipping a CLI would conflate "primitives the skill composes" with "the product itself" (per dev-preference red line).
