import { describe, expect, test } from 'vitest';
import { renderMessage } from '../../../../src/lib/render/message-renderer.js';

// Slice 2.0.1-ux-message-renderer — pure-function renderer.
// Mode is supplied by the caller (TTY detection lives outside the renderer).
// OSC 8 hyperlink format: ESC ] 8 ; ; URL ESC \ TEXT ESC ] 8 ; ; ESC \
//   represented here as "]8;;URL\\TEXT]8;;\\".

const OSC8_OPEN = ']8;;';
const OSC8_SEP = '\\';
const BOLD_OPEN = '[1m';
const BOLD_CLOSE = '[22m';
const INVERSE_OPEN = '[7m';
const INVERSE_CLOSE = '[27m';

describe('renderMessage — case A: TTY mode + http(s) URL', () => {
  test('wraps an http URL in OSC 8 hyperlink escape sequences', () => {
    const input = 'Open http://localhost:9222/dmwh/data_source/sc in your browser';
    const out = renderMessage(input, { mode: 'tty' });

    expect(out).toContain(OSC8_OPEN + 'http://localhost:9222/dmwh/data_source/sc' + OSC8_SEP);
    expect(out).toContain(OSC8_OPEN + OSC8_SEP);
    // The visible text portion should be the URL itself, preserved as-is.
    expect(out).toContain('http://localhost:9222/dmwh/data_source/sc');
  });

  test('also wraps https URLs', () => {
    const out = renderMessage('See https://example.com/docs', { mode: 'tty' });

    expect(out).toContain(OSC8_OPEN + 'https://example.com/docs' + OSC8_SEP);
  });
});

describe('renderMessage — case B: non-TTY mode returns plain text', () => {
  test('does not emit any OSC 8 escape sequences in plain mode', () => {
    const input = 'Open http://localhost:9222/dmwh/data_source/sc in your browser';
    const out = renderMessage(input, { mode: 'plain' });

    expect(out).toBe(input);
    expect(out).not.toContain(']8;');
  });

  test('plain mode also skips ANSI bold/inverse for markdown-lite markers', () => {
    const input = '**bold** and `code` here';
    const out = renderMessage(input, { mode: 'plain' });

    expect(out).toBe(input);
    expect(out).not.toContain('[');
  });
});

describe('renderMessage — case C: NO_COLOR opt-out returns plain text', () => {
  test('NO_COLOR forces plain output even when mode is tty', () => {
    const input = 'Open http://localhost:9222/dmwh/data_source/sc';
    const out = renderMessage(input, { mode: 'tty', noColor: true });

    expect(out).toBe(input);
    expect(out).not.toContain(']8;');
    expect(out).not.toContain('[');
  });
});

describe('renderMessage — case D: file:// URLs are detected', () => {
  test('wraps a file:// URL in OSC 8 in tty mode', () => {
    const input = 'Open file:///C:/Users/demo/report.pdf for details';
    const out = renderMessage(input, { mode: 'tty' });

    expect(out).toContain(OSC8_OPEN + 'file:///C:/Users/demo/report.pdf' + OSC8_SEP);
    expect(out).toContain(OSC8_CLOSE_MARKER());
  });

  test('file:// URL is left untouched in plain mode', () => {
    const input = 'See file:///tmp/log.txt';
    const out = renderMessage(input, { mode: 'plain' });

    expect(out).toBe(input);
  });
});

describe('renderMessage — case E: empty / non-string input returns input unchanged', () => {
  test('returns empty string for empty input', () => {
    expect(renderMessage('', { mode: 'tty' })).toBe('');
    expect(renderMessage('', { mode: 'plain' })).toBe('');
  });

  test('returns the input unchanged for non-string input', () => {
    const notAString = 42 as unknown as string;
    expect(renderMessage(notAString, { mode: 'tty' })).toBe(42);
    expect(renderMessage(notAString, { mode: 'plain' })).toBe(42);
    const obj = { a: 1 } as unknown as string;
    expect(renderMessage(obj, { mode: 'tty' })).toBe(obj);
  });
});

describe('renderMessage — markdown-lite (tty mode)', () => {
  test('converts **bold** to ANSI bold on both sides', () => {
    const out = renderMessage('this is **important** text', { mode: 'tty' });
    expect(out).toContain(BOLD_OPEN + 'important' + BOLD_CLOSE);
  });

  test('converts inline `code` to inverse-video on both sides', () => {
    const out = renderMessage('run `pnpm test` first', { mode: 'tty' });
    expect(out).toContain(INVERSE_OPEN + 'pnpm test' + INVERSE_CLOSE);
  });

  test('preserves bullet markers and URLs together', () => {
    const input = '- see http://example.com/x for context';
    const out = renderMessage(input, { mode: 'tty' });
    expect(out).toContain('- see ');
    expect(out).toContain(OSC8_OPEN + 'http://example.com/x' + OSC8_SEP);
  });
});

// Helper: the OSC 8 *close* hyperlink escape is `]8;;\\`
function OSC8_CLOSE_MARKER(): string {
  return OSC8_OPEN + OSC8_SEP;
}
