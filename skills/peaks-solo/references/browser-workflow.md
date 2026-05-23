# Headed browser workflow for Peaks skills

Peaks skills standardize on **Chrome DevTools MCP** as the controlled headed-browser surface. The previous `gstack/browse/dist/browse` reference is deprecated because it did not reliably open a visible browser window when triggered from peaks-solo. Chrome DevTools MCP opens a headed Chrome window by default and exposes a stable tool surface that Claude Code can drive directly.

## When to use the headed browser

Open a controlled browser when:

- PRD source is an authenticated product document (Feishu/Lark, Notion, internal wiki) and the URL passes the allow-list check.
- UI design or full-auto frontend work needs visible regression observation.
- QA needs E2E validation on a frontend, including console / network / accessibility / performance inspection.

Never open a browser to bypass authentication, run arbitrary URLs the user has not approved, or interact with payment / delete / authenticated mutation flows without explicit user confirmation.

## Install the Chrome DevTools MCP server (one-time)

Capability discovery exposes `chrome-devtools-mcp.browser-debug`. Install it through the Peaks CLI rather than hand-editing settings.json so the peaks-managed marker and backup flow apply:

```bash
peaks mcp list --json
peaks mcp plan   --capability chrome-devtools-mcp.browser-debug --json
peaks mcp apply  --capability chrome-devtools-mcp.browser-debug --yes --json
```

If a non-peaks-managed Chrome DevTools MCP entry already exists in `.claude/settings.json`, `apply` will refuse unless `--claim` is passed. Discuss with the user before claiming.

After install, Claude Code's MCP runtime exposes the tools under the `mcp__chrome-devtools__*` namespace. Peaks skills reference these tools directly; they are not invoked through `peaks mcp call` because Claude Code is the host that calls them.

## Tool mapping from gstack/browse to Chrome DevTools MCP

| Previous gstack/browse | Chrome DevTools MCP tool | Notes |
|---|---|---|
| Open visible browser window | `mcp__chrome-devtools__new_page` with the target URL | Opens headed Chrome by default. |
| `browse goto <url>` | `mcp__chrome-devtools__navigate_page` with `type: "url"` and the verified URL | URL must pass the allow-list check first. |
| `browse status` / verify window opened | `mcp__chrome-devtools__list_pages` then `mcp__chrome-devtools__take_screenshot` | Screenshot is the visible-browser confirmation. |
| `browse handoff "<reason>"` (login / CAPTCHA / SSO / MFA) | `mcp__chrome-devtools__select_page` with `bringToFront: true`, then wait for user explicit confirmation | The MCP server window is already visible; user just completes auth in it. |
| `browse focus` | `mcp__chrome-devtools__select_page` with `bringToFront: true` | |
| `browse resume` after user confirmation | proceed with `mcp__chrome-devtools__take_snapshot` / `take_screenshot` / `evaluate_script` | The browser stays open across commands. |
| `browse text` | `mcp__chrome-devtools__take_snapshot` (accessibility tree, structured text) | |
| `browse snapshot` | `mcp__chrome-devtools__take_snapshot` | |
| `browse screenshot` | `mcp__chrome-devtools__take_screenshot` (sanitize before retention) | |
| Inspect console | `mcp__chrome-devtools__list_console_messages` | |
| Inspect network | `mcp__chrome-devtools__list_network_requests` | |
| Performance trace | `mcp__chrome-devtools__performance_start_trace` then `performance_stop_trace` | |
| Accessibility audit | `mcp__chrome-devtools__lighthouse_audit` with `mode: snapshot` and `device: desktop` or `mobile` | |
| Resize for responsive checks | `mcp__chrome-devtools__resize_page` | |

## URL allow-list (always required before navigation)

Before calling `mcp__chrome-devtools__navigate_page`, verify:

1. URL uses `https:` (reject `http:`, `file:`, `data:`, `javascript:`).
2. Host belongs to an approved domain for the role (Feishu/Lark tenant for PRD product docs, the user-approved app target for UI/QA validation).
3. Reject `localhost`, loopback, link-local, raw IP, and private IP unless the user explicitly approves a controlled local test target.
4. Reject the navigation entirely if any check fails and surface the reason to the user. Do not silently downgrade to an unauthenticated fetch.

## Login / CAPTCHA / SSO / MFA handoff

If the page redirects to a login challenge:

1. Do not auto-fill credentials. Do not bypass authentication.
2. Call `mcp__chrome-devtools__select_page` with `bringToFront: true` so the user sees the visible Chrome window.
3. Wait for explicit user confirmation that they have completed authentication. Do not assume a state transition from any DOM signal alone.
4. After the user confirms, resume with `take_snapshot` / `take_screenshot` / `evaluate_script` as needed for the role artifact.
5. If the user cannot complete authentication, mark the role artifact `blocked` with a sanitized reason category (`login-required`, `mfa-required`, `access-denied`) and the exact next user action.

## Sensitive data sanitization

Never persist any of the following in `.peaks/<session-id>/**` artifacts:

- Login URLs, redirect URLs, OAuth callback URLs containing tokens or state.
- Cookies, request or response headers, session tokens, storage state, QR payloads.
- Raw network logs.
- Raw browser state, browser traces.
- Screenshots or logs containing PII, SSO challenge content, or MFA material.

Redact sensitive values before retention. Store evidence as sanitized observations (e.g., "user reached settings page; first 3 list items had a missing-image regression") rather than raw captures.

## Fallback when Chrome DevTools MCP is not installed

If `peaks mcp list --json` does not include `chrome-devtools` in `mcpServers`:

1. Surface the install commands above (peaks mcp plan / apply).
2. Do not silently fall back to unauthenticated fetch tools, screenshots-only, or manual transcription.
3. Frontend QA workflows that require headed browser validation mark the gate `blocked` with the install command in the next action. Manual steps or text-only fetching do not substitute for the mandatory headed browser gate.

Peaks role artifacts (PRD / UI / RD / QA) remain authoritative for what evidence the role recorded; Chrome DevTools MCP is the tool, not the verdict.
