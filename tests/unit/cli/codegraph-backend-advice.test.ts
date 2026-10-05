// tests/unit/cli/codegraph-backend-advice.test.ts
//
// rid-CG-008 — stop telling the reader to rebuild a package this repo deleted.
//
// `peaks codegraph status` proxies the upstream binary's output verbatim, and
// upstream prints two pieces of SQLite-backend advice:
//
//   1. a status line, `Backend:   wasm - slower fallback; run
//      `npm rebuild better-sqlite3`` (stdout, wrapped in ANSI);
//   2. a runtime block on stderr, framed by 72-character `─` rules, that opens
//      `[CodeGraph] WASM SQLite fallback active (better-sqlite3 unavailable)`
//      and then spends ~30 lines telling the reader to install C build tools
//      (`xcode-select --install`, `sudo apt install build-essential python3
//      make`), to `npm rebuild better-sqlite3`, to `npm install better-sqlite3
//      --save`, and finally dumps the native loader's 12 absolute
//      `...\.pnpm\better-sqlite3@11.10.0\...better_sqlite3.node` search paths.
//
// Both were true when they were written. They are not true here: better-sqlite3
// was removed from this project on purpose (it required a C++ toolchain on every
// machine that installed the CLI), the stores run on Node's built-in
// `node:sqlite`, and upstream's wasm backend is therefore a permanent, chosen
// state — not a degradation the user should "fix". Following the advice cannot
// succeed: the package is not a dependency of anything in the lockfile anymore.
//
// So both are localized: the status line says why wasm is expected, and the
// block collapses to one note that says no action is needed. Nothing upstream
// said about the *index* is touched — Files/Nodes/Edges counts, the `[OK] Index
// is up to date` line and a `Backend:   native` line all pass through
// byte-for-byte.
//
// What is mocked and why: only the upstream binary spawn
// (`executeCodegraphInvocation`) for the render arms, so the commander wiring,
// the `--peaks-json` envelope and the stdout/stderr split are all real. The
// integration arm spawns the REAL upstream binary read-only against this repo —
// that is the drift tripwire: if upstream rewords the block, the filter stops
// matching and the arm's advice-still-reaches-the-user branch goes red.
//
// Dimensions covered:
//   - behavior:    input -> output for the pure filter (block, status line,
//                  boundary respect, idempotence, pass-through)
//   - render:      what the CLI actually writes to each stream, human + JSON
//   - integration: a real upstream spawn through the filter
//   - a11y:        no imperative "go install X" reaches the reader, and the
//                  note states that no action is needed
//
// Run with:
//   pnpm vitest run tests/unit/cli/codegraph-backend-advice.test.ts

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';
import {
  cleanupTmpWorkspace,
  useTmpWorkspace,
  type TmpWorkspace
} from '../_setup/tmp-workspace.js';

declareDimensions('tests/unit/cli/codegraph-backend-advice.test.ts', [
  'behavior',
  'render',
  'integration',
  'a11y'
]);

const __m = vi.hoisted(() => ({
  executeCodegraphInvocation: vi.fn()
}));

vi.mock('../../../src/services/codegraph/codegraph-service.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../../src/services/codegraph/codegraph-service.js')
  >('../../../src/services/codegraph/codegraph-service.js');
  return { ...actual, executeCodegraphInvocation: __m.executeCodegraphInvocation };
});

import { resolve } from 'node:path';
import { registerCodegraphCommands } from '../../../src/cli/commands/codegraph-commands.js';
import {
  rewriteBareCodegraphHints,
  rewriteSqliteBackendAdvice
} from '../../../src/cli/commands/codegraph-command-runtime.js';
import { createCodegraphInvocation } from '../../../src/services/codegraph/codegraph-service.js';
import { defaultCodegraphProcessRunner } from '../../../src/services/codegraph/codegraph-process-runner.js';

const RULE = '─'.repeat(72);

/** The line upstream prints on stdout, as the terminal receives it. */
const BACKEND_ANSI =
  '  Backend:   \x1b[33mwasm - slower fallback; run `npm rebuild better-sqlite3`\x1b[0m';
const BACKEND_PLAIN = '  Backend:   wasm - slower fallback; run `npm rebuild better-sqlite3`';

/** The whole runtime block, byte-for-byte in shape, on stderr. */
function wasmBlock(): string {
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

/** The single line the block collapses to (the shipped copy). */
const NOTE =
  'note: codegraph is on its wasm SQLite backend (5-10x slower than native). ' +
  "This is intentional: peaks-loop ships no native addon and uses Node's built-in node:sqlite. " +
  'No action needed.';

/** Every thing the reader must no longer be told to do or see. */
const ADVICE_PATTERN =
  /better-sqlite3|xcode-select|build-essential|apt install|yum groupinstall|npm rebuild|npm install|bindings file|\.pnpm|Backend: native/i;

const stripAnsi = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, '');

describe('rewriteSqliteBackendAdvice (rid-CG-008) — behavior', () => {
  it('collapses the whole runtime block to exactly the one note line', () => {
    const filtered = rewriteSqliteBackendAdvice(wasmBlock());
    expect(filtered.trim()).toBe(NOTE);
    expect(filtered.trim().split('\n')).toHaveLength(1);
  });

  it('keeps every line that is not part of the block, in order', () => {
    const input = ['[warn] watcher disabled', wasmBlock(), 'Some other stderr output'].join('\n');
    const filtered = rewriteSqliteBackendAdvice(input);
    expect(filtered).toBe(`[warn] watcher disabled\n${NOTE}\nSome other stderr output`);
  });

  it('rewrites the wasm status line to say the fallback is by design', () => {
    expect(rewriteSqliteBackendAdvice(BACKEND_PLAIN)).toBe(
      '  Backend:   wasm (slower fallback — by design: peaks-loop ships no native SQLite addon)'
    );
  });

  it('handles the ANSI-wrapped status line without leaving escape fragments', () => {
    const filtered = rewriteSqliteBackendAdvice(BACKEND_ANSI);
    // The yellow went away with the warning it was coloring, and no partial
    // escape may survive to print as visible `m` garbage.
    expect(filtered).toBe(
      '  Backend:   wasm (slower fallback — by design: peaks-loop ships no native SQLite addon)'
    );
    expect(filtered.includes('\x1b')).toBe(false);
  });

  it('leaves a native-backend status line byte-for-byte alone', () => {
    const native = '  Backend:   \x1b[32mnative\x1b[0m';
    expect(rewriteSqliteBackendAdvice(native)).toBe(native);
    expect(rewriteSqliteBackendAdvice(native.replace(/\x1b\[[0-9;]*m/g, ''))).toBe(
      '  Backend:   native'
    );
  });

  it('leaves index output that carries no SQLite advice byte-for-byte alone', () => {
    const clean =
      '\x1b[1mIndex Statistics:\x1b[0m\n  Files:     1,604\n  Nodes:     21,490\n\x1b[32m[OK]\x1b[0m Index is up to date\n';
    expect(rewriteSqliteBackendAdvice(clean)).toBe(clean);
  });

  it('collapses a block whose closing rule never arrived', () => {
    const truncated = wasmBlock().split('\n').slice(0, -2).join('\n');
    const filtered = rewriteSqliteBackendAdvice(truncated);
    expect(stripAnsi(filtered)).not.toMatch(ADVICE_PATTERN);
    expect(filtered.trim()).toBe(NOTE);
  });

  it('does not eat a rule line that frames output belonging to something else', () => {
    // The block body runs out, then a rule opens UNRELATED output. Only a rule
    // with block content after it is the block's own closing frame.
    const body = wasmBlock().split('\n').slice(0, -2).join('\n');
    const filtered = rewriteSqliteBackendAdvice(`${body}\n${RULE}\nSome unrelated framed output`);
    expect(filtered).toBe(`${NOTE}\n${RULE}\nSome unrelated framed output`);
  });

  it('is idempotent on the block and on both status-line spellings', () => {
    const once = rewriteSqliteBackendAdvice(wasmBlock());
    expect(rewriteSqliteBackendAdvice(once)).toBe(once);
    for (const line of [BACKEND_ANSI, BACKEND_PLAIN]) {
      const rewritten = rewriteSqliteBackendAdvice(line);
      expect(rewriteSqliteBackendAdvice(rewritten)).toBe(rewritten);
    }
  });

  it('leaves no trace of the deleted dependency or of the native loader', () => {
    const filtered = rewriteSqliteBackendAdvice(`${BACKEND_ANSI}\n${wasmBlock()}`);
    expect(stripAnsi(filtered)).not.toMatch(ADVICE_PATTERN);
  });

  it('matches the block after the bare-hint rewriter has already run', () => {
    // The pipeline order in production is hints first, advice second, so the
    // `Verify after fix` line it has to recognize says `peaks codegraph status`.
    const filtered = rewriteSqliteBackendAdvice(rewriteBareCodegraphHints(wasmBlock()));
    expect(filtered.trim()).toBe(NOTE);
  });
});

describe('peaks codegraph status (rid-CG-008) — render', () => {
  let ws: TmpWorkspace;
  let savedExitCode: string | number | null | undefined;

  beforeEach(() => {
    ws = useTmpWorkspace('peaks-cg-advice-');
    savedExitCode = process.exitCode;
    __m.executeCodegraphInvocation.mockReset();
  });

  afterEach(() => {
    process.exitCode = savedExitCode;
    cleanupTmpWorkspace();
  });

  async function runStatus(
    argv: readonly string[]
  ): Promise<ReturnType<typeof makeCapturedIo>['captured']> {
    const { io, captured } = makeCapturedIo();
    const program = new Command();
    registerCodegraphCommands(program, io);
    await program.parseAsync(['codegraph', ...argv], { from: 'user' });
    return captured;
  }

  it('writes only the note on stderr and the rewritten backend line on stdout', async () => {
    __m.executeCodegraphInvocation.mockResolvedValue({
      exitCode: 0,
      stdout: `\x1b[1mIndex Statistics:\x1b[0m\n${BACKEND_ANSI}\n\x1b[32m[OK]\x1b[0m Index is up to date\n`,
      stderr: wasmBlock()
    });

    const captured = await runStatus(['status', '--project', ws.path]);

    expect(captured.stderr.map(stripAnsi)).toEqual([NOTE]);
    const backendLine = captured.stdout
      .join('\n')
      .split('\n')
      .map(stripAnsi)
      .find((line) => line.includes('Backend:'));
    expect(backendLine).toBe(
      '  Backend:   wasm (slower fallback — by design: peaks-loop ships no native SQLite addon)'
    );
  });

  it('carries the collapsed advice in the --peaks-json upstream echo too', async () => {
    __m.executeCodegraphInvocation.mockResolvedValue({
      exitCode: 0,
      stdout: BACKEND_ANSI,
      stderr: wasmBlock()
    });

    const captured = await runStatus(['status', '--project', ws.path, '--peaks-json']);
    const text = captured.stdout.join('\n');
    const envelope = JSON.parse(text.slice(text.indexOf('{'))) as {
      ok: boolean;
      data: { upstream: { stdout: string; stderr: string } };
    };

    expect(envelope.ok).toBe(true);
    expect(envelope.data.upstream.stderr.trim()).toBe(NOTE);
    expect(stripAnsi(envelope.data.upstream.stdout)).not.toMatch(ADVICE_PATTERN);
  });

  it('passes a native-backend run through untouched', async () => {
    const stdout = `\x1b[1mIndex Statistics:\x1b[0m\n  Backend:   \x1b[32mnative\x1b[0m\n\x1b[32m[OK]\x1b[0m Index is up to date\n`;
    __m.executeCodegraphInvocation.mockResolvedValue({ exitCode: 0, stdout, stderr: '' });

    const captured = await runStatus(['status', '--project', ws.path]);

    expect(captured.stdout.join('\n')).toBe(stdout.trimEnd());
    expect(captured.stderr).toEqual([]);
  });
});

describe('rewriteSqliteBackendAdvice (rid-CG-008) — integration', () => {
  it('filters whatever the real upstream binary prints about the SQLite backend', async () => {
    // The drift tripwire, read-only against this repo's own index. It goes
    // through the REAL process runner: `executeCodegraphInvocation` is mocked
    // for the render arms above, and a mocked spawn would make this arm pass
    // without ever looking at upstream.
    const result = await defaultCodegraphProcessRunner(
      createCodegraphInvocation({ subcommand: 'status', project: resolve(__dirname, '../../..') })
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);

    const raw = `${result.stdout}\n${result.stderr}`;
    const localized = `${rewriteBareCodegraphHints(result.stdout)}\n${rewriteBareCodegraphHints(result.stderr)}`;
    const filtered = rewriteSqliteBackendAdvice(localized);

    if (/better-sqlite3/i.test(raw)) {
      // Upstream still advertises the deleted package: none of it may survive,
      // and the collapse has to be the note we designed, not silence.
      expect(stripAnsi(filtered)).not.toMatch(ADVICE_PATTERN);
      expect(filtered).toContain(NOTE);
    } else {
      // Native backend, or upstream reworded its advice away: the filter must
      // be inert, byte-for-byte.
      expect(filtered).toBe(localized);
    }
  }, 60_000);
});

describe('rewriteSqliteBackendAdvice (rid-CG-008) — a11y', () => {
  it('names nothing the reader is asked to run, and says so explicitly', () => {
    const filtered = stripAnsi(rewriteSqliteBackendAdvice(`${BACKEND_ANSI}\n${wasmBlock()}`));
    expect(filtered).toContain('No action needed.');
    expect(filtered).not.toMatch(/\brun\b|\binstall\b|\bsudo\b|\brebuild\b|\bnpm\b/);
  });

  it('still tells the reader which backend is in use and what it costs', () => {
    const filtered = stripAnsi(rewriteSqliteBackendAdvice(wasmBlock()));
    expect(filtered).toContain('wasm');
    expect(filtered).toContain('5-10x slower than native');
  });

  it('says why the fallback is expected rather than leaving it unexplained', () => {
    const filtered = stripAnsi(rewriteSqliteBackendAdvice(BACKEND_ANSI));
    expect(filtered).toContain('by design');
    expect(filtered).toContain('no native SQLite addon');
  });
});
