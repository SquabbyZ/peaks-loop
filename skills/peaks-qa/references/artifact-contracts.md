# artifact-contracts.md

This reference documents artifact-contracts.md for peaks-qa.

Default local artifact path: `.peaks/<session-id>/qa/`.

QA artifacts should include regression matrices, API evidence, Chrome DevTools MCP E2E evidence (`mcp__chrome-devtools__take_snapshot`, `take_screenshot`, `list_console_messages`, `list_network_requests`), sanitized console/network observations, sanitized screenshots or observations, security/performance checks, validation report, residual risks, and blocked/final handoff capsules. Do not retain login URLs, cookies, headers, tokens, storage state, browser traces, or screenshots/logs containing PII or SSO/MFA material. Keep artifacts local by default. Do not commit or sync them unless explicitly authorized.
