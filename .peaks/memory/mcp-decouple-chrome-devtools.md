---
name: mcp-decouple-chrome-devtools
description: Chrome DevTools MCP is decoupled from peaks-solo/rd/qa/ui SKILL.md via peaks mcp plan/apply/call
metadata:
  type: decision
  sourceArtifact: .peaks/_runtime/2026-06-06-session-5b1095/rd/requests/008-007-007-2026-06-07-mcp-decouple.md
---

Slice #007-007-2026-06-07-mcp-decouple registers Chrome DevTools MCP as `capabilityId = "chrome-devtools-mcp.browser-debug"` in the peaks install registry. The 6 peaks SKILL.md files must NEVER bake in the `mcp__chrome_devtools__*` tool prefix in their own skill bodies. Skill bodies reference the capability by id only and let the LLM's runtime resolve the actual MCP tool name.

## Why

Same dev-preference red line as the Playwright decouple: skill-first / CLI-auxiliary. Chrome DevTools MCP was the secondary surface in the prior skill bodies, used to inspect an already-running Chrome via CDP. The hardcoded `mcp__chrome_devtools__*` prefix was the failure mode that made peaks-cli depend on Claude Code's runtime.

After this slice:

- Skill body says: "Chrome DevTools MCP is a secondary CDP surface for an already-running Chrome on `:9222`. Install via `peaks mcp plan --capability chrome-devtools-mcp.browser-debug` then `peaks mcp apply --capability chrome-devtools-mcp.browser-debug --yes`."
- Skill body NEVER says: "call `mcp__chrome_devtools__list_pages`" or similar.
- Chrome DevTools MCP is **explicitly** the secondary surface. Playwright MCP is the primary surface for user-flow E2E; Chrome DevTools is for CDP-level debugging. SKILL.md must keep this distinction.

## What does NOT satisfy this rule

- A future engineer who uses Chrome DevTools MCP to "launch a browser and run a test" — Chrome DevTools MCP does not launch a browser; it connects to an already-running Chrome on `:9222`. SKILL.md must not imply otherwise.
- A future engineer who treats Chrome DevTools MCP as a primary user-flow E2E tool. It is secondary.
- A future engineer who hardcodes `mcp__chrome_devtools__*` in a SKILL.md. The skill body stays IDE-agnostic.
- A future engineer who renames the capability id from `chrome-devtools-mcp.browser-debug`. The id is the contract; the registry is the source of truth.

## How to apply

1. The canonical capability id is `chrome-devtools-mcp.browser-debug`.
2. Chrome DevTools MCP is **secondary** (CDP to `:9222`); Playwright MCP is **primary** (headed browser on demand). SKILL.md must not invert this.
3. Never reference `mcp__chrome_devtools__*` in a SKILL.md body.
4. The install command is `npx -y chrome-devtools-mcp@latest` (per the registry). Don't bake the package name into a skill.
5. For any CDP-level operation (network log, console scrape, page snapshot from a running Chrome), the skill body must say "use `peaks mcp call --capability chrome-devtools-mcp.browser-debug --tool <name>`". The LLM resolves the actual tool name from the registry.

## Cross-reference

- `.peaks/memory/mcp-decouple-playwright.md` — the Playwright decouple memo (primary surface).
- `.peaks/memory/peaks-mcp-plan-call-pattern.md` — the cross-cutting skill body pattern.
- `.peaks/memory/mcp-decouple-{figma,context7}.md` — the sibling memos for the other 2 capabilities.
- `src/services/mcp/mcp-install-registry.ts` — the registry that owns the capability id.
- `tests/integration/mcp/chrome-devtools-decouple.test.ts` — the contract test that enforces the canonical id and the secondary-surface distinction.
