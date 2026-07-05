# Browser self-test contracts

> Body of `## Hard contracts for browser self-test` + `### Contract 1` + `### Contract 2`.

For frontend or UI-affecting slices, RD's self-test uses the Playwright MCP headed browser to verify the implementation behaves correctly before handing off to QA. The two contracts below are identical in spirit to `peaks-qa`'s contracts — RD and QA share the same headed-browser path and the same evidence conventions; only the role differs.

## Contract 1 — Self-test screenshots must land under .peaks/_runtime/<sessionId>/qa/screenshots/

Even though RD runs the self-test, **the screenshot evidence is QA's** by convention (the test report under `.peaks/_runtime/<sessionId>/qa/test-reports/` cites these paths). Therefore RD's Playwright screenshot tool calls (the LLM invokes `browser_take_screenshot` directly when the the Playwright MCP tools are present in the LLM's tool list) MUST pass `filename` (in the args object) whose absolute path is inside `.peaks/_runtime/<sessionId>/qa/screenshots/`, exactly the same contract QA enforces. Do not let Playwright fall back to the project root. If the the Playwright MCP tools are absent from the tool list, STOP and tell the user: `claude mcp add playwright -- npx @playwright/mcp@latest` (Claude Code) or consult the IDE's MCP install docs.

## Contract 2 — Login / CAPTCHA / SSO / MFA wall is a hard block, not a skip

When the headed browser hits an auth wall, RD does **not** skip the browser gate. The skill must surface the wall with `AskUserQuestion` and pick one of three paths:

```
AskUserQuestion({
  question: "Headed browser hit a login wall at <URL>. How should RD self-test proceed?",
  options: [
    { label: "I am logged in / I'll log in now",
      description: "Pause RD. The visible browser is already open; the user completes login in-place, then types 'logged in' or equivalent. RD resumes browser_navigate + browser_snapshot from the post-login page." },
    { label: "Skip browser self-test, hand off to QA",
      description: "Mark the slice's browser self-test as deferred. Do NOT mark the slice as RD-done; transition to qa-handoff with browser-gate=blocked reason=login-required, and let QA's gate machinery surface the wall to the user again." },
    { label: "Cancel the workflow",
      description: "Stop RD. Emit a blocked TXT handoff so peaks-code can surface the auth wall to the user. Do not modify code paths that the browser gate would have covered." }
  ]
})
```

The full hard-block contract is defined in `peaks-qa` (see "Hard contracts for browser validation" there); RD inherits the same rules. Without an explicit decision from the user, RD does not advance past the wall.