# ADR 0006: Internal browser service (parked)

- **Status:** parked — 2026-06-12
- **Authors:** smallmark1912 + Claude (peaks-solo session 2026-06-12-session-dbc275)
- **Target release:** peaks-cli 2.1.0 (paused; 2.0.1 hotfix shipped first)
- **Supersedes:** nothing
- **Superseded by:** nothing yet

## Context

As of peaks-cli 2.0.0, browser validation in `peaks-qa` requires the user to install two external MCP servers manually:

```
claude mcp add playwright -- npx @playwright/mcp@latest
claude mcp add chrome-devtools-mcp -- npx chrome-devtools-mcp@latest
```

If either is missing, `peaks-qa`'s frontend browser-validation gate is **blocked** (per `skills/peaks-qa/references/external-capability-guidance.md` line 9: "If Playwright MCP is not installed and the user does not authorize installation, mark frontend browser validation blocked"). This is the user-facing pain that motivated this ADR.

In the 2.0.0 → 2.0.1 cycle, the user surfaced this while dogfooding `peaks-solo` in a real consumer project (`platform-rag-web`): installing the MCPs requires CLI access to the user's Claude Code environment, is environment-specific, and the resulting surface is not under peaks-cli's control.

## Decision (proposed — parked before commit)

Replace the external-MCP dependency with a peaks-cli-owned internal HTTP service that exposes:

1. **Playwright-style endpoints** (LLM primary consumer):
   - navigate, click, fill, snapshot (a11y tree), screenshot, eval, login-handoff, login-resume
2. **CDP-style endpoints** (QA / perf / lighthouse consumer):
   - console (list/get/clear), network (list/get), perf (trace start/stop — independent subprocess), lighthouse (audit), emulate (network/CPU/viewport), heap (snapshot)

Architecture sketch:

```
peaks-cli (single binary)
├─ peaks browser CLI       (start / stop / status / navigate / click / …)
├─ HTTP server 127.0.0.1:19222 (loopback only, no auth)
│    ├─ /playwright/*  (Playwright endpoints)
│    ├─ /cdp/*         (CDP endpoints)
│    └─ /state         (shared cookies / storage / URL / last-screenshot)
├─ Playwright driver
│    ├─ Headless context (LLM default)
│    └─ Headed context (login-handoff; shared storage state with headless)
└─ State files
     ├─ ~/.peaks/browser/{cookies,storage-state,last-screenshot}.json
     └─ <project>/.peaks/_runtime/<sid>/qa/screenshots/  (contract-enforced)
```

### Locked design choices (4 user decisions)

| Dimension | Decision |
|---|---|
| Form | Internal HTTP server + peaks CLI wrapper |
| Lifecycle | Manual `peaks browser start / stop / status` |
| Port / auth | 127.0.0.1:19222, loopback only, no auth |
| Headed mode | Cross-platform desktop popup (Win / macOS / Linux) |
| CDP coverage | Full (console / network / perf / lighthouse / emulate / heap) |
| Perf isolation | Independent subprocess (avoid blocking main HTTP loop) |
| Backward compat | 2.1.0 breaking: `mcp__playwright__*` and `mcp__Chrome_DevTools_MCP__*` retired; `test-prompts.json` rewritten |

## Consequences

### Positive

- Removes the "frontend browser validation blocked when MCP missing" failure mode from `peaks-qa`.
- One binary, one lifecycle; matches `peaks-solo` skill-presence contract (service starts when peaks-solo runs, stops when it ends — *if* the auto-start option is chosen; for the parked MVP we default to manual).
- Sanitization contract from `skills/peaks-qa/references/browser-validation-contracts.md` is enforceable in the HTTP layer (screenshot `filename` must resolve under `.peaks/_runtime/<sid>/qa/screenshots/`).
- Cookie / storage state lives under peaks-cli's directory, not under `node_modules/@playwright/mcp/.../storage-state.json`.

### Negative / open concerns (4)

These were raised during the 2.0.1-hotfix-and-design-discussion session and **not yet resolved**:

1. **LLM tool-call ergonomics regression.** `mcp__playwright__browser_navigate URL` is a typed tool call returning structured result. `Bash(peaks browser navigate URL)` is a shell invocation requiring LLM to parse stdout + interpret exit code. Strictly worse for LLM token cost and error handling. Possible mitigation: peaks-cli ships its own MCP server that wraps the same HTTP service — the LLM keeps MCP ergonomics, peaks-cli keeps ownership. Rejected by the user during discussion ("形式: A 内部 HTTP server + peaks CLI 包装"); the alternative deserves a second look before the 2.1.0 cut.
2. **State-file footgun.** `~/.peaks/browser/cookies.json` and `storage-state.json` carry authenticated state. Risks: accidental `git add ~/.peaks/`, shared-user machines, peaks-cli backup scripts that don't filter. **Must** at minimum: 0700 perms, hard `.gitignore`, prominent README warning. Optional: macOS Keychain / Linux libsecret encryption.
3. **Headed-mode in non-desktop environments.** WSL2 / SSH / CI runners cannot pop a Chrome window. Required fallback: when `peaks browser login-handoff` cannot reach a desktop session, surface a clear error and offer (a) abort + manual verification, (b) auth-state.json preset injection, (c) skip browser validation for this slice. Without this, peaks-cli is a regression for users in headless server envs.
4. **Scope expansion in 2.1.0.** 2.0.1 hotfix shipped 4 RD slices that required 3 fix-up rounds. Browser service is 4 slices of similar or greater surface area (HTTP server, Playwright, CDP, headed) plus `test-prompts.json` rewrite plus `peaks-qa` skill + reference docs. **Recommended**: split into two releases — 2.1.0 (skeleton + Playwright endpoints + screenshot contract, additive, no breaking), 2.2.0 (CDP endpoints + headed + breaking MCP migration). This is the user's call when 2.1.0 work resumes.

### Cross-cutting reference

- The earlier discussion of "让 peaks-qa 更加精准的判断" (more precise QA judgment) is **downstream** of this ADR. Browser service provides high-precision data (console.error count, network 4xx-5xx, lighthouse score, heap growth); peaks-qa consumes those signals to make verdicts. However, **service is not the prerequisite for precision** — the existing `mcp__playwright__*` + `mcp__Chrome_DevTools_MCP__*` already expose most of those signals. Recommend diagnosing peaks-qa's current false-positive scenarios *before* committing to building the service.

## Pause reason

User said "先不做了" (let me interrupt, is this idea reasonable) and after the four-concerns critique said "先不做了" (let's not do it for now). Decision recorded as **parked**. Reopen when:

- peaks-qa precision diagnosis is done and the bottlenecks are confirmed to be data-side (not verdict-rule-side);
- the four open concerns above have user decisions (MCP double-track? 2-phase release? state encryption? headed fallback strategy?);
- a real consumer project is dogfooding peaks-qa in headless envs and headed-mode fallback is the actual blocker.

Until then, this ADR is a record of the design conversation, not a binding commitment.
