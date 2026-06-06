---
name: slim-ideadapter-shape-is-the-contract
description: Slim IdeAdapter shape is the contract
metadata:
  type: decision
  sourceArtifact: .peaks/_runtime/2026-06-06-session-22f08c/txt/handoff.md
---

Slice #1 established the slim `IdeAdapter` shape: 4 string fields (id, displayName, envVar, hookEvent, toolMatcher) + 1 settings function (resolveSettingsFile + supportsScope) + 1 capabilities marker. New IDE adapters are "fill the table" not "rewrite the CLI". Future slices MUST register new adapters via `_setAdapterForTesting` (test seam) or follow-up production code, NOT by adding CLI-level `if (ide === 'trae')` branches.
