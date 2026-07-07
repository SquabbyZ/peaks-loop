# Peaks Code Workflow

Peaks Code is a facade over role skills. It keeps the workflow moving without absorbing role-specific responsibility.

## Modes

- Code: default, single controller with soft gates.
- Assisted: role skills contribute artifacts without broad swarm execution.
- Swarm: multiple subagents work in parallel when the CLI-managed profile is enabled.
- Strict: hook/profile guarded mode for high-risk work.

## Required code workflow evidence

A code workflow is not complete until Code has linked or summarized:

1. standards preflight;
2. PRD/RD scope and OpenSpec artifacts when required;
3. RD implementation evidence;
4. unit-test evidence for new or changed behavior;
5. code-review evidence;
6. security-review evidence;
7. RD post-check dry-run evidence;
8. QA API validation when applicable;
9. sanitized QA Playwright MCP browser E2E evidence for frontend projects (`mcp__playwright__browser_snapshot` / `take_screenshot` / `list_console_messages` / `list_network_requests`), with mandatory visible-browser confirmation and without login URLs, cookies, headers, tokens, storage state, browser traces, or PII/SSO/MFA screenshots/logs;
10. QA security, performance, and validation report evidence;
11. RD repair evidence for every failed, blocked, missing, or unverified QA item;
12. final QA report showing all acceptance items passed, or a blocked TXT handoff;
13. TXT handoff capsule.

For legacy repositories with pre-existing low UT coverage, do not require historical coverage cleanup as part of an unrelated change, but do require focused coverage evidence for the new or changed code.

## RD QA loop

Every RD implementation or repair slice must be followed by QA validation. If QA does not fully pass, Code routes the report back to RD, then repeats RD repair and QA validation until QA is all green or the workflow is blocked. In full-auto mode, Claude Code's `goal` command may be used to keep the controller objective explicit while Peaks artifacts remain authoritative.

## Capability discovery

Before using `find-skills`, explain the benefit and token cost unless the active profile permits automatic discovery.
