---
name: peaks-companion-cc-connect-dogfood-2026-06-15
description: Dogfood captured 2026-06-15 on rid=2026-06-14-cc-connect-weixin — chenhg5/cc-connect bridged into peaks-cli as a weixin (iLink) channel. iLink service itself is unstable; path A (QR scan) is unreliable for new installs, path B (manual token) is the canonical fallback. iLink bearer tokens are long-lived (>2h observed). ASCII QR cannot be reliably scanned from chat clients.
metadata:
  type: feedback
---

Live dogfood on 2026-06-15 against `feature/cc-connect-weixin` (HEAD `ea45597`, 10 commits beyond main, BUG 6/7/8 all merged). Final state: iLink round-trip works via path B (manual token injection); daemon runs with old iLink bearer; `pairing: unknown` field display is a known minor drift.

## What works (B path)

- `peaks companion token <bearer>` — written to `~/.cc-connect/config.toml[projects.platforms.options].token`; **strict post-condition re-reads the file** to catch silent bind failures (BUG 8 contract).
- `peaks companion start` — spawns `node_modules/.bin/cc-connect` bare (no `--daemon` flag, BUG 5 fix) with `stdio: 'inherit'` in TTY (BUG 7 fix), `detached: true` + `child.unref()` so the daemon outlives the peaks-cli process.
- `peaks companion status` — reads PID file + binary probe. The `pairing` field lags reality (shows `unknown` even when token is bound and platform is ready) — cosmetic drift, not functional.
- WeChat ↔ cc-connect ↔ Claude Code round-trip confirmed: user sent `/help` via WeChat, cc-connect logged `audit: command_executed user_id=... platform=weixin project=default command=help` at 2026-06-15T11:02:32.

## What does NOT work (A path)

- `peaks companion setup` → `cc-connect weixin setup` → WeChat scans QR → "确认" → iLink service pushes login event.
- Failures observed: `net::ERR_UNKNOWN_URL_SCHEME` in WeChat webview (liteapp URL not recognized), `net/http: TLS handshake timeout` reaching `ilinkai.weixin.qq.com`, and QR session expires in ~2 minutes (often before user can scan).
- Root cause: Tencent's iLink service is intermittently unstable; not a peaks-cli bug. Even the same URL pattern that worked on 2026-06-15T10:48 fails an hour later.
- For a NEW install (no prior iLink session), path A is **not** viable on this network/in this iLink state. New users must come in with a pre-existing iLink bearer token (from a working network, OpenClaw, a friend's setup) and use path B.

## iLink bearer token lifetime

- Observed: a token issued by `cc-connect weixin setup` at 2026-06-15T10:48 was still valid at 12:46 (~2 hours) and was re-accepted by the daemon on `peaks companion start` without re-scan.
- Implication: iLink bearer tokens (Bearer format `BOTID@im.bot:HEX`) are long-lived enough to be portable across sessions and machines. That's the operational reason path B works at all.
- A successful token also caches a session in `~/.cc-connect/sessions/default_<hash>.json` that the daemon re-loads on every start. Removing that dir forces a full re-bind.

## ASCII QR in chat does NOT scan reliably

- Tried three encodings; **all failed** to be recognized by WeChat scan:
  1. `qrcode-terminal` default (block chars `▀▄█`) — chat client stripped them
  2. Pure `#` + `  ` (2-char cells, 1 line tall) — 2:1 aspect ratio, scanner rejected
  3. Pure `#` + `  `, 2 chars wide × 2 lines tall per cell — still rejected (chafa/imagemagick not available to verify aspect ratio)
- Conclusion: chat-rendered ASCII QR is not a reliable scan path. The PNG file path (`~/.peaks/companion/qr.png`) is the only way to scan in this environment.
- A new user with no terminal, no PNG viewer, no `open` command on hand has no working onboarding path today. Future slice: ship a macOS `chafa`-style native renderer, or a base64 data-URL embed, or a `--webhook` to push the QR to a Slack/WeChat service the user can view elsewhere.

## iLink session short expiry

- iLink session ID (`?qrcode=...` URL param) is fresh per `weixin setup` invocation and expires in ~2 minutes. The cc-connect process polls long-poll iLink for that session ID; if you kill the process before the user scans, the session dies and a fresh one must be re-fetched.
- `pkill -f cc-connect` between attempts will keep re-issuing sessions forever; do not kill the listener until the user confirms scan + login.

## Why

- This dogfood is the empirical basis for treating the `companion` slice as **a tool that's mostly path B with a graceful path A fallback** — not the other way around. The PRD's optimistic "QR scan is the canonical path" assumption was wrong for this network state.
- For new-user onboarding, peaks-cli is **de facto** a token-handoff CLI: "ask a friend for a working iLink bearer, paste it in." That UX is honest for the current iLink state but not great.
- Long-term: the iLink channel should be a fallback. The canonical remote-control channel for personal AI-agent-on-IM is probably **企业微信 (wecom)** or **飞书 (feishu)** which use first-party Tencent/Bytedance APIs (no third-party bot gateway). Out of scope for rid=2026-06-14-cc-connect-weixin; parked for a future rid.

## How to apply

- When a user reports "iLink ERR_UNKNOWN_URL_SCHEME" or "QR expired before I could scan", the answer is **not** to retry setup. Walk them to path B:
  ```
  they need an existing iLink token from anywhere
  node bin/peaks.js companion token <bearer>
  node bin/peaks.js companion start
  node bin/peaks.js companion status   # expect running: true
  ```
- When path B also fails (token rejected by iLink), the user has to wait for iLink service to recover. There's no path C inside this rid.
- When the user asks to "show me the QR in the chat" — explain that chat clients don't render block chars or square cells reliably, and direct them to the PNG file. The `peaks-companion` skill already documents this; keep the warning prominent.
- When the `pairing: unknown` field looks wrong in status output, do not chase it. The daemon IS running with a bound token if `cc-connect log` shows `INFO platform ready platform=weixin` + `INFO cc-connect is running projects=1` + `session: loaded from disk sessions=1`. The status field is a separate code path that reads from `~/.peaks/companion/state.json` (which is populated by `cc-connect weixin setup`, NOT by `start`). Path B users never run `setup`, so `pairing` stays `unknown` forever. Cosmetic.
- When BUG 6 fix needs the `[[projects]]` (not `[projects]`) header: cc-connect 1.3.2's Go struct expects `[]Project` slice for `projects`; the previous `[projects] + [[projects.platforms]]` mixed layout caused `incompatible types: TOML value has type map[string]any; destination has type slice`. The fix is in `src/services/companion/config-template.ts` — re-emit with `[[projects]]` outer header + `[projects.agent]` + `[projects.agent.options]` + `[[projects.platforms]]` + `[projects.platforms.options]`.

## Related

- Companion slice: rid=2026-06-14-cc-connect-weixin, branch `feature/cc-connect-weixin` (HEAD `ea45597`, 10 commits beyond main). Merged to develop @ `4ca4b88`. NOT yet merged to main (last main merge was BUG 6 at `fe6bdb3`).
- Parked ECS relay: [[peaks-companion-watcher-ecs-url-config]] — superseded in spirit by the cc-connect integration (more capable + more on-iLink-shaped), but parked plan kept in case user wants ECS push later.
- Skill description: `skills/peaks-companion/SKILL.md` documents path A + path B + ASCII QR caveat. Re-read it before any new peaks-companion work.

**Status (2026-06-15):** ship the cc-connect integration as-is. Path A is the spec, path B is the operational reality. Future rid candidate: wework (企业微信) channel — the natural fix for new-user onboarding reliability.
