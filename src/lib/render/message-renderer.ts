// Slice 2.0.1-ux-message-renderer — pure-function human-text renderer.
//
// PURE function contract:
//   - No side effects (does not read process.stdout, does not call console.*).
//   - Returns a string. The caller decides whether to write it to stdout.
//   - Caller resolves the `mode` (TTY detection + opt-outs) and passes it in.
//
// Supported transformations (tty mode only — plain mode is a no-op pass-through):
//   1. OSC 8 hyperlink wrapping for http://, https://, and file:// URLs.
//      Format: ESC]8;;URL ESC\ TEXT ESC]8;; ESC\
//   2. Markdown-lite: **bold** -> ANSI bold; `code` -> inverse-video.
//   3. Bullet markers (lines beginning with `- ` or `* `) are preserved as-is.
//
// `noColor: true` (caller's signal for `NO_COLOR` / `--no-color` / `--json`) forces
// the same pass-through behavior as `mode: 'plain'`, even if the caller somehow
// passed `mode: 'tty'`. This is a defence-in-depth opt-out: the caller should
// also pass `mode: 'plain'`, but we don't trust that either, because the JSON
// envelope contract must not leak escape sequences.

export type MessageRenderMode = 'tty' | 'plain';

export interface MessageRenderOptions {
  mode: MessageRenderMode;
  /**
   * Optional override. When `true`, the renderer returns the input unchanged
   * regardless of `mode`. Callers should set this when `NO_COLOR` is set,
   * `--no-color` is passed, or `--json` is requested.
   */
  noColor?: boolean;
}

// OSC 8 escape sequence fragments. Format: ESC ] 8 ; ; URL ESC \ TEXT ESC ] 8 ; ; ESC \
// Browsers + terminals that understand OSC 8: Windows Terminal, iTerm2, WezTerm, recent GNOME Terminal.
const ESC = '';
const OSC8_OPEN = `${ESC}]8;;`;
const OSC8_SEP = `${ESC}\\`;
const OSC8_CLOSE = `${OSC8_OPEN}${OSC8_SEP}`;

// ANSI sequences used by the markdown-lite pass.
const ANSI_BOLD_OPEN = `${ESC}[1m`;
const ANSI_BOLD_CLOSE = `${ESC}[22m`;
const ANSI_INVERSE_OPEN = `${ESC}[7m`;
const ANSI_INVERSE_CLOSE = `${ESC}[27m`;

// Lightweight URL detector (deliberately not RFC-3986-perfect).
// Matches http(s):// and file:// tokens up to the first whitespace or
// common terminator. Trailing punctuation is captured as part of the URL,
// which is fine for display; the OSC 8 link still works because terminals
// re-tokenise on hover/click. To stay close to the slice spec's reference
// pattern we exclude <, >, ", ', and ` from URL characters.
const URL_PATTERN = /(https?:\/\/|file:\/\/)[^\s<>"'`]+/g;

// **bold** markers (non-greedy, multi-char safe). Allows ** at word boundaries.
const BOLD_PATTERN = /\*\*([^*\n]+?)\*\*/g;

// `inline-code` markers.
const CODE_PATTERN = /`([^`\n]+?)`/g;

/**
 * Render a human-readable message string for the terminal.
 *
 * Pure function. Returns the input unchanged when:
 *   - `input` is empty,
 *   - `input` is not a string (defensive: callers occasionally pass numbers/objects),
 *   - `mode === 'plain'`,
 *   - `noColor === true` (NO_COLOR / --no-color / --json opt-out).
 */
export function renderMessage(
  input: string,
  options: MessageRenderOptions
): string {
  if (typeof input !== 'string' || input.length === 0) {
    return input;
  }
  if (options.mode === 'plain' || options.noColor === true) {
    return input;
  }

  // Markdown-lite first, then URL linking. The order matters: bold/code
  // transformations can wrap parts of a URL (e.g. `\`code\`` containing a URL),
  // so we link URLs on the already-formatted string. Either order would be
  // acceptable; linking on the formatted string means a URL inside a code
  // span still gets hyperlink-wrapped, which is the modern-terminal-friendly
  // choice.
  let out = applyMarkdownLite(input);
  out = applyHyperlinks(out);
  return out;
}

function applyMarkdownLite(input: string): string {
  let out = input.replace(BOLD_PATTERN, (_match, inner: string) => {
    return `${ANSI_BOLD_OPEN}${inner}${ANSI_BOLD_CLOSE}`;
  });
  out = out.replace(CODE_PATTERN, (_match, inner: string) => {
    return `${ANSI_INVERSE_OPEN}${inner}${ANSI_INVERSE_CLOSE}`;
  });
  return out;
}

function applyHyperlinks(input: string): string {
  return input.replace(URL_PATTERN, (url) => {
    return `${OSC8_OPEN}${url}${OSC8_SEP}${url}${OSC8_CLOSE}`;
  });
}
