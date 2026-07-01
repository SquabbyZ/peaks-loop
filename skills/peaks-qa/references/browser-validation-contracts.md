# Browser validation contracts (QA)

> Body of `## Hard contracts for browser validation` + `### Contract 1` + `### Contract 2`. These two contracts are non-negotiable. The previous prose-only phrasing let the LLM skip the browser gate entirely when an auth wall appeared, and let screenshots land in the project root because the LLM forgot to pass `filename`. Both fail modes are blocking violations; the rules below are what a reviewer should hold the skill to.

## Contract 1 — Screenshot path is mandatory and must land under .peaks/_runtime/<sessionId>/qa/screenshots/

Every Playwright screenshot tool call (the LLM invokes `browser_take_screenshot` directly when the Playwright MCP is present in its tool list) **MUST** pass `filename` (in the args object) whose absolute path is **inside** `.peaks/_runtime/<sessionId>/qa/screenshots/`. Concrete form:

```bash
# The LLM invokes this directly; peaks-loop is no longer the dispatcher.
# (This shape remains as documentation of the args schema.)
browser_take_screenshot \
  --args '{"filename":"/abs/path/.peaks/_runtime/<sessionId>/qa/screenshots/<state>.png"}'
```

The default behaviour of Playwright MCP when `filename` is omitted or points outside that directory is to write a screenshot to the current working directory, which leaves `.png` files scattered at the project root. **This is a workflow violation.** If a screenshot does land outside `.peaks/_runtime/<session-id>/qa/screenshots/` for any reason (e.g. an upstream tool wrote there), QA MUST move it into that directory before declaring the test report complete; do not commit project-root `.png` files. Sanitise before retention: no login URLs, cookies, headers, tokens, storage state, browser traces, or screenshots/logs containing PII or SSO/MFA material.

This rule is enforced by a Peaks-Loop preflight check inside this skill:

```bash
# After every browser_take_screenshot batch and before declaring the test report complete:
ls .peaks/_runtime/<session-id>/qa/screenshots/*.png 2>&1
#   Expected: at least one .png file under the screenshots directory.
#   "No such file" → BLOCKED. Either the screenshot was never taken, or
#   it landed in the project root (move it before continuing).
find . -maxdepth 1 -name '*.png' 2>&1
#   Expected: empty. Any .png at the project root is a leak — move it
#   to .peaks/_runtime/<session-id>/qa/screenshots/ before completing this skill.
```

## Contract 2 — Login / CAPTCHA / SSO / MFA wall is a hard block, not a skip

When the headed browser hits a login wall (Feishu / Lark SSO, GitHub OAuth, custom captcha, MFA push, anything that needs the human), QA **MUST NOT** silently downgrade to static screenshots, manual steps, or any other tool. The skill must surface the wall to the user with `AskUserQuestion` and pick one of three paths:

```
AskUserQuestion({
  question: "Headed browser hit a login wall at <URL>. How should QA proceed?",
  options: [
    { label: "I am logged in / I'll log in now",
      description: "Pause QA. The visible browser is already open; the user completes login in-place, then types 'logged in' or equivalent. QA then resumes browser_navigate + browser_snapshot from the post-login page." },
    { label: "Skip browser validation for this slice",
      description: "Mark the affected acceptance items as unverified in the test report. Do NOT issue a pass verdict. The slice stays in qa-running with the browser gate marked blocked, reason=login-required. peaks-solo's repair loop will surface this on the next cycle." },
    { label: "Cancel the workflow",
      description: "Stop QA immediately. Emit a blocked TXT handoff so peaks-solo can surface the auth wall to the user. Do not mark any acceptance items as accepted." }
  ]
})
```

Do **not** infer login completion from DOM state (presence of an avatar, a user-name span, etc.) — only the user's explicit confirmation counts. Do **not** route through Chrome DevTools MCP as a substitute for the headed browser; it does not launch a browser and cannot simulate user interaction.

This is the hard-block replacement for the previous "wait for the user" prose. Without an explicit decision from the user, QA does not advance past the wall.