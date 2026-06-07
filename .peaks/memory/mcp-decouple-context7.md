---
name: mcp-decouple-context7
description: Context7 MCP is decoupled from peaks-solo/rd/qa/sop/sc SKILL.md via peaks mcp plan/apply/call; CONTEXT7_API_KEY is load-bearing
metadata:
  type: decision
  sourceArtifact: .peaks/_runtime/2026-06-06-session-5b1095/rd/requests/008-007-007-2026-06-07-mcp-decouple.md
---

Slice #007-007-2026-06-07-mcp-decouple registers Context7 MCP as `capabilityId = "context7.docs-lookup"` in the peaks install registry. The 6 peaks SKILL.md files must NEVER bake in the `mcp__plugin_context7_context7__*` or `mcp__context7__*` tool prefix. Skill bodies reference the capability by id only.

## Why

Same dev-preference red line. The peaks-rd and peaks-sop SKILL.md files previously hardcoded `mcp__plugin_context7_context7__resolve-library-id` and `mcp__plugin_context7_context7__get-library-docs`. That baked the Claude Code plugin name into the skill. After this slice:

- Skill body says: "library docs lookup via `peaks mcp call --capability context7.docs-lookup --tool resolve-library-id`."
- Skill body NEVER says: "call `mcp__plugin_context7_context7__resolve-library-id`".

The Context7 capability has a load-bearing env check: `envKeys = ['CONTEXT7_API_KEY']`. The plan step must report `envCheck.missing = ['CONTEXT7_API_KEY']` when the env var is unset, and `peaks mcp apply` must refuse without it. This is the same load-bearing env check pattern as Figma (`FIGMA_API_KEY`).

## What does NOT satisfy this rule

- A future engineer who hardcodes `mcp__plugin_context7_context7__*` in any peaks SKILL.md. The skill body stays IDE-agnostic.
- A future engineer who adds a `peaks context7 fetch` or `peaks docs lookup` top-level CLI. The dev-preference red line forbids new top-level CLIs. The 5 verbs of `peaks mcp` are the only user-facing surface.
- A future engineer who downgrades the env check from "refuse to apply" to "warn and continue". The env check is load-bearing: the Context7 API rejects unauthenticated requests with a 401, and the warning would arrive too late to gate the workflow.
- A future engineer who renames the capability id from `context7.docs-lookup`. The id is the contract; the registry is the source of truth.

## How to apply

1. The canonical capability id is `context7.docs-lookup`.
2. `CONTEXT7_API_KEY` must be set in the env before `peaks mcp apply`. The apply step refuses with `MCP_APPLY_FAILED` and a message that includes `CONTEXT7_API_KEY` if the env var is missing.
3. Never reference `mcp__plugin_context7_context7__*` in a SKILL.md body. The LLM resolves the actual tool name from the registry.
4. The install command is `npx -y @upstash/context7-mcp@latest` (per the registry). Don't bake the package name into a skill.
5. The peaks-rd and peaks-sop skill bodies' "library docs" step must use `peaks mcp call` — that's the only place the LLM learns to gate on `CONTEXT7_API_KEY` via the plan envelope's `envCheck.missing` field.
6. The library docs result is the input to RD's "research existing implementations" step. The skill must not retain the full docs; summarize and cite.

## Cross-reference

- `.peaks/memory/mcp-decouple-{playwright,chrome-devtools,figma}.md` — the sibling memos.
- `.peaks/memory/peaks-mcp-plan-call-pattern.md` — the cross-cutting skill body pattern.
- `src/services/mcp/mcp-install-registry.ts` — the registry that owns the capability id and the env check.
- `tests/integration/mcp/context7-decouple.test.ts` — the contract test that enforces the canonical id and the load-bearing env check.
