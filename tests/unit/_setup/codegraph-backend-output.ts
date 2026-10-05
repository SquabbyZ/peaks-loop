// tests/unit/_setup/codegraph-backend-output.ts
//
// The two pieces of SQLite-backend advice the REAL upstream `codegraph`
// binary prints, captured byte-for-byte, plus the one line peaks-loop
// replaces them with.
//
// Why this is shared instead of inline: three suites read the same bytes —
// the filter itself, the `init` echo path, and the failure-note paths. Two
// copies of upstream's block drift apart the first time upstream rewords it,
// and a drifting copy is worse than no copy: the filter would go green
// against fixture text that no longer exists.
//
// Captured 2026-10-05 from `peaks codegraph status --project .` on this repo
// (wasm backend, better-sqlite3 absent by design). The loader's twelve
// absolute search paths are shortened to two — same shape, no host paths in
// a test.

/** The frame upstream draws around its blocks: 72 box-drawing dashes. */
export const RULE = '─'.repeat(72);

/** `Backend:   wasm …` exactly as the terminal receives it. */
export const BACKEND_ANSI =
  '  Backend:   \x1b[33mwasm - slower fallback; run `npm rebuild better-sqlite3`\x1b[0m';

export const BACKEND_PLAIN =
  '  Backend:   wasm - slower fallback; run `npm rebuild better-sqlite3`';

/**
 * The whole runtime block upstream writes to STDERR on every invocation,
 * wasm backend included.
 */
export function wasmBlock(): string {
  return [
    RULE,
    '[CodeGraph] WASM SQLite fallback active (better-sqlite3 unavailable)',
    RULE,
    'Indexing and sync will be 5-10x slower than the native backend.',
    '',
    'Fix on macOS:',
    '  xcode-select --install        # install C build tools',
    '  npm rebuild better-sqlite3    # rebuild native binding for current Node',
    '',
    'Fix on Linux:',
    '  sudo apt install build-essential python3 make    # Debian/Ubuntu',
    '  # or: sudo yum groupinstall "Development Tools"  # RHEL/Fedora',
    '  npm rebuild better-sqlite3',
    '',
    'Or force-include as a hard dependency on any platform:',
    '  npm install better-sqlite3 --save',
    '',
    'Verify after fix: `codegraph status` should show `Backend: native`.',
    '',
    'Native load error: Could not locate the bindings file. Tried:',
    ' → C:\\repo\\node_modules\\.pnpm\\better-sqlite3@11.10.0\\node_modules\\better-sqlite3\\build\\better_sqlite3.node',
    ' → C:\\repo\\node_modules\\.pnpm\\better-sqlite3@11.10.0\\node_modules\\better-sqlite3\\lib\\binding\\node-v137-win32-x64\\better_sqlite3.node',
    RULE,
    ''
  ].join('\n');
}

/** What peaks-loop replaces the block with. */
export const WASM_NOTE =
  'note: codegraph is on its wasm SQLite backend (5-10x slower than native). ' +
  "This is intentional: peaks-loop ships no native addon and uses Node's built-in node:sqlite. " +
  'No action needed.';

/** What peaks-loop replaces the status line with. */
export const WASM_STATUS_PLAIN =
  '  Backend:   wasm (slower fallback — by design: peaks-loop ships no native SQLite addon)';

/** Anything the reader must no longer be told to install, rebuild or see. */
export const ADVICE_PATTERN =
  /better-sqlite3|xcode-select|build-essential|apt install|yum groupinstall|npm rebuild|npm install|bindings file|\.pnpm|Backend: native/i;

/** Test-local oracle: read the text the way the user does. */
export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}
