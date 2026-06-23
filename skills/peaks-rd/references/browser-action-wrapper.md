# `peaks browser action` — slice 3 thin Playwright wrapper

For the common browser flow (navigate → click → fill → snapshot → extract),
use `peaks browser action <intent>` instead of hand-shelling each MCP tool
call. Five supported intents; each invocation triggers EXACTLY ONE MCP
tool call (no auto-snapshot between intents).

| Intent | Required args | MCP tool name |
|--------|---------------|----------------|
| `navigate` | `--url <url>` | `browser_navigate` |
| `click` | `--selector <simple>` | `browser_click` |
| `fill` | `--selector <simple> --value <v>` | `browser_fill_form` |
| `snapshot` | (none) | `browser_snapshot` |
| `extract` | `--expression <js>` | `browser_evaluate` |

(MCP namespace prefix is injected by the agent harness — do NOT bake it
into SKILL.md; see slice 016 contract.)

## Selector rules

Selectors MUST be simple: `#id`, `.class`, `tag`, `tag#id`, `tag.class`.
Anything else (XPath, attribute selectors, descendant chains, pseudo-class
chains) returns a "fall back to raw MCP" error.

## Anti-features (intentionally not built)

- No retry / circuit-breaker
- No selector caching
- No accessibility tree customization
- No screenshot / video
- No "smart selector healing"

If you need any of those, fall back to the raw Playwright MCP tools.

## KPI

Single browser action ≤ 5s end-to-end. The wrapper is a synchronous
dispatch + one MCP call; wall time = `runBrowserAction.elapsedMs` plus
the underlying MCP round-trip.
