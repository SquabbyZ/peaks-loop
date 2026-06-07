---
name: peaks-mcp-plan-call-pattern
description: The cross-cutting skill body pattern for MCP consumption: plan + apply + list + call, never direct mcp__ tool prefix
metadata:
  type: pattern
  sourceArtifact: .peaks/_runtime/2026-06-06-session-5b1095/rd/requests/008-007-007-2026-06-07-mcp-decouple.md
---

Slice #007-007-2026-06-07-mcp-decouple locks in the canonical 4-step pattern that every peaks SKILL.md must use when it needs to consume an MCP server. This memo is the cross-cutting lesson; the 4 per-capability memos (`mcp-decouple-{playwright,chrome-devtools,figma,context7}.md`) are the per-step details.

## The 4-step pattern

When a peaks SKILL.md step needs to use an MCP server, the skill body must follow this 4-step shape:

1. **Detect install** — `peaks mcp list --json | grep <name>`. If the registry reports the server, skip step 2-3.
2. **Plan** — `peaks mcp plan --capability <capabilityId> --json`. Read the envelope's `envCheck.missing` field. If non-empty, the skill must stop and ask the user to set the env vars (do not auto-set).
3. **Apply** — `peaks mcp apply --capability <capabilityId> --yes --json`. The `--yes` is required (load-bearing gate). Read the envelope's `written.settingsPath` to confirm the write.
4. **Call** — `peaks mcp call --capability <capabilityId> --tool <toolName> --args-json '<argsObject>' --json`. The args object MUST be a JSON object (not a string or array). The `--timeout` flag is optional (default: no timeout; in practice the call service uses a 30s transport-level default).

The skill body must use this exact pattern; it must NOT bake in the `mcp__<server>__<tool>` prefix. The prefix is owned by the LLM runtime, not by the skill.

## Why

The dev-preference red line (top of `.claude/rules/common/dev-preference.md`) requires skill-first / CLI-auxiliary. Before this slice, the 4 skills (peaks-solo, peaks-rd, peaks-qa, peaks-ui) hardcoded `mcp__playwright__browser_navigate`, `mcp__chrome_devtools__list_pages`, `mcp__Figma_AI_Bridge__get_figma_data`, and `mcp__plugin_context7_context7__resolve-library-id` in their skill bodies. That made peaks-cli depend on Claude Code's specific runtime prefix and made the skills non-portable to Trae, Cursor, or any future IDE.

The 4-step pattern fixes this by:

- Routing install/plan/apply through the peaks-cli capability registry (which is the source of truth for which MCPs are first-class).
- Routing the actual tool call through `peaks mcp call`, which is the IDE-agnostic primitive. The CLI spawns the server via stdio and forwards the `tools/call` JSON-RPC request. The LLM does NOT need to know the runtime prefix; it just needs the capability id and the tool name.
- Making env checks load-bearing: the plan envelope's `envCheck.missing` field is the single source of truth for "what env vars are needed before apply". The skill body does not need to enumerate them.

## What does NOT satisfy this rule

- A future engineer who writes "the user needs to call `mcp__playwright__browser_navigate` directly in their terminal" in a SKILL.md — that bypasses the registry and the env check.
- A future engineer who removes the `peaks mcp plan` step from a skill body and goes straight to `peaks mcp call`. The plan step is what surfaces the env check; skipping it is a regression.
- A future engineer who adds a new top-level CLI for any of the 4 MCPs (e.g. `peaks playwright install`, `peaks figma fetch`). The dev-preference red line forbids new top-level CLIs. The 5 verbs of `peaks mcp` are the only user-facing surface.
- A future engineer who adds a `--no-env-check` flag to `peaks mcp apply` to "make it easier". The env check is load-bearing; bypassing it silently is a regression.
- A future engineer who hardcodes the package version in a SKILL.md (e.g. "install `@playwright/mcp@1.2.3`"). The registry's install spec is the source of truth; the version is `latest`.

## How to apply

1. When writing or editing a peaks SKILL.md step that needs an MCP, use the 4-step pattern verbatim.
2. The capability id is the contract. If a new MCP is needed, add it to `src/services/mcp/mcp-install-registry.ts` first; the skill body's 4-step pattern is a function of the registry, not the other way around.
3. The skill body must NOT list the env vars the MCP needs. The plan envelope surfaces them. This keeps the skill body decoupled from the registry's env check.
4. The skill body must NOT bake the `mcp__` prefix. The LLM's runtime resolves the tool name from the registered server.
5. If the LLM is in an environment where it cannot directly call `mcp__<server>__*` tools (e.g. a sub-agent dispatched via `peaks sub-agent dispatch` in a non-Claude IDE), the skill body must use `peaks mcp call` for every MCP operation, not just install/plan/apply. This is the load-bearing fallback.
6. The Trae adapter's `capabilities.mcpInstall = false` is load-bearing: Trae's MCP integration is UNVERIFIED (no real Trae 1.x dogfood). The 6 SKILL.md files must therefore NOT promise `peaks mcp apply` will work on Trae; they must surface the Trae-specific path (manual install + manual tool invocation) via the `trae-adapter-is-the-first-real-consumer-of-the-slice-1-ide-adapter-layer.md` memory.

## Cross-reference

- PRD #007-007-2026-06-07-mcp-decouple (20 ACs, 4 Gs) — the source of truth for this slice.
- `.peaks/memory/mcp-decouple-{playwright,chrome-devtools,figma,context7}.md` — the per-capability memos.
- `.peaks/memory/skill-first-cli-auxiliary-sub-agent-dispatch.md` — the prior slice that established the skill-first pattern this slice extends to MCP.
- `.peaks/memory/trae-adapter-sets-mcpinstall-false-trae-mcp-integration-is-unverified.md` — the Trae-specific caveat.
- `src/services/mcp/mcp-install-registry.ts` — the registry that owns the 4 capability ids and the env checks.
- `src/cli/commands/mcp-commands.ts` — the 5-verb CLI that backs the pattern.
- `tests/integration/mcp/{playwright,chrome-devtools,figma,context7}-decouple.test.ts` — the contract tests that enforce the pattern.
