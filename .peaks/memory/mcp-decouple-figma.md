---
name: mcp-decouple-figma
description: Figma MCP is decoupled from peaks-ui SKILL.md via peaks mcp plan/apply/call; FIGMA_API_KEY is load-bearing
metadata:
  type: decision
  sourceArtifact: .peaks/_runtime/2026-06-06-session-5b1095/rd/requests/008-007-007-2026-06-07-mcp-decouple.md
---

Slice #007-007-2026-06-07-mcp-decouple registers Figma MCP as `capabilityId = "figma-context-mcp.design-context"` in the peaks install registry. The 6 peaks SKILL.md files (especially peaks-ui) must NEVER bake in the `mcp__Figma_AI_Bridge__*` or `mcp__figma__*` tool prefix. Skill bodies reference the capability by id only.

## Why

Same dev-preference red line. The peaks-ui SKILL.md previously hardcoded `mcp__Figma_AI_Bridge__get_figma_data` and `mcp__Figma_AI_Bridge__download_figma_images`. That baked the Claude Code prefix into the skill and made peaks-ui non-portable. After this slice:

- Skill body says: "Figma design file fetched via `peaks mcp call --capability figma-context-mcp.design-context --tool get_figma_data`."
- Skill body NEVER says: "call `mcp__Figma_AI_Bridge__get_figma_data`".

The Figma capability has a load-bearing env check: `envKeys = ['FIGMA_API_KEY']`. The plan step must report `envCheck.missing = ['FIGMA_API_KEY']` when the env var is unset, and `peaks mcp apply` must refuse without it. This is the only one of the 4 capabilities that has a load-bearing env check (Playwright and Chrome DevTools don't; context7 has the same pattern but with `CONTEXT7_API_KEY`).

## What does NOT satisfy this rule

- A future engineer who hardcodes `mcp__Figma_AI_Bridge__*` in peaks-ui. The skill body stays IDE-agnostic.
- A future engineer who adds a `peaks figma fetch` or `peaks design extract` top-level CLI. The dev-preference red line forbids new top-level CLIs. The 5 verbs of `peaks mcp` are the only user-facing surface.
- A future engineer who downgrades the env check from "refuse to apply" to "warn and continue". The env check is load-bearing: the Figma API rejects unauthenticated requests with a 401, and the warning would arrive too late to gate the workflow.
- A future engineer who renames the capability id from `figma-context-mcp.design-context`. The id is the contract; the registry is the source of truth.

## How to apply

1. The canonical capability id is `figma-context-mcp.design-context`.
2. `FIGMA_API_KEY` must be set in the env before `peaks mcp apply`. The apply step refuses with `MCP_APPLY_FAILED` and a message that includes `FIGMA_API_KEY` if the env var is missing.
3. Never reference `mcp__Figma_AI_Bridge__*` in a SKILL.md body. The LLM resolves the actual tool name from the registry.
4. The install command is `npx -y figma-developer-mcp@latest --stdio` (per the registry). Don't bake the package name into a skill.
5. The peaks-ui skill body's "Figma design file" step must use `peaks mcp call` — that's the only place the LLM learns to gate on `FIGMA_API_KEY` via the plan envelope's `envCheck.missing` field.
6. The design context (component layout, colors, typography) is the input to UI design review. The peaks-ui skill must sanitize the design context before retention (no API keys, no signed URLs, no PII).

## Cross-reference

- `.peaks/memory/mcp-decouple-{playwright,chrome-devtools,context7}.md` — the sibling memos.
- `.peaks/memory/peaks-mcp-plan-call-pattern.md` — the cross-cutting skill body pattern.
- `src/services/mcp/mcp-install-registry.ts` — the registry that owns the capability id and the env check.
- `tests/integration/mcp/figma-decouple.test.ts` — the contract test that enforces the canonical id and the load-bearing env check.
