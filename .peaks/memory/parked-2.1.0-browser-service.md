---
name: parked-2.1.0-browser-service
description: 2.1.0 peaks browser service design — paused 2026-06-12 pending 4 open concerns
metadata:
  type: project
---
paused 2026-06-12.

Peaks-Qa needs Playwright MCP + Chrome DevTools MCP installed externally today. User wants peaks-cli to ship its own internal browser service so QA isn't blocked when MCPs are missing.

**Proposed design (parked, full detail in `docs/adr/0006-internal-browser-service.md`):**
- peaks-cli binary grows a `peaks browser` subcommand family
- internal HTTP server on `127.0.0.1:19222` (loopback only, no auth) with `/playwright/*` + `/cdp/*` endpoints
- manual lifecycle (`peaks browser start / stop / status`)
- headed mode pops cross-platform desktop Chrome; headless default
- 2.1.0 retires `mcp__playwright__*` and `mcp__Chrome_DevTools_MCP__*`; `test-prompts.json` rewritten

**Locked user decisions:**
- form: internal HTTP server + CLI wrapper (rejected peaks-owned MCP as an alternative; possibly deserves a second look — see concern 1)
- lifecycle: manual start/stop
- port + auth: 19222, loopback only, no auth
- headed: cross-platform desktop popup
- CDP: full coverage (console / network / perf / lighthouse / emulate / heap); perf in independent subprocess
- roadmap: 4 RD slices parallel (skeleton / Playwright / CDP / headed)

**Open concerns (4, not yet decided):**
1. LLM tool-call ergonomics regression vs MCP — `Bash(peaks browser …)` is strictly worse than `mcp__playwright__browser_*` for LLM token cost and error handling. Mitigation: ship a peaks-owned MCP that wraps the HTTP service.
2. State file footgun — `~/.peaks/browser/{cookies,storage-state}.json` carries authenticated state. Need 0700 + gitignore + Keychain/libsecret encryption consideration.
3. Headed-mode in WSL2/SSH/CI cannot pop a window. Required fallback: auth-state.json preset injection OR manual verification handoff.
4. Scope: 2.0.1 hotfix proved cross-cutting RD risks (4 slices, 3 fix-up rounds). Recommend split: 2.1.0 additive (skeleton + Playwright), 2.2.0 breaking (CDP + headed + MCP migration).

**Cross-link:** the other parked discussion topic (peaks-qa precision enhancement) is downstream of this. Diagnose peaks-qa false-positive scenarios first before committing to building the service — data is not necessarily the bottleneck.

**Why parked:** user said "先不做了" after the four-concerns critique. Not "never" — design is captured for resumption.

**How to apply:**
- Reopen only when the four open concerns have user decisions AND peaks-qa precision diagnosis says data-side is the bottleneck.
- 2.0.1 hotfix shipped first; this work is post-2.0.1.
- Do NOT start a `feature/2.1.0-browser-service` branch until ADR 0006 status moves from `parked` to `accepted`.
