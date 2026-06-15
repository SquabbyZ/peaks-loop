/**
 * 2026-06-15-qr-inline-display: QR renderer registry.
 *
 * Three renderers are exported:
 *
 *   - `unicodeBlockQrRenderer(qrPayload)` — emits half/full-block
 *     characters (█▀▄▌▐) by reading the QR matrix directly from the
 *     `qrcode` library and rendering 2 logical cells per terminal
 *     row. Denser than qrcode-terminal's small-ASCII output and
 *     reads as a real QR when scanned from a monospace terminal.
 *     This is the new TTY default.
 *
 *   - `inlineQrRenderer(qrPayload)` — emits a single
 *     `![QR code](data:image/png;base64,<b64>)` line that markdown
 *     renderers (Claude Code chat, GitHub PR comments, Slack with
 *     markdown plugin, etc.) display as an inline image. Designed
 *     for environments where ASCII/Unicode QR is unreadable.
 *     This is the Claude Code auto-detected default.
 *
 *   - `asciiQrRenderer(qrPayload)` — escape hatch that wraps the
 *     legacy `qrcode-terminal` small-ASCII renderer. Selected by
 *     `--qr-ascii`. Useful for tests, screen readers, or
 *     environments where neither Unicode blocks nor PNG inline are
 *     usable.
 *
 * `resolveQrRenderer({qrInline?, qrAscii?, env?})` picks one of the
 * three with the precedence: explicit flag > env auto-detect >
 * TTY default. The caller (setup-service) feeds this into the
 * existing `QrRenderer` seam — Path B (`bindToken`) bypasses it
 * entirely (existing behavior preserved).
 *
 * Dependencies:
 *   - `qrcode` — matrix access (for the block renderer) and PNG
 *     buffer generation (for the inline renderer). Lazily imported
 *     inside each renderer so a render failure in one mode does not
 *     prevent the other modes from loading.
 *   - `qrcode-terminal` — small-ASCII fallback (existing).
 */
import { defaultQrRenderer } from './setup-service.js';
import type { QrRenderer } from './setup-service.js';
// `qrcode` ships a default export whose TypeScript types expose
// `create` and `toBuffer`. We pull the values into named locals so
// the renderer code reads naturally and avoids `any`.
import QRCode from 'qrcode';

export { type QrRenderer };

/**
 * Detect whether the current process is running inside a Claude
 * Code chat session. The canonical marker is `CLAUDE_CODE=1`; we
 * also honor `CLAUDE_CODE_ENTRYPOINT` (Claude Code sets both) so
 * future marker changes still trigger inline mode.
 */
export function detectClaudeCodeEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const cc = env['CLAUDE_CODE'];
  if (typeof cc === 'string' && cc.length > 0) return true;
  const entry = env['CLAUDE_CODE_ENTRYPOINT'];
  if (typeof entry === 'string' && entry.length > 0) return true;
  return false;
}

/**
 * Render the QR as a half/full-block Unicode grid, two cells per
 * terminal row. This is denser than qrcode-terminal's small-ASCII
 * output and remains readable on Claude Code's monospace chat
 * font as well as any other monospace terminal.
 *
 * Implementation: read the QR matrix directly from `qrcode`, then
 * emit 2 rows per logical row using:
 *   - ' '  — both top and bottom cells empty
 *   - '▀'  — top cell filled, bottom empty
 *   - '▄'  — top cell empty, bottom filled
 *   - '█'  — both cells filled
 */
export async function unicodeBlockQrRenderer(qrPayload: string): Promise<void> {
  // qrcode's `create` factory returns the matrix directly; this is
  // the documented public API used by every CLI in the qrcode
  // README. `modules.data` is a Uint8Array of 0/1 cells; `modules.size`
  // is the dimension (always square).
  const qr = QRCode.create(qrPayload);
  const size = qr.modules.size;
  const data = qr.modules.data;
  const rows: string[] = [];
  // Quiet zone: a single empty column on each side keeps scanners
  // happy and aligns the output visually. Two empty rows top + bottom.
  rows.push(' '.repeat(size + 2));
  for (let y = 0; y < size; y += 2) {
    let line = ' ';
    for (let x = 0; x < size; x += 1) {
      const topIdx = y * size + x;
      const bottomIdx = Math.min(y + 1, size - 1) * size + x;
      const top = data[topIdx] === 1;
      const bottom = data[bottomIdx] === 1;
      if (top && bottom) line += '█';
      else if (top) line += '▀';
      else if (bottom) line += '▄';
      else line += ' ';
    }
    line += ' ';
    rows.push(line);
  }
  rows.push(' '.repeat(size + 2));
  process.stdout.write(rows.join('\n') + '\n');
}

/**
 * Render the QR as an inline markdown image. We generate a PNG
 * buffer with `qrcode` (NOT through qrcode-terminal — terminal
 * text is not what we want here), base64-encode it, and emit the
 * resulting markdown line on stdout.
 *
 * The output is a single line:
 *   ![QR code](data:image/png;base64,<b64>)\n
 *
 * The base64 charset (A-Za-z0-9+/=) does not contain `:` or ` `, so
 * the pipe-mode stdout scanner regex `iLink URL:\s*(\S+)` cannot
 * mistake this line for an iLink URL. Verified by an explicit test.
 */
export async function inlineQrRenderer(qrPayload: string): Promise<void> {
  const buf = await QRCode.toBuffer(qrPayload, { type: 'png' });
  const b64 = buf.toString('base64');
  process.stdout.write(`![QR code](data:image/png;base64,${b64})\n`);
}

/**
 * Escape hatch: wrap the legacy `qrcode-terminal` small-ASCII
 * renderer. We re-export `defaultQrRenderer` under a new name so
 * `resolveQrRenderer` can return it as a stable identity.
 */
export const asciiQrRenderer: QrRenderer = defaultQrRenderer;

export type ResolveOptions = {
  /** `--qr-inline` flag. Wins over env auto-detect. */
  qrInline?: boolean;
  /** `--qr-ascii` flag. Wins over env auto-detect. */
  qrAscii?: boolean;
  /** Process env override (used by tests). Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
};

/**
 * Pick the QR renderer to use based on flag > env > default.
 *
 * Precedence (highest first):
 *   1. `qrInline === true`  -> `inlineQrRenderer`
 *   2. `qrAscii === true`   -> `asciiQrRenderer`
 *   3. `CLAUDE_CODE` or `CLAUDE_CODE_ENTRYPOINT` set -> `inlineQrRenderer`
 *   4. otherwise             -> `unicodeBlockQrRenderer` (new TTY default)
 */
export function resolveQrRenderer(options: ResolveOptions = {}): QrRenderer {
  if (options.qrInline === true) return inlineQrRenderer;
  if (options.qrAscii === true) return asciiQrRenderer;
  const env = options.env ?? process.env;
  if (detectClaudeCodeEnv(env)) return inlineQrRenderer;
  return unicodeBlockQrRenderer;
}
