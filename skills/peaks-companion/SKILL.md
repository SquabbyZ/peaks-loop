---
name: peaks-companion
description: Quick-start the chenhg5/cc-connect bridge for AI-agent-on-WeChat. Covers install, weixin pairing, lifecycle, and config in `~/.peaks/config.json`. Invoke when the user asks to: (a) use WeChat / 微信 to control Claude Code / Codex / Cursor / any local AI agent, (b) check the companion status, (c) set up / pair / restart the bridge, (d) migrate to a different channel (in this rid: refused; only weixin is wired). NEVER invoke cc-connect directly — always go through `peaks companion ...` commands.
internal: true
slice: 2026-06-14-cc-connect-weixin
channel: weixin
surface: cli
---

# Peaks-Cli Companion (peaks-companion)

`peaks-companion` is the **LLM-facing surface** for getting the chenhg5/cc-connect bridge running so the user can drive a local AI agent (Claude Code, Codex, Cursor, etc.) from WeChat on their phone. It does NOT introduce new CLI commands. It walks the LLM through the existing peaks CLI primitives — `peaks companion status / install / setup / start` — based on the user's intent and the current peaks state.

**Why this exists (dev-preference red line):** "skill is primary, CLI is auxiliary." The behavior that only an LLM in a skill prompt would use ("detect whether cc-connect is installed", "render the iLink QR for pairing", "explain why the bridge won't start") lives in this SKILL.md, not in a new `peaks <cmd>`. The CLI commands stay as atomic primitives the skill composes.

**Red line (read first):** This skill MUST NOT call cc-connect directly. The `peaks companion ...` CLI is the only side-effect surface. Reason: the LLM is one of N>1 callers; CLI ownership keeps audit, doctor, and lifecycle in one place. If you reach for `cc-connect` directly, stop and use `peaks companion ...` instead.

**Slice scope:** the first version supports WeChat / 微信 only (per the weixin-only AC1/AC2/AC6). Other channels (feishu / slack / discord / wecom / qq / line / telegram) are explicitly refused in this rid — `peaks companion --channel=<other>` exits with EX_USAGE (64). If the user asks to migrate to a different channel, refuse politely and point them at the roadmap; do NOT call cc-connect with a different platform type.

## Skill presence (MANDATORY first action)

```bash
peaks skill presence:set peaks-companion --project <repo> --mode <mode> --gate startup
peaks project memories --project <repo> --json  # load durable memory
```

The presence marker tells the global peaks status line that peaks-companion is orchestrating. The memory read pulls forward the slice #1 contract: `~/.peaks/config.json#companion` is the source of truth for cc-connect settings (binary path, source, ilink QR payload, login timeout); peaks CLI is the only side-effect surface.

## Step 1: detect current state

The skill's first move is to **read**, not to ask. Build a complete picture of the user's cc-connect environment before any side effect.

```bash
# 1. cc-connect status (running / pid / binary path / pairing / version)
peaks companion status --json

# 2. Companion block from peaks config (source of truth for slice change-1)
#    Read ~/.peaks/config.json → companion.{enabled, binaryPath, binaryPathSource,
#    configPath, weixin.ilinkQrPayload, loginTimeoutSec}
```

The skill composes a 1-2 sentence **state summary** before asking anything:

> "cc-connect@1.3.2 is installed at `/repo/node_modules/.bin/cc-connect` (source=node_modules/.bin) and the bridge is **not running**. WeChat pairing has **not** started. The peaks config has `companion.enabled=false` so `peaks companion start` will refuse to launch until you opt in. The iLink QR payload is the default `ilink://peaks-cli?project=default`."

The user gets a complete picture without having to answer any question. The next step only fires AskUserQuestion if intent is genuinely ambiguous.

## Step 2: AskUserQuestion (only if intent is ambiguous)

If the user typed `/peaks-companion` without context, the skill's intent is genuinely ambiguous. The four canonical intents are:

| Option | What it does |
|---|---|
| First-time install + pair | Run `peaks companion install` → opt in → `peaks companion setup` (renders QR) → `peaks companion start` |
| Show current status | Just print the state summary from Step 1; no side effects |
| Restart the bridge | Stop the running daemon (if any) and re-start it (`peaks companion restart`) |
| Migrate to a different channel | REFUSED in this rid (weixin-only). Point user to the roadmap. |

**Default option is "Show current status"** — the cheapest action, and the user gets useful output even if they didn't know what they wanted. AskUserQuestion is the ONLY place this skill asks anything. Destructive paths (Restart) gate on user confirmation here.

## Step 3: plan & preview (dry-run)

Before any side effect, the skill prints the exact CLI invocations it will run. This is the "see before you leap" step.

```
Plan: First-time install + WeChat pair for the cc-connect bridge

  1. peaks companion install
     → verifies cc-connect is on PATH (or pulled as a peaks-cli dep) and
       caches the resolved binary path under ~/.peaks/companion/ AND
       mirrors it into ~/.peaks/config.json#companion.binaryPath.

  2. peaks config set --key companion.enabled --value true
     → opts the bridge in. Without this, peaks companion start refuses.

  3. peaks companion setup
     → renders the iLink QR (qrcode-terminal) from
       ~/.peaks/config.json#companion.weixin.ilinkQrPayload,
       writes ~/.cc-connect/config.toml (weixin-only), and polls
       ~/.cc-connect/state.json for "logged-in".

  4. peaks companion start
     → daemonizes cc-connect under ~/.peaks/companion/cc-connect.pid.

Verification: after start, re-run `peaks companion status --json` to
             confirm the bridge is running and paired.

Proceed? (Y/n)
```

The plan MUST be human-readable. Don't run a side effect until the user confirms.

## Step 4: execute

For each step in the plan, invoke the CLI primitive. The skill does NOT call out to a hidden script — it runs the actual peaks CLI commands, so the user sees the same output they'd see typing the command themselves.

```bash
# Example: first-time install + WeChat pair
peaks companion install
peaks config set --key companion.enabled --value true
peaks companion setup
peaks companion start
```

After each command, check the exit code. If non-zero, STOP and report the failure to the user. The skill does NOT auto-rollback; the user decides what to do next.

For destructive paths (Restart), use a transactional pattern: capture the current status (`peaks companion status --json`), run `peaks companion restart`, then re-check status; if any step fails, report the partial state and let the user decide.

### About the QR rendering (BUG 7)

`peaks companion setup` renders the iLink QR in the **user's terminal** via cc-connect's `qrcode-terminal`. When peaks detects an interactive TTY (`process.stdout.isTTY === true`), it inherits cc-connect's stdio so the block characters land directly on the user's screen — NOT inside the chat where the skill is being invoked. **The LLM must tell the user explicitly**: "the ASCII QR is rendering in YOUR terminal; if you don't see it, check the terminal behind the chat / open the terminal that ran the command."

If the user can't find the QR in their terminal (e.g. they ran `peaks companion setup` via a remote shell, the chat UI is hiding output, or they're on a headless system), they have two fallbacks:

1. `peaks companion setup --json` — JSON output includes `iLinkUrl` (the URL cc-connect printed) and `qrPath` (the stable PNG path). The user can copy/paste the URL into WeChat's "Add by URL" flow, or open the PNG.
2. `~/.peaks/companion/qr.png` — peaks always writes the QR PNG to this stable path (overwritten on every setup run; mkdir'd as needed). The user can AirDrop, scp, or otherwise transfer the PNG to their phone and scan it from there. Use `--no-qr-image` to skip the PNG write entirely.

### Path B: manual token injection (BUG 8)

Path A (QR scan) is **unreliable for new installations** because of three iLink failure modes:

1. WeChat's liteapp webview shows `无法打开页面` with `net::ERR_UNKNOWN_URL_SCHEME` when cc-connect hands it the `ilink://...` URL.
2. The iLink backend (`ilinkai.weixin.qq.com`) is intermittently unreachable with `net/http: TLS handshake timeout` from some regions.
3. The QR session expires in ~2 minutes, which is often too short for a user to scan + tap "确认" + debug network errors.

If the user reports any of these (or has been stuck on path A for >2 minutes, or is on a region where the public iLink endpoint is blocked), **switch to Path B** — manual iLink token injection. The token looks like `<botid>@im.bot:<secret>` and can come from any of these sources:

- A friend's working installation (ask them to run `peaks companion token --reveal` and copy the `rawToken`).
- A previous peaks-cli / cc-connect installation where the QR DID work (re-run `peaks companion token --reveal` to recover the token from `~/.cc-connect/config.toml`).
- The OpenClaw web UI (which can also mint iLink tokens).

Once the user has a bearer, two CLI surfaces consume it:

```bash
# 1. Direct: bind the token, then start the daemon manually.
peaks companion token <bearer>
peaks companion start

# 2. Short-circuit: bind + start in one shot (recommended for new installs).
peaks companion setup --token <bearer>
```

Both forms are JSON-friendly (`--json`); the JSON payload includes `bound: true`, `binaryPath`, and `configPath` on success. The bearer is **never echoed back** in non-`--reveal` mode (the response shows a masked form like `825d03f9b830@im.bot:****` so the botid prefix is visible but the secret is hidden).

Other Path B flags:

- `--api-url <url>` — override the ilink base URL (use a proxy when `ilinkai.weixin.qq.com` is region-blocked).
- `--skip-verify` — skip cc-connect's post-bind getUpdates check (rare; mostly for tests).
- `--platform-index <n>` — forwarded to cc-connect (the platform entry index in the config).
- `--project <name>` — cc-connect project name (default `default`).

**Verify after Path B:**

```bash
peaks companion token            # → bound: true, maskedToken: <botid>@im.bot:****
peaks companion status           # → running: true
```

Then the user sends a message from WeChat to the bot. The bot should respond through the bridge (verify with `tail -n 50 ~/.peaks/companion/cc-connect.log`).

## Step 5: audit log

Every successful execution writes one JSON line to `.peaks/_runtime/<sid>/companion-onboard.log`:

```json
{"timestamp":"2026-06-14T19:55:00Z","intent":"first-time-install","detected_state":"not_installed","cli_invocations":["peaks companion install","peaks config set --key companion.enabled --value true","peaks companion setup","peaks companion start"],"outcome":"success","session_id":"2026-06-14-session-2bc187"}
```

The audit log is **machine-readable** (so `peaks project dashboard` can read it and surface "you set up the WeChat bridge on 2026-06-14") and **human-readable** (so the user can `cat` it to see the setup history). The skill does NOT write the log file itself — it delegates to `peaks project dashboard` (the canonical log writer, per the dev-preference red line "skill-first for workflow, CLI-backed for gates / side effects"). The audit log writer is a CLI primitive, not a per-skill helper.

## Boundaries

`peaks-companion` may:

- read `peaks companion status --json` and `~/.peaks/config.json` (Step 1 only)
- ask the user via AskUserQuestion (Step 2 only)
- preview the CLI invocations (Step 3)
- execute existing peaks CLI commands (Step 4)
- write a single line to the audit log (Step 5)

`peaks-companion` must NOT:

- introduce new `peaks <cmd>` CLI commands (dev-preference red line: "Default-no on new CLI commands")
- invoke `cc-connect` directly (the LLM is one of N>1 callers; CLI ownership keeps audit + lifecycle in one place)
- bypass the user's confirmation on destructive paths (Restart)
- modify `~/.cc-connect/config.toml` directly (the CLI owns that write path)
- run other peaks skills (peaks-ide, peaks-solo, etc.) — those are separate skills with their own scopes
- support non-weixin channels in this rid (refuse politely; the channel is locked)

## Reference: the CLI primitives the skill composes

- `peaks companion install` — verify cc-connect resolves (peaks-cli dep → PATH fallback); caches path under `~/.peaks/companion/` AND mirrors into `~/.peaks/config.json#companion.binaryPath`.
- `peaks companion setup` — render iLink QR (qrcode-terminal; rendered in the user's TTY), write `~/.cc-connect/config.toml` from typed peaks config, write `~/.peaks/companion/qr.png` (overwritten each run), poll `~/.cc-connect/state.json` for "logged-in". Flags: `--qr-image <path>` (override the PNG path), `--no-qr-image` (skip PNG write), `--json` (emit `iLinkUrl` + `qrPath` instead of the ASCII QR). With `--token <bearer>`, skip the QR path and bind an existing iLink token directly (Path B; see "Path B" above). Also accepts `--api-url` and `--skip-verify` as forwards.
- `peaks companion token [bearer]` — BUG 8 (Path B): manual iLink token injection. With no arg, reads the current token (masked; use `--reveal` for the raw bearer). With a bearer, binds it via `cc-connect weixin bind --token <bearer>`. Flags: `--project <name>`, `--platform-index <n>`, `--api-url <url>`, `--skip-verify`, `--reveal` (read mode only), `--json`.
- `peaks companion start` — daemonize cc-connect (`~/.peaks/companion/cc-connect.pid`).
- `peaks companion stop` — SIGTERM with 5s SIGKILL fallback.
- `peaks companion restart` — stop + start (force).
- `peaks companion status` — running / pid / binary-path / pairing / version (JSON-friendly).
- `peaks config set --key companion.enabled --value true` — opt the bridge in.
- `peaks project dashboard --json` — surfaces the current state summary; canonical audit log writer.
- `peaks skill runbook` — surfaces the peaks-companion skill body for inspection.

## Next-step references

- The slice #1 RD artifact at `.peaks/_runtime/<sid>/rd/requests/2026-06-14-cc-connect-weixin.md` documents the cc-connect resolution contract the skill is built on.
- The slice #1 PRD at `.peaks/_runtime/<sid>/prd/requests/2026-06-14-cc-connect-weixin.md` documents the 13 ACs this skill is part of.
- The slice change-1 deliverable (peaks-config as source of truth) lives in this branch's commit history (`f0400c0` + this slice).

## Default runbook

The skill is invoked as `/peaks-companion` or via the natural-language triggers listed in the frontmatter. The runbook is the body of this SKILL.md (steps 1-5 plus the boundaries and reference sections above); the runbook-service extracts the section between this `## Default runbook` heading and the next `##` heading.

When the user types `/peaks-companion` (or "use WeChat to control Claude Code" / "check the companion status" / "set up the WeChat bridge" / "migrate to a different channel"), execute Steps 1 → 5 in order:

1. **Skill presence (MANDATORY first action)**: `peaks skill presence:set peaks-companion --project <repo> --gate startup` and `peaks project memories --project <repo> --json` (load durable memory).
2. **Detect current state** (Step 1 above): `peaks companion status --json` + read `~/.peaks/config.json#companion`. Build a 1-2 sentence state summary that includes `binaryPath`, `binaryPathSource`, `running`, `pairing.state`, `companion.enabled`, and `companion.weixin.ilinkQrPayload`.
3. **AskUserQuestion** (Step 2 above, only if intent is ambiguous). Default option: "Show current status". Destructive paths (Restart) gate on user confirmation here. Non-weixin channel requests are refused in this rid.
4. **Plan & preview** (Step 3 above): print the exact `peaks companion ...` invocations before running them. Wait for "Proceed? (Y/n)".
5. **Execute** (Step 4 above): run the `peaks companion install / setup / start` (or `restart` / `status`) commands. Stop on non-zero exit. Do not auto-rollback. Do not call cc-connect directly.
6. **Audit log** (Step 5 above): delegate the JSONL write to `peaks project dashboard` (the canonical log writer; per the dev-preference red line, the skill MUST NOT introduce a new CLI primitive for the log writer).

CLI primitives the skill composes (per the "Reference" section above): `peaks skill presence:set`, `peaks project memories`, `peaks companion status / install / setup / start / stop / restart`, `peaks config set --key companion.enabled --value true`, `peaks project dashboard`, `peaks skill runbook`. The skill does NOT introduce any new `peaks <cmd>` command.