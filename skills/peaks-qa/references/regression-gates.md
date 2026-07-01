# Peaks QA Regression Gates

QA must be involved before refactor implementation.

## Required evidence

- coverage report or reason for blocking;
- regression matrix;
- baseline report;
- acceptance checks;
- API validation evidence when API behavior is in scope;
- Playwright MCP browser E2E evidence when a frontend exists or UI is in scope (the LLM checks its tool list for `mcp__playwright__*`; if absent, the user installs via `claude mcp add playwright -- npx @playwright/mcp@latest` for Claude Code, or the IDE-native install command otherwise — peaks-loop no longer auto-installs as of slice #016; capture with `browser_snapshot`, `browser_take_screenshot`, `browser_console_messages`, `browser_network_requests`), with mandatory visible-browser confirmation;
- security check evidence;
- performance check evidence;
- validation report;
- residual risk report.

## Refactor threshold

UT coverage below 95%, missing coverage, or unverifiable coverage blocks refactor implementation. For non-refactor work in legacy projects whose total coverage is already below the project target, QA may accept the legacy baseline only when new or changed code has focused unit-test coverage evidence.

## Frontend failure rule

If browser validation shows page errors, console exceptions, failed critical network requests, or visible regressions, QA returns the change to RD with evidence and reruns the browser path after the fix.
