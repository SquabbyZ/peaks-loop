---
name: peaks-companion-qr-autoopen-2026-06-15
description: peaks companion setup now auto-pops the QR PNG in macOS Preview / Windows Photos / Linux xdg-open. Replaces the manual 'open the file yourself' step.
kind: feedback
---

For rid=2026-06-15-qr-inline-display follow-up, the Claude Code chat "QR doesn't display" problem was solved by switching from inline-image rendering to **auto-opening the QR PNG in the user's default image viewer**. Shipped 2026-06-15 (main @ a3cc420, develop @ 189808c).

**Why the inline-image approach didn't work:** dogfood proved Claude Code chat does NOT fetch external images regardless of source — `data:` URLs, `file://` absolute paths, https paste-service URLs (uguu.se, litterbox.catbox.moe), all rendered as plain text. The only way to get an image into the chat is for the user to drag/paste it manually. So the inline-image approach was dead-end; auto-open is the new primary path.

**Cross-platform behavior:** `openInDefaultApp(path)` helper in `src/services/companion/qr-autoopen.ts`:
- macOS: `open <path>` (Preview, default image handler)
- win32: `cmd /c start "" <path>` — the empty `""` is the mandatory window-title placeholder. Without it, `start` treats the path as a title and never opens the file (a well-known Windows quirk).
- linux: `xdg-open <path>` (best-effort; if xdg-open is not installed the spawn() emits an error event, which the helper surfaces as `{ok:false, error}`).
- other (freebsd, sandboxed): returns `{ok:false, error:"unsupported platform:<x>"}` without throwing.

**Wiring:** `scheduleAutoOpenQr` polls for the QR PNG to appear (100ms interval, 10s ceiling, fire-and-forget). `SetupOptions` gains `autoOpenQr?: boolean` (default `true`) and `autoOpener?: (path) => Promise<OpenResult>` (test seam). CLI flag `--no-auto-open-qr` for CI/headless opt-out. 9 new tests (7 helper + 2 wiring); full suite 3198/3198 pass.

**When to use which renderer (refined precedence):**
1. `--no-auto-open-qr` set → just print the QR (TTY/inline), no preview window
2. Default (TTY, macOS/Win/Linux) → auto-open PNG in default viewer; user scans with phone
3. `--qr-inline` flag → emit `![QR](data:image/png;base64,...)` markdown (useful in non-Claude markdown surfaces like GitHub PR comments or Slack with markdown plugin)
4. `--qr-ascii` flag → legacy qrcode-terminal small-ASCII (screen readers, tests)
5. Claude Code env (no flag) → still uses inline data URL; will be a follow-up to flip default to paste / file:// once Claude Code adds image support

**Path B (manual token) remains the no-image-required escape hatch** — `peaks companion token <bearer>` works without any QR flow at all.

See `.peaks/_runtime/2026-06-15-session-b86446/txt/handoff.md` (this session) for the full handoff capsule.