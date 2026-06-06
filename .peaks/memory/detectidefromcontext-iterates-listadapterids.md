---
name: detectidefromcontext-iterates-listadapterids
description: detectIdeFromContext iterates listAdapterIds
metadata:
  type: convention
  sourceArtifact: .peaks/_runtime/2026-06-06-session-22f08c/txt/handoff.md
---

`detectIdeFromContext` MUST iterate `listAdapterIds()` (from `src/services/ide/ide-registry.ts`), never a hardcoded list of IdeId strings. Hardcoding throws on unregistered adapters (the bug found in slice #1 step 1 at commit 76c1061, fixed in T11 at commit 641e9d9). Pattern: every time you add a new adapter, the auto-detection function picks it up for free.
