# Headed browser workflow for Peaks skills

Peaks skills standardize on **Playwright MCP** as the controlled headed-browser surface for opening a browser on demand (PRD authenticated docs, UI design inspection, QA E2E validation). Chrome DevTools MCP is a secondary surface that **connects to an existing Chrome instance launched with `--remote-debugging-port=9222`** — it does not launch a browser on its own. Picking the right tool for the right job is critical:

| Need | Tool | Why |
|---|---|---|
| Open a controlled browser when the user supplies a URL | **Playwright MCP** | Spawns its own browser instance per session; no prerequisite. |
| Drive console/network/performance inspection on a Chrome the user already has open | Chrome DevTools MCP | Connects via CDP to an existing Chrome on `:9222`. |
| Frontend E2E validation that needs to start, navigate, capture, close | **Playwright MCP** | Headed mode, full lifecycle in one tool. |
| Live page debugging where the user wants to keep their own Chrome session in front | Chrome DevTools MCP | Stays attached without disrupting the user's tabs. |

> **Bug history**: an earlier version of this document recommended Chrome DevTools MCP for "open a headed browser when peaks-solo gets a product document link." Dogfood testing in 2026-05 revealed the tool requires a pre-running Chrome with remote debugging enabled — it does NOT launch its own browser. Playwright MCP is the correct tool for the "open on demand" case.

## When to open the headed browser

Open a controlled browser when:

- PRD source is an authenticated product document (Feishu/Lark, Notion, internal wiki) and the URL passes the allow-list check.
- UI design or full-auto frontend work needs visible regression observation.
- QA needs E2E validation on a frontend, including console / network / accessibility / performance inspection.

Never open a browser to bypass authentication, run arbitrary URLs the user has not approved, or interact with payment / delete / authenticated mutation flows without explicit user confirmation.

## Install the Playwright MCP server (one-time)

Capability discovery exposes `playwright-mcp.browser-validation`. Install through the Peaks CLI rather than hand-editing settings.json so the peaks-managed marker and backup flow apply:

```bash
peaks mcp list --json
peaks mcp plan   --capability playwright-mcp.browser-validation --json
peaks mcp apply  --capability playwright-mcp.browser-validation --yes --json
```

If a non-peaks-managed Playwright MCP entry already exists in `.claude/settings.json`, `apply` will refuse unless `--claim` is passed. Discuss with the user before claiming.

After install, Claude Code's MCP runtime exposes the tools under the `mcp__playwright__*` namespace. Peaks skill bodies reference these tools via the `peaks mcp call` primitive (the skill body never bakes in the `mcp__playwright__` prefix; the prefix is owned by Claude Code's runtime, and `peaks mcp call` is the load-bearing fallback for sub-agents and non-Claude IDEs). The 4-step plan → apply → call pattern is the contract.

## Optional: install Chrome DevTools MCP for CDP inspection

When inspecting an already-running Chrome (e.g., the user's own browser session opened with `chrome --remote-debugging-port=9222`), additionally install Chrome DevTools MCP:

```bash
peaks mcp plan   --capability chrome-devtools-mcp.browser-debug --json
peaks mcp apply  --capability chrome-devtools-mcp.browser-debug --yes --json
```

Tools become available under `mcp__chrome-devtools__*` in the LLM runtime. Peaks skill bodies invoke them via `peaks mcp call --capability chrome-devtools-mcp.browser-debug --tool <name> --args-json '<args>' --json` (the skill body never bakes in the `mcp__chrome-devtools__` prefix). They fail with "Could not connect to Chrome" if no Chrome is running on `:9222`; that is by design.

## Tool mapping for the "open a browser on demand" path (Playwright MCP)

| Verb | peaks mcp call invocation | Notes |
|---|---|---|
| Open visible browser and navigate | `peaks mcp call --capability playwright-mcp.browser-validation --tool browser_navigate --args-json '{"url":"<url>"}' --json` | Spawns a headed browser if none open; navigates in the existing context otherwise. |
| Confirm visible browser opened | `peaks mcp call --capability playwright-mcp.browser-validation --tool browser_take_screenshot --args-json '{"filename":"<abs-path>"}' --json` | Screenshot is the visible-browser confirmation. |
| Read structured page (text + a11y) | `peaks mcp call --capability playwright-mcp.browser-validation --tool browser_snapshot --args-json '{}' --json` | Accessibility tree with element refs. |
| Click / fill / press key | `peaks mcp call --capability playwright-mcp.browser-validation --tool browser_click --args-json '<args>' --json` (and `browser_fill`, `browser_press_key`) | Drive the page after navigation. |
| Inspect console errors | `peaks mcp call --capability playwright-mcp.browser-validation --tool browser_console_messages --args-json '{"level":"error"}' --json` | Pass `level` to filter (`error`, `warning`). |
| Inspect network failures | `peaks mcp call --capability playwright-mcp.browser-validation --tool browser_network_requests --args-json '{"filter":"<regex>"}' --json` | Pass `filter` regex when the page has many requests. |
| Resize viewport for responsive checks | `peaks mcp call --capability playwright-mcp.browser-validation --tool browser_resize --args-json '<args>' --json` | |
| Capture a full-page screenshot | `peaks mcp call --capability playwright-mcp.browser-validation --tool browser_take_screenshot --args-json '{"filename":"<abs-path>","fullPage":true}' --json` | Sanitize before retention. |
| Close the session cleanly | `peaks mcp call --capability playwright-mcp.browser-validation --tool browser_close --args-json '{}' --json` | End-of-task. |
| **Reference (runtime prefix, do not bake into skills)** | `mcp__playwright__<toolName>` | The Claude Code runtime prefix; the LLM resolves this from the registered server. The skill body uses `peaks mcp call` exclusively. |

## Tool mapping for the "connect to running Chrome" path (Chrome DevTools MCP, optional)

| Verb | peaks mcp call invocation | Notes |
|---|---|---|
| List pages in user's Chrome | `peaks mcp call --capability chrome-devtools-mcp.browser-debug --tool list_pages --args-json '{}' --json` | Requires Chrome already running with `--remote-debugging-port=9222`. |
| Bring a tab to front | `peaks mcp call --capability chrome-devtools-mcp.browser-debug --tool select_page --args-json '{"bringToFront":true}' --json` | Useful when the user navigated themselves. |
| Screenshot the visible viewport | `peaks mcp call --capability chrome-devtools-mcp.browser-debug --tool take_screenshot --args-json '<args>' --json` | |
| Read structured page | `peaks mcp call --capability chrome-devtools-mcp.browser-debug --tool take_snapshot --args-json '{}' --json` | |
| Performance trace | `peaks mcp call --capability chrome-devtools-mcp.browser-debug --tool performance_start_trace --args-json '<args>' --json` then `performance_stop_trace` (each via `peaks mcp call`) | |
| Lighthouse audit | `peaks mcp call --capability chrome-devtools-mcp.browser-debug --tool lighthouse_audit --args-json '{"mode":"snapshot"}' --json` | |
| **Reference (runtime prefix, do not bake into skills)** | `mcp__chrome-devtools__<toolName>` | The Claude Code runtime prefix; the LLM resolves this from the registered server. The skill body uses `peaks mcp call` exclusively. |

If Chrome is not running on `:9222`, every Chrome DevTools MCP tool fails. The skill must surface that as a blocked precondition, not silently fall back.

## URL allow-list (always required before navigation)

Before calling `peaks mcp call --capability playwright-mcp.browser-validation --tool browser_navigate --args-json '{"url":"<url>"}' --json` (or any other navigation), verify:

1. URL uses `https:` (reject `http:`, `file:`, `data:`, `javascript:`).
2. Host belongs to an approved domain for the role (Feishu/Lark tenant for PRD product docs, the user-approved app target for UI/QA validation).
3. Reject `localhost`, loopback, link-local, raw IP, and private IP unless the user explicitly approves a controlled local test target.
4. Reject the navigation entirely if any check fails and surface the reason to the user. Do not silently downgrade to an unauthenticated fetch.

## Login / CAPTCHA / SSO / MFA handoff

If the page redirects to a login challenge:

1. Do not auto-fill credentials. Do not bypass authentication.
2. The headed browser is already visible; surface that to the user and wait for explicit confirmation that they have completed authentication. Do not assume a state transition from any DOM signal alone.
3. After the user confirms, resume with `browser_snapshot` / `browser_take_screenshot` / `browser_console_messages` / `browser_network_requests` as needed for the role artifact.
4. If the user cannot complete authentication, mark the role artifact `blocked` with a sanitized reason category (`login-required`, `mfa-required`, `access-denied`) and the exact next user action.

## Sensitive data sanitization

Never persist any of the following in `.peaks/<session-id>/**` artifacts:

- Login URLs, redirect URLs, OAuth callback URLs containing tokens or state.
- Cookies, request or response headers, session tokens, storage state, QR payloads.
- Raw network logs.
- Raw browser state, browser traces.
- Screenshots or logs containing PII, SSO challenge content, or MFA material.

Redact sensitive values before retention. Store evidence as sanitized observations (e.g., "user reached settings page; first 3 list items had a missing-image regression") rather than raw captures.

## Fallback when Playwright MCP is not installed

If `peaks mcp list --json` does not include `playwright` in `mcpServers`:

1. Surface the install commands above (peaks mcp plan / apply).
2. Do not silently fall back to unauthenticated fetch tools, screenshots-only, or manual transcription.
3. Frontend QA workflows that require headed browser validation mark the gate `blocked` with the install command in the next action. Manual steps or text-only fetching do not substitute for the mandatory headed browser gate.

Peaks role artifacts (PRD / UI / RD / QA) remain authoritative for what evidence the role recorded; Playwright MCP is the tool, not the verdict.
