# Peaks-Loop GStack integration

> Body of `## Peaks-Loop GStack integration`.

Map gstack stages to Peaks-Loop role artifacts; preserve Peaks-Loop confirmation gates. Do not delegate orchestration to gstack commands.

For frontend workflows, RD and QA must use Playwright MCP for real browser E2E. The consuming LLM detects the MCP from its own tool list: any Playwright MCP entry in the LLM tool list means the MCP is installed; absent means the user needs to install (`claude mcp add playwright -- npx @playwright/mcp@latest` in Claude Code; other IDEs have their own MCP install path). The LLM invokes the tool directly (browser_navigate / browser_click / browser_snapshot / browser_take_screenshot / browser_console_messages / browser_network_requests / browser_close) by name — there is no peaks-loop indirection. Chrome DevTools MCP is a secondary CDP surface only. Sanitize browser artifacts before retention (no login URLs, cookies, tokens, PII). See `references/browser-workflow.md`.