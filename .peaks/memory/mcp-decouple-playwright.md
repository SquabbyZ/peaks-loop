---
name: mcp-decouple-playwright
description: Playwright MCP is fully decoupled from peaks-solo/rd/qa/ui SKILL.md via peaks mcp plan/apply/call
metadata:
  type: decision
  sourceArtifact: .peaks/_runtime/2026-06-06-session-5b1095/rd/requests/008-007-007-2026-06-07-mcp-decouple.md
---

Slice #007-007-2026-06-07-mcp-decouple registers Playwright MCP as `capabilityId = "playwright-mcp.browser-validation"` in the peaks install registry. The 6 peaks SKILL.md files (peaks-solo, peaks-rd, peaks-qa, peaks-ui, peaks-sop, peaks-sc) must NEVER bake in the `mcp__playwright__*` tool prefix in their own skill bodies. Skill bodies reference the capability by id only and let the LLM's runtime resolve the actual MCP tool name.

## Why

The dev-preference red line (top of `.claude/rules/common/dev-preference.md`) requires skill-first / CLI-auxiliary. Playwright MCP, when invoked directly via `mcp__playwright__*` tool calls, was the previous failure mode: skill bodies hardcoded Claude Code's specific `mcp__` prefix, making the skills depend on Claude Code's runtime rather than the peaks-cli capability registry. Adding a new IDE that wraps the same Playwright backend (e.g. a Trae-local Playwright) would require editing every skill.

After this slice, the contract is:

- Skill body says: "browser-based UI validation needs Playwright MCP. Install via `peaks mcp plan --capability playwright-mcp.browser-validation` then `peaks mcp apply --capability playwright-mcp.browser-validation --yes`. Detect with `peaks mcp list | grep playwright`."
- Skill body NEVER says: "call `mcp__playwright__browser_navigate`" or similar.
- The `mcp__playwright__*` prefix is owned by Claude Code's runtime; the LLM naturally resolves tool names once Playwright MCP is installed. peaks-cli does not own the prefix.

The CLI (`peaks mcp call --capability playwright-mcp.browser-validation --tool <name> --args-json '<args>' --json`) is the load-bearing primitive for any environment where the LLM cannot directly call the `mcp__` tool (e.g. headless test runs, sub-agent dispatched from a non-Claude environment). The skill body's `peaks mcp call` reference is the entry point to that primitive.

## What does NOT satisfy this rule

- A future engineer who writes "use `mcp__playwright__browser_navigate` to open the URL" in a SKILL.md — that bakes Claude Code's prefix into the skill and breaks IDE portability.
- A future engineer who renames the capability from `playwright-mcp.browser-validation` to something shorter (`browser-validation`, `playwright`, `pw`) — the registry has 4 capabilities and the skill body is the doc the LLM reads; an alias lookup is not free.
- A future engineer who adds a `peaks playwright install` or `peaks browser validate` top-level CLI — the dev-preference red line forbids new top-level CLIs. The 5 verbs of `peaks mcp` are the only user-facing surface.
- A future engineer who makes `peaks mcp call` auto-derive the capability from the tool name (e.g. "any `mcp__playwright__*` tool maps to `playwright-mcp.browser-validation`") — that hides the registry from the LLM and the LLM loses the install/plan contract.

## How to apply

When modifying or extending Playwright MCP consumption in peaks:

1. The canonical capability id is `playwright-mcp.browser-validation`. If a SKILL.md needs the browser, use this id verbatim in `peaks mcp plan`, `peaks mcp apply`, and `peaks mcp call`.
2. Never reference `mcp__playwright__*` in a SKILL.md body. If the LLM needs to know the tool name (e.g. `browser_navigate`), the LLM discovers it from the registry, not from the skill text.
3. The install command is `npx -y @playwright/mcp@latest` (per the registry). Don't bake the package name into a skill.
4. Playwright MCP is the **primary** browser surface (headed browser on demand). Chrome DevTools MCP is a **secondary** CDP surface for an already-running Chrome on `:9222`. SKILL.md must keep this distinction.
5. After installing Playwright MCP via `peaks mcp apply --yes`, run `peaks mcp list --json` to confirm — the `peaks-qa` regression gate is built on `peaks mcp list`, not on the `mcp__` prefix.
6. If a future IDE needs the same Playwright backend, the new IDE adapter only needs to wire its own `mcpInstall: true` (or whatever the field is) and the existing skill body still works.

## Cross-reference

- PRD #007-007-2026-06-07-mcp-decouple (20 ACs, 4 Gs) — the source of truth for this slice.
- `.peaks/memory/peaks-mcp-plan-call-pattern.md` — the cross-cutting skill body pattern this slice locks in.
- `.peaks/memory/mcp-decouple-{chrome-devtools,figma,context7}.md` — the sibling memos for the other 3 capabilities.
- `.peaks/memory/skill-first-cli-auxiliary-sub-agent-dispatch.md` — the prior slice that established the skill-first pattern this slice extends to MCP.
- `src/services/mcp/mcp-install-registry.ts` — the registry that owns the 4 capability ids.
- `tests/integration/mcp/playwright-decouple.test.ts` — the contract test that enforces the canonical id.
