---
name: peaks-companion-qr-inline-display-2026-06-15
description: peaks companion setup QR now renders inline in markdown surfaces (Claude Code chat, GitHub PR) via auto-detected renderer.
kind: feedback
---

For rid=2026-06-15-qr-inline-display, the `peaks companion setup` QR display problem in markdown-rendering chat surfaces (Claude Code chat window was the user's concrete case) was solved on 2026-06-15 (main @ 3eafe8a) by adding a renderer resolver that picks one of three output modes based on flag > env > TTY default. Concretely:

- **Default TTY:** `unicodeBlockQrRenderer` — emits half/full-block chars (█▀▄) using `QRCode.create(text).modules` directly. Denser than `qrcode-terminal`'s small-ASCII; works in any monospace terminal.
- **Claude Code auto-detect (or `--qr-inline` flag):** `inlineQrRenderer` — generates a PNG buffer via the new `qrcode@^1.5.4` dep and prints `![QR code](data:image/png;base64,<b64>)`. Claude Code renders the data URL inline; phones can scan it. Same renderer also works in GitHub PR comments, Slack with markdown plugin, etc.
- **`--qr-ascii` escape hatch:** `asciiQrRenderer` — wraps the legacy `qrcode-terminal` small-ASCII renderer (for tests, screen readers, environments where neither Unicode nor inline image is usable).

Flag precedence: `--qr-inline` > `--qr-ascii` > `CLAUDE_CODE` / `CLAUDE_CODE_ENTRYPOINT` env > `unicodeBlockQrRenderer` default. Path B (`--token <bearer>`) bypasses the renderer entirely (existing BUG 8 behavior preserved).

Dogfood: jsQR round-trip confirmed the rendered PNG decodes byte-for-byte to the original iLink URL — the machine-equivalent of "phone scanner pointed at screen". 22 unit tests in `tests/unit/companion/qr-renderers.test.ts` (3.6x the 6-test minimum). Full suite 3189/3189 pass; companion suite 223/223 pass. 0 CRITICAL/HIGH/MEDIUM security findings; cold start 0.261s (target <500ms); PNG warm 4-7ms (target <100ms).

When a user reports "QR doesn't display in chat" or "phone can't scan the QR", check (a) is `CLAUDE_CODE` / `CLAUDE_CODE_ENTRYPOINT` set? → should auto-pick inline; (b) is `--qr-ascii` set? → remove it; (c) is the renderer call going through `setup-service.ts` `qrRenderer` seam? → confirm `options.qrRenderer` is NOT overriding in the caller.

See `.peaks/_runtime/2026-06-15-session-b86446/txt/handoff.md` (to be written by peaks-txt) and `.peaks/_runtime/2026-06-15-session-b86446/rd/tech-doc.md` for design rationale.