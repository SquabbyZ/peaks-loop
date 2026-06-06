---
name: trae-adapter-sets-mcpinstall-false-trae-mcp-integration-is-unverified
description: Trae adapter sets mcpInstall=false; Trae MCP integration is unverified
metadata:
  type: decision
  sourceArtifact: .peaks/_runtime/2026-06-06-session-22f08c/txt/handoff.md
---

The Trae adapter's `capabilities.mcpInstall: false` (vs Claude's `mcpInstall: true`). The reason: Trae MCP integration is unverified at slice #2 time. If a future slice adds `peaks mcp install` for Trae, the CLI should refuse to install for IDEs where `capabilities.mcpInstall === false`. For now, no downstream code path forces this — it's a documented contract only.
