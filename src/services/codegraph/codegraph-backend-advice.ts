// src/services/codegraph/codegraph-backend-advice.ts
//
// Localizes the SQLite-backend advice the upstream `codegraph` binary prints.
//
// It lives in the service layer, not the CLI, because two kinds of consumer
// need it: the CLI echo paths (re-exported from `codegraph-command-runtime.ts`)
// and the failure-note builders in `codegraph-autorefresh.ts` and
// `codegraph-preflight-service.ts`, which may not import from `src/cli`.
//
// What is being localized, and why it is wrong here:
//
//   1. a status line — `Backend:   wasm - slower fallback; run
//      `npm rebuild better-sqlite3``;
//   2. a runtime block on stderr, framed by 72-box-drawing rules, opening
//      `[CodeGraph] WASM SQLite fallback active (better-sqlite3 unavailable)`
//      and then telling the reader to install C build tools, rebuild the
//      binding, or add the package as a hard dependency, followed by the native
//      loader's absolute search paths.
//
// Both were true while `better-sqlite3` was a dependency. This project removed
// it on purpose — a native addon means a C++ toolchain on every machine that
// installs the CLI — and put its own stores on Node's built-in `node:sqlite`,
// so upstream's wasm fallback is permanent and intended, and the advice cannot
// be followed.
//
// Two exports, because the two consumers need different things:
//
//   - `rewriteSqliteBackendAdvice` for output the reader sees: the block
//     becomes one note saying no action is needed.
//   - `dropSqliteBackendAdvice` for a line being QUOTED as a failure cause:
//     substituting our note there would put filler where the cause belongs, so
//     the block is removed and the next real line surfaces.

/**
 * The control character that opens an SGR sequence, as a string constant:
 * `no-control-regex` refuses one inside a PATTERN literal, and an SGR sequence
 * begins with it by construction — so escape runs are found by scanning.
 */
// eslint-disable-next-line no-magic-numbers -- 27 is the ESC control character
const escChar = String.fromCharCode(27);

function sgrRunLength(text: string, from: number): number {
  if (text[from] !== escChar || text[from + 1] !== '[') {
    return 0;
  }
  let index = from + 2;
  while (index < text.length && /[0-9;]/.test(text[index] ?? '')) {
    index += 1;
  }
  return (text[index] ?? '') === 'm' ? index + 1 - from : 0;
}

/** The text a terminal would actually show for this line. */
function withoutSgr(text: string): string {
  let out = '';
  for (let index = 0; index < text.length; index += 1) {
    const run = sgrRunLength(text, index);
    if (run > 0) {
      index += run - 1;
      continue;
    }
    out += text[index];
  }
  return out;
}

/** The 72-box-drawing rule upstream frames its blocks with. */
const RULE_LINE_PATTERN = /^─{20,}$/;
/** Opens the runtime SQLite-backend block. */
const BLOCK_INTRO_PATTERN = /^\[CodeGraph\]\s+WASM SQLite fallback active\b/i;
/** `Backend:   wasm …`, judged on the visible line. */
const BACKEND_WASM_PATTERN = /^(\s*Backend:\s*)wasm\b/i;

const WASM_STATUS_TEXT =
  'wasm (slower fallback — by design: peaks-loop ships no native SQLite addon)';

/**
 * The line the runtime block collapses to. The yellow the status line was
 * wrapped in goes away with the warning it was coloring: this fallback is not
 * a warning here.
 */
const WASM_BACKEND_NOTE =
  'note: codegraph is on its wasm SQLite backend (5-10x slower than native). ' +
  "This is intentional: peaks-loop ships no native addon and uses Node's built-in node:sqlite. " +
  'No action needed.';

/** One line of the block, judged on the text the terminal shows. */
function isBackendAdvice(raw: string): boolean {
  const text = withoutSgr(raw).trim();
  if (text.length === 0) {
    return true;
  }
  if (text.includes('better-sqlite3')) {
    return true;
  }
  // The native loader's search paths, and the wrapped command lines.
  if (text.startsWith('→') || text.startsWith('npm ') || text.startsWith('sudo ')) {
    return true;
  }
  return /xcode-select|build-essential|apt install|yum groupinstall|^Indexing and sync will be |^Fix on (?:macOS|Linux):|^Or force-include as a hard dependency|^Verify after fix:|^Native load error:/i.test(
    text
  );
}

/**
 * True when the line is one of the 72-dash frames upstream draws around its
 * blocks.
 *
 * Exported for the failure-note builders, because a frame is never a cause and
 * the block removal alone does not get rid of every one: the frame's CLOSING
 * rule survives whenever the cause line follows it with no blank line between
 * (measured 2026-10-06 against the real binary — `files` on an unreadable store
 * leaves `────…` and then `[ERR] Failed to list files: file is not a database`,
 * and the note quoted the rule).
 */
export function isBackendRuleLine(raw: string): boolean {
  return RULE_LINE_PATTERN.test(withoutSgr(raw).trim());
}

function isRuleLine(raw: string | undefined): boolean {
  return raw !== undefined && isBackendRuleLine(raw);
}

/** The index of the last line the block owns, starting after its intro. A
 * rule belongs to the block only when block content follows it; otherwise it
 * frames something else and stays exactly where it was. */
function blockBodyEnd(lines: string[], introIndex: number): number {
  let index = introIndex + 1;
  while (index < lines.length) {
    const raw = lines[index] ?? '';
    if (isBackendAdvice(raw) || (isRuleLine(raw) && isBackendAdvice(lines[index + 1] ?? ''))) {
      index += 1;
      continue;
    }
    break;
  }
  return index - 1;
}

function collapseBackendAdvice(text: string, replacement: string): string {
  const lines = text.split('\n');
  const out: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const visible = withoutSgr(line);
    const statusMatch = BACKEND_WASM_PATTERN.exec(visible);
    if (statusMatch !== null) {
      out.push(`${statusMatch[1]}${WASM_STATUS_TEXT}`);
      continue;
    }

    if (!BLOCK_INTRO_PATTERN.test(visible)) {
      out.push(line);
      continue;
    }

    // The framing rule the block opens with was already emitted: take it back.
    if (isRuleLine(out[out.length - 1])) {
      out.pop();
    }
    out.push(replacement);
    index = blockBodyEnd(lines, index);
  }

  return out.join('\n');
}

/**
 * Rewrites the `Backend:   wasm` status line and collapses the
 * `WASM SQLite fallback active` block to one note. The match is anchored — a
 * run of block lines ends at the first line that is not a block shape. Output
 * with no wasm advice (notably a `Backend:   native` index) passes through
 * byte-for-byte, and the transform is idempotent.
 */
export function rewriteSqliteBackendAdvice(text: string): string {
  return collapseBackendAdvice(text, WASM_BACKEND_NOTE);
}

/**
 * Removes the block instead of replacing it, for callers that quote one line
 * of upstream output as a failure cause. The status line is still rewritten,
 * so no deleted-package name survives either way.
 */
export function dropSqliteBackendAdvice(text: string): string {
  return collapseBackendAdvice(text, '');
}
