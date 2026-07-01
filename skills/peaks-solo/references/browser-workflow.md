# Headed browser workflow for Peaks skills

Peaks skills standardize on **Playwright MCP** as the controlled headed-browser surface for opening a browser on demand (PRD authenticated docs, UI design inspection, QA E2E validation). Chrome DevTools MCP is a secondary surface that **connects to an existing Chrome instance launched with `--remote-debugging-port=9222`** — it does not launch a browser on its own. Picking the right tool for the right job is critical:

| Need | Tool | Why |
|---|---|---|
| Open a controlled browser when the user supplies a URL | **Playwright MCP** | Spawns its own browser instance per session; no prerequisite. |
| Drive console/network/performance inspection on a Chrome the user already has open | Chrome DevTools MCP | Connects via CDP to an existing Chrome on `:9222`. |
| Frontend E2E validation that needs to start, navigate, capture, close | **Playwright MCP** | Headed mode, full lifecycle in one tool. |
| Live page debugging where the user wants to keep their own Chrome session in front | Chrome DevTools MCP | Stays attached without disrupting the user's tabs. |

> **Bug history**: an earlier version of this document recommended Chrome DevTools MCP for "open a headed browser when peaks-solo gets a product document link." Dogfood testing in 2026-05 revealed the tool requires a pre-running Chrome with remote debugging enabled — it does NOT launch its own browser. Playwright MCP is the correct tool for the "open on demand" case.

> **Slice #016 (2026-06-09)**: peaks-loop no longer manages MCP install / dispatch. Skill bodies instruct the LLM to (a) check its own tool list for any Playwright MCP entry, (b) invoke the tool by name if present, (c) tell the user the install command if absent. There is no peaks-loop MCP indirection layer anymore.

## When to open the headed browser

Open a controlled browser when:

- PRD source is an authenticated product document (Feishu/Lark, Notion, internal wiki) and the URL passes the allow-list check.
- UI design or full-auto frontend work needs visible regression observation.
- QA needs E2E validation on a frontend, including console / network / accessibility / performance inspection.

Never open a browser to bypass authentication, run arbitrary URLs the user has not approved, or interact with payment / delete / authenticated mutation flows without explicit user confirmation.

## Playwright MCP — install + detect

The LLM runtime exposes Playwright's tools under the `mcp__playwright__*` namespace when the user has installed the MCP. Skill bodies MUST NOT bake the prefix into a SKILL.md or reference; the prefix is owned by the LLM runtime.

**Detect**: the LLM checks its own tool list for any `mcp__playwright__*` entry. If present, the MCP is installed; the LLM invokes the tool by name (e.g. `browser_navigate`, `browser_take_screenshot`).

**Install (if absent)**: skill bodies surface the install command to the user. The user runs it themselves — peaks-loop does not hand-edit `~/.claude/settings.json`.

- Claude Code:
  ```bash
  claude mcp add playwright -- npx @playwright/mcp@latest
  ```
  Restart Claude Code (or reload the window) so the MCP runtime picks up the new server.

- Other IDEs (Trae, Cursor, Codex, Qoder, Tongyi, ...): consult the IDE's MCP install docs. The install command and the runtime prefix differ per IDE; the LLM checks the tool list rather than assuming a prefix.

The skill body uses the LLM's tool list as the source of truth — never the cached `~/.claude/settings.json` (the LLM cannot read the file, and the file's contents may have drifted from runtime state).

## Chrome DevTools MCP — optional, secondary surface

When inspecting an already-running Chrome (e.g., the user's own browser session opened with `chrome --remote-debugging-port=9222`), the LLM checks its tool list for any `mcp__chrome_devtools__*` entry. If present, the LLM invokes the tool by name directly (e.g. `list_pages`, `take_screenshot`, `performance_start_trace`).

Install (if absent) is the user's responsibility:

- Claude Code:
  ```bash
  claude mcp add chrome-devtools -- npx chrome-devtools-mcp@latest
  ```

Chrome DevTools tools fail with "Could not connect to Chrome" if no Chrome is running on `:9222`; that is by design and the skill must surface it as a blocked precondition, not silently fall back.

## Tool mapping for the "open a browser on demand" path (Playwright MCP)

The LLM invokes these tools directly from its `mcp__playwright__*` namespace. Peaks skill bodies describe the args shape; the LLM supplies them.

| Verb | Direct invocation (LLM tool list) | Notes |
|---|---|---|
| Open visible browser and navigate | `browser_navigate --args '{"url":"<url>"}'` | Spawns a headed browser if none open; navigates in the existing context otherwise. |
| Confirm visible browser opened | `browser_take_screenshot --args '{"filename":"<abs-path>"}'` | Screenshot is the visible-browser confirmation. |
| Read structured page (text + a11y) | `browser_snapshot --args '{}'` | Accessibility tree with element refs. |
| Click / fill / press key | `browser_click --args '<args>'` (and `browser_type`, `browser_press_key`) | Drive the page after navigation. |
| Inspect console errors | `browser_console_messages --args '{"level":"error"}'` | Pass `level` to filter (`error`, `warning`). |
| Inspect network failures | `browser_network_requests --args '{"filter":"<regex>"}'` | Pass `filter` regex when the page has many requests. |
| Resize viewport for responsive checks | `browser_resize --args '<args>'` | |
| Capture a full-page screenshot | `browser_take_screenshot --args '{"filename":"<abs-path>","fullPage":true}'` | Sanitize before retention. |
| Close the session cleanly | `browser_close --args '{}'` | End-of-task. |
| **Runtime prefix (LLM-owned, do not bake into skills)** | `mcp__playwright__<toolName>` | The Claude Code / Trae / etc. runtime prefix; the LLM resolves this from the registered server. |

## Tool mapping for the "connect to running Chrome" path (Chrome DevTools MCP, optional)

| Verb | Direct invocation (LLM tool list) | Notes |
|---|---|---|
| List pages in user's Chrome | `list_pages --args '{}'` | Requires Chrome already running with `--remote-debugging-port=9222`. |
| Bring a tab to front | `select_page --args '{"bringToFront":true}'` | Useful when the user navigated themselves. |
| Screenshot the visible viewport | `take_screenshot --args '<args>'` | |
| Read structured page | `take_snapshot --args '{}'` | |
| Performance trace | `performance_start_trace --args '<args>'` then `performance_stop_trace` | |
| Lighthouse audit | `lighthouse_audit --args '{"mode":"snapshot"}'` | |
| **Runtime prefix (LLM-owned, do not bake into skills)** | `mcp__chrome_devtools__<toolName>` | The Claude Code / Trae / etc. runtime prefix; the LLM resolves this from the registered server. |

If Chrome is not running on `:9222`, every Chrome DevTools MCP tool fails. The skill must surface that as a blocked precondition, not silently fall back.

## URL allow-list (always required before navigation)

Before invoking `browser_navigate --args '{"url":"<url>"}'` (or any other navigation), verify:

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

Never persist any of the following in `.peaks/_runtime/<session-id>/**` artifacts:

- Login URLs, redirect URLs, OAuth callback URLs containing tokens or state.
- Cookies, request or response headers, session tokens, storage state, QR payloads.
- Raw network logs.
- Raw browser state, browser traces.
- Screenshots or logs containing PII, SSO challenge content, or MFA material.

Redact sensitive values before retention. Store evidence as sanitized observations (e.g., "user reached settings page; first 3 list items had a missing-image regression") rather than raw captures.

## Fallback when Playwright MCP is not installed

If the LLM tool list does not include `mcp__playwright__*`:

1. Surface the install command for the user's IDE (the Claude Code install is `claude mcp add playwright -- npx @playwright/mcp@latest`; other IDEs differ).
2. Do not silently fall back to unauthenticated fetch tools, screenshots-only, or manual transcription.
3. Frontend QA workflows that require headed browser validation mark the gate `blocked` with the install command in the next action. Manual steps or text-only fetching do not substitute for the mandatory headed browser gate.
4. Restart the IDE after install; the runtime picks up the new server only after a fresh process / window reload.

Peaks role artifacts (PRD / UI / RD / QA) remain authoritative for what evidence the role recorded; Playwright MCP is the tool, not the verdict.
