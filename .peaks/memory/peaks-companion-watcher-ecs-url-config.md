---
name: peaks-companion-watcher-ecs-url-config
description: Planned iteration — peaks-cli gains a "watcher" capability that pushes LLM-CLI session events to a user-configured ECS relay URL. v0 is a single config item (companion.ecsUrl) in ~/.peaks/config.json; watcher code is not opened yet.
metadata:
  type: project
---
Planned iteration discussed 2026-06-07 (peaks-solo session `2026-06-07-session-84feb7`). User motivation: while away from home, want notifications + content + light interaction for an LLM CLI (Claude Code first) running on the home computer. Reference shape: "lite Trae Solo mobile / lite Claude mobile" — view + light response, not a full IDE. The 微信小程序 and the ECS relay are the user's personal projects, NOT in this iteration.

The conversation went through many rounds of scope-narrowing before landing here: "Mobile ↔ LLM sync" → "just AskUserQuestion" → "plus LLM replies + new questions" → "QR code?" → "Feishu personal AI is not great" → "I just want notifications when Claude Code finishes" → "like Trae Solo/Claude mobile, but lite" → "not just Claude Code, multi-platform" → "in ~/.peaks/config.json add an ECS URL config item".

**Locked decisions (treat as preserved):**

1. **v0 is a single config item: `companion.ecsUrl`** in `~/.peaks/config.json`. No code change is strictly required for the config item alone — it is a schema declaration. The user said "先不改代码"; do not open a slice just to add this line. Capture the intent here; open a slice when the watcher code path is actually needed.

2. **peaks-cli is the capability provider, not the relay.** The 微信小程序 (user's personal, AppID already registered) and the ECS relay on the user's 阿里云 ECS (Ubuntu 22.04, 2C/2G/3 Mbps, port 1998, ICP-filed domain) are out of peaks-cli's scope. peaks-cli's job: read the URL, open a WebSocket to it, push normalized LLM-CLI events.

3. **Adapter scope for v0: Claude Code only.** Other platforms (Codex, Gemini CLI, opencode, etc.) are out of v0. The adapter pattern is a clean place to add more later, but do not pre-build the abstraction beyond what Claude Code needs. Adapter reads `~/.claude/sessions/*.jsonl` (verify on real install before hardcoding).

4. **Tenancy: private relay.** The ECS is single-user / single-family. No multi-tenant isolation in v0. Auth is whatever the user implements (machine token, URL-embedded secret, etc.) — peaks-cli just hands the URL to a WS client.

5. **No new CLI command at the config-item step.** When the watcher is eventually added, the CLI (`peaks companion start|stop|status|pair`) MUST be invoked by a `peaks-companion` skill — skill-first rule, not orphan CLI.

**Why:** the user is the author of peaks-cli. Adding a "watcher that pushes to a user-configured ECS URL" is a small, well-bounded capability that respects `~/.peaks/config.json` schema discipline while leaving the actual implementation work (Claude Code adapter, WS client, ECS, mini program) to user-owned personal projects. Locking the design in memory now means: when the user returns with a real ECS to point at, the previous session's narrowing decisions are preserved and we don't re-litigate.

**How to apply:**
- When the user comes back to this thread, read this memory first before re-asking scope questions.
- The config item name `companion.ecsUrl` is the user's chosen shape — do not invent alternatives like `peaks.companion.url` or `companion.endpoint`.
- For the actual watcher implementation, read [[skill-first-cli-auxiliary-sub-agent-dispatch]] and [[peaks-current-directory-scope]] before opening a slice. The watcher must (a) be invoked by a `peaks-companion` skill, (b) read but never write to `~/.claude/` or other LLM CLI dirs.
- The mini program + ECS are user personal projects. Do not scope-creep peaks-cli to include them.
- The current session has `system/rd-prompt-013.txt` for an unrelated slice; this iteration would be slice #014+ if opened.

**Open questions (to resolve when watcher implementation starts):**
- Auth shape: machine token in URL, separate `companion.ecsPushToken` field, or JWT?
- Pairing: QR code in terminal scanned by `wx.scanCode`, or paste-the-token?
- Reverse direction (mini program → Claude Code): in v0, or pushed to v2?
- Claude Code session log path: verify on real install before hardcoding `~/.claude/sessions/*.jsonl`.

**Status (2026-06-07):** Parked. No slice opened. The user has the bandwidth to return when their ECS + mini program is ready to be the target.
