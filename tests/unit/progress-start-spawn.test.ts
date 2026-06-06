/**
 * Tests for the platform-specific spawn-args construction
 * in peaks progress start. Each supported platform (macOS,
 * Linux, Windows) must produce a spawn command + arg list
 * that:
 *   - Anchors the title in the spawned SHELL (not from the
 *     parent). Parent-set titles are overridden by the shell
 *     within milliseconds of start, so the title only sticks
 *     when emitted by the shell itself.
 *   - Runs a visible brand banner so the user can identify
 *     the new tab even when the title bar is hidden.
 *   - Eventually exec's the watch command with the canonical
 *     project root.
 *
 * Windows is the most subtle case: `start "title" cmd /k ...`
 * sets the title, but cmd.exe overrides it with the running
 * command name. We re-anchor via the `title` builtin BEFORE
 * the watch starts.
 */
import { describe, expect, test } from 'vitest';
import { buildStartSpawn } from '../../src/cli/commands/progress-start-spawn.js';

const PEAKS_BIN = '/usr/local/bin/peaks';
const PROJECT_ROOT = '/private/tmp/peaks-start-spawn-test';
// Em-dash (U+2014), not colon. See `buildStartSpawn` win32 branch — the
// em-dash is the only character that preserves "this is peaks-cli" branding
// without tripping cmd /c's drive-letter colon parse. The colon version
// `peaks-cli: sub-agent progress — test` is the previous (buggy) form and is
// retained as a sentinel in regression tests.
const WINDOW_TITLE = 'peaks-cli — sub-agent progress — test';

describe('buildStartSpawn — macOS (darwin)', () => {
  const spec = buildStartSpawn({
    peaksBin: PEAKS_BIN,
    projectRoot: PROJECT_ROOT,
    windowTitle: WINDOW_TITLE,
    platform: 'darwin'
  });

  test('uses osascript with a `do script` invocation', () => {
    expect(spec.ok).toBe(true);
    if (!spec.ok) return;
    expect(spec.command).toBe('osascript');
    expect(spec.args[0]).toBe('-e');
    // The do-script line embeds the shell command that
    // sets the title via OSC 0, then runs the banner,
    // then runs the watch. args[1] is the do-script
    // AppleScript; args[3] is the activate call.
    const doScript = spec.args[1] as string;
    expect(doScript).toContain('tell application "Terminal" to do script');
    expect(spec.args[3]).toBe('tell application "Terminal" to activate');
  });

  test('embeds the OSC 0 title escape inside the do-script shell', () => {
    if (!spec.ok) return;
    // The doScript arg is the AppleScript string. The shell
    // command inside it has been through the JS backslash
    // escape (so each `\` becomes `\\`), so the printf escape
    // shows up as `\\033]0;TITLE\\007` in the AppleScript
    // string. When AppleScript runs the do-script, the shell
    // receives the un-escaped `\033]0;TITLE\007` it needs.
    const doScript = spec.args[1] as string;
    expect(doScript).toContain(`printf '\\\\033]0;${WINDOW_TITLE}\\\\007'`);
  });

  test('embeds the watch command with --project and the canonical root', () => {
    if (!spec.ok) return;
    // The path / double-quote are JS-escaped for the
    // AppleScript string, so the path's `/`s are intact
    // (only `"` and `\` get backslash-escaped) and the
    // surrounding double-quotes are escaped to `\"`.
    const doScript = spec.args[1] as string;
    expect(doScript).toContain(`${PEAKS_BIN} progress watch --project \\"${PROJECT_ROOT}\\"`);
  });

  test('embeds the brand banner', () => {
    if (!spec.ok) return;
    // The banner is `echo "peaks-cli — ..."`. The double
    // quote around the message gets JS-escaped to `\"` for
    // the AppleScript string.
    const doScript = spec.args[1] as string;
    expect(doScript).toContain('echo \\"peaks-cli');
  });
});

describe('buildStartSpawn — Linux', () => {
  test('alacritty: uses --class + --title + OSC 0 inside the shell', () => {
    const spec = buildStartSpawn({
      peaksBin: PEAKS_BIN,
      projectRoot: PROJECT_ROOT,
      windowTitle: WINDOW_TITLE,
      platform: 'linux',
      linuxTerminalExists: (name) => name === 'alacritty'
    });
    if (!spec.ok) throw new Error('expected ok');
    expect(spec.command).toBe('alacritty');
    expect(spec.args).toContain('--class');
    expect(spec.args).toContain('peaks-cli-progress');
    expect(spec.args).toContain('--title');
    expect(spec.args).toContain(WINDOW_TITLE);
    // The OSC 0 escape must be inside the bash -c shell, not
    // just in the alacritty --title flag (which is overridden
    // by the running shell). Runtime string: printf '\033]0;TITLE\007'
    const shellArg = spec.args[spec.args.length - 1] as string;
    expect(shellArg).toContain(`printf '\\033]0;${WINDOW_TITLE}\\007'`);
    expect(shellArg).toContain(PEAKS_BIN);
  });

  test('gnome-terminal: uses --title + bash -lc', () => {
    const spec = buildStartSpawn({
      peaksBin: PEAKS_BIN,
      projectRoot: PROJECT_ROOT,
      windowTitle: WINDOW_TITLE,
      platform: 'linux',
      linuxTerminalExists: (name) => name === 'gnome-terminal'
    });
    if (!spec.ok) throw new Error('expected ok');
    expect(spec.command).toBe('gnome-terminal');
    expect(spec.args).toContain('--title');
    expect(spec.args).toContain(WINDOW_TITLE);
    expect(spec.args).toContain('--');
    expect(spec.args).toContain('/bin/bash');
    expect(spec.args).toContain('-lc');
  });

  test('konsole: sets --title and --p tabtitle', () => {
    const spec = buildStartSpawn({
      peaksBin: PEAKS_BIN,
      projectRoot: PROJECT_ROOT,
      windowTitle: WINDOW_TITLE,
      platform: 'linux',
      linuxTerminalExists: (name) => name === 'konsole'
    });
    if (!spec.ok) throw new Error('expected ok');
    expect(spec.command).toBe('konsole');
    // konsole uses --title once for the window caption and
    // --p tabtitle for the tab name; the title is the value
    // for both.
    expect(spec.args).toContain('--title');
    expect(spec.args).toContain(WINDOW_TITLE);
    expect(spec.args).toContain('--p');
    expect(spec.args).toContain('tabtitle');
  });

  test('falls back to the first candidate when none exist', () => {
    // No terminal exists. The fallback uses the first
    // candidate (gnome-terminal) with its full flag set.
    const spec = buildStartSpawn({
      peaksBin: PEAKS_BIN,
      projectRoot: PROJECT_ROOT,
      windowTitle: WINDOW_TITLE,
      platform: 'linux',
      linuxTerminalExists: () => false
    });
    if (!spec.ok) throw new Error('expected ok');
    expect(spec.command).toBe('gnome-terminal');
    // The OSC 0 title escape is still embedded in the
    // bash -c shell — the parent --title is best-effort.
    const shellArg = spec.args[spec.args.length - 1] as string;
    expect(shellArg).toContain(`printf '\\033]0;${WINDOW_TITLE}\\007'`);
  });
});

describe('buildStartSpawn — Windows (win32)', () => {
  const spec = buildStartSpawn({
    peaksBin: PEAKS_BIN,
    projectRoot: PROJECT_ROOT,
    windowTitle: WINDOW_TITLE,
    platform: 'win32'
  });

  test('uses cmd /c start with the title as the unquoted arg (Node applies Windows escaping)', () => {
    expect(spec.ok).toBe(true);
    if (!spec.ok) return;
    expect(spec.command).toBe('cmd');
    expect(spec.args[0]).toBe('/c');
    expect(spec.args[1]).toBe('start');
    // Slice 2026-06-06-sub-agent-spawn-bug-and-decouple Repair 1: the title
    // is passed UNQUOTED. Node's child_process.spawn applies the correct
    // Windows command-line escaping (e.g. wrapping args with spaces in
    // double quotes itself), which is more robust than pre-quoting in
    // JavaScript. Pre-quoting caused the OUTER `cmd /c` to mis-parse the
    // colon even with title-quoting (it sees the script structure, not
    // just the title arg).
    expect(spec.args[2]).toBe(WINDOW_TITLE);
    expect(spec.args[3]).toBe('cmd');
    expect(spec.args[4]).toBe('/k');
  });

  test('embeds the `title` builtin BEFORE the banner so the title sticks', () => {
    if (!spec.ok) return;
    // The shell command is the last arg. After the Repair 2 fix, it
    // is wrapped in an EXTRA outer pair of quotes so the OUTER
    // `cmd /c` sees the banner as a single arg. So the shellCmd
    // string is `"title "<windowTitle>" && echo ... && <watch>"`
    // — starting with the outer `"` and containing the inner
    // `title "<windowTitle>"` block. The title MUST be quoted
    // inside the title builtin so cmd /k parses it as one arg.
    const shellCmd = spec.args[spec.args.length - 1] as string;
    expect(shellCmd.startsWith('"title ')).toBe(true);
    expect(shellCmd).toContain(`"${WINDOW_TITLE}" && echo peaks-cli --- sub-agent progress && `);
    expect(shellCmd).toContain(PEAKS_BIN);
    expect(shellCmd.endsWith('"')).toBe(true);
  });

  test('quotes the title so cmd /k cannot mis-parse a colon as a drive letter (G1 bug regression)', () => {
    // Sentinel: the exact substring that previously triggered
    // "Windows 找不到文件 'sub-agent'" — a colon in the title. The
    // user-facing title is now em-dash, but `buildWinTitleCmd` must
    // STILL quote the title defensively so any future caller that
    // re-introduces a colon (or a stray special char) is protected.
    const specWithColon = buildStartSpawn({
      peaksBin: PEAKS_BIN,
      projectRoot: PROJECT_ROOT,
      windowTitle: 'peaks-cli: sub-agent progress — auto-spawn for sub-agent Task',
      platform: 'win32'
    });
    if (!specWithColon.ok) throw new Error('expected ok');
    // The shell command is `args[5]` (the `/c start "<title>" cmd /k <shell>`
    // form — args[0..4] are `/c start "<title>" cmd /k` and args[5] is the
    // shell command that starts with `title "<windowTitle>"`).
    const shellCmd = specWithColon.args[5] as string;
    expect(shellCmd).toContain('title "peaks-cli: sub-agent progress — auto-spawn for sub-agent Task"');
    // The colon-bearing string must NOT appear unquoted anywhere in args[5]
    // (otherwise cmd /k would still mis-parse the colon).
    expect(shellCmd).not.toMatch(/title peaks-cli:/);
  });

  test('win32 branch: args[5] is bannerCmd wrapped in extra outer quotes (Repair 2 — && chain guard)', () => {
    // The OUTER `cmd /c`'s script parser sees the `&&` operators in
    // bannerCmd as SCRIPT-LEVEL operators, which causes the title text
    // after the colon to be interpreted as a command/file. Fix: wrap
    // bannerCmd in an extra pair of outer quotes so the OUTER `cmd /c`
    // sees the banner as ONE arg. The INNER `cmd /k` strips the
    // extra outer quotes and parses the banner as a normal script.
    expect(spec.ok).toBe(true);
    if (!spec.ok) return;
    const shellCmd = spec.args[5] as string;
    // shellCmd MUST start AND end with a literal double-quote, so the
    // outer cmd /c sees it as a single quoted arg. The inner cmd /k
    // strips the outer quotes before parsing the && chain.
    expect(shellCmd.startsWith('"')).toBe(true);
    expect(shellCmd.endsWith('"')).toBe(true);
    // The `&&` chain MUST live INSIDE the outer quotes, not at the
    // script level. (If the outer `cmd /c` sees an unquoted `&&`, it
    // tries to parse the second half as a separate script command —
    // which is the original bug.)
    expect(shellCmd).toContain('" && echo peaks-cli --- sub-agent progress && ');
    // The quoted payload, when unwrapped, must still start with the
    // title builtin and end with the watch command.
    const inner = shellCmd.slice(1, -1);
    expect(inner.startsWith(`title "${WINDOW_TITLE}"`)).toBe(true);
    expect(inner.endsWith(PEAKS_BIN + ' progress watch --project "' + PROJECT_ROOT + '"')).toBe(true);
  });

  test('win32 branch: Node-constructed command line has && INSIDE a quoted region (real-spawn regression test)', () => {
    // This is the user-visible regression test. We construct the
    // ACTUAL command line that Node's child_process.spawn will emit
    // on Windows, using the same quote function as Node's libuv
    // (win32/spawn.js). The assertion: the `&&` chain in bannerCmd
    // lives INSIDE a single quoted region, not at the script level.
    // If the && ever leaks outside the quotes, the outer `cmd /c`
    // will see the rest of the banner as a separate script and
    // surface the "sub-agent not found" dialog on the user's
    // machine.
    expect(spec.ok).toBe(true);
    if (!spec.ok) return;
    const cmdline = buildCmdLineForWin32(['cmd', ...spec.args]);
    // The cmdline shape we expect is:
    //   cmd /c start "peaks-cli — ..." cmd /k "title \"peaks-cli — ...\" && echo ... && ..."
    //
    // libuv escapes literal `"` inside a quoted arg as `\"`, so the
    // walk below treats a backslash as a no-op for the in-quotes
    // toggle: a `"` is only a quote-boundary if the preceding
    // character is NOT a `\`. The `&&` chain must NEVER appear
    // while in-quotes is FALSE — that is the original bug.
    let inQuotes = false;
    let sawAndAndInQuotes = false;
    for (let i = 0; i < cmdline.length; i += 1) {
      const ch = cmdline[i];
      if (ch === '\\') {
        // Skip the next char — it is escaped (e.g. `\"` is a
        // literal quote inside the quoted arg, NOT a quote
        // boundary). libuv only escapes `"` and `\` inside
        // quoted args; for our purposes treating every `\` as
        // "escape next" is correct.
        i += 1;
        continue;
      }
      if (ch === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (ch === '&' && cmdline[i + 1] === '&') {
        if (!inQuotes) {
          throw new Error(
            `Found && OUTSIDE quotes at offset ${i} in cmdline:\n${cmdline}\n` +
            'The outer cmd /c would split here. The fix (wrap bannerCmd in extra quotes) is broken.'
          );
        }
        sawAndAndInQuotes = true;
        i += 1; // skip the second &
      }
    }
    expect(sawAndAndInQuotes).toBe(true);
    // The title text (containing em-dash) must be intact somewhere
    // in the command line.
    expect(cmdline).toContain('peaks-cli — sub-agent progress');
  });

  test('buildWinTitleCmd still rejects embedded `"`, `\\n`, `\\r` (defensive guard unchanged)', () => {
    // The Repair 1 em-dash change did not loosen the defensive guard
    // for embedded special characters. The guard is the second line
    // of defense; the em-dash is the first.
    const cases: Array<{ title: string; reason: string }> = [
      { title: 'has "embedded" quote', reason: 'embedded double-quote breaks cmd /k parsing' },
      { title: 'first line\nsecond line', reason: 'literal newline breaks cmd /k parsing' },
      { title: 'first line\rsecond line', reason: 'literal CR breaks cmd /k parsing' }
    ];
    for (const c of cases) {
      const bad = buildStartSpawn({
        peaksBin: PEAKS_BIN,
        projectRoot: PROJECT_ROOT,
        windowTitle: c.title,
        platform: 'win32'
      });
      expect(bad.ok, `expected unsupported for: ${c.reason}`).toBe(false);
    }
  });

  test('returns unsupported when the windowTitle contains a literal " (G1 defensive guard)', () => {
    // The --reason arg could in theory contain a literal double-quote. cmd
    // /k cannot survive an un-escaped " in the title, so we fail loud with
    // the same `unsupported: true` shape used for unknown platforms.
    const specBad = buildStartSpawn({
      peaksBin: PEAKS_BIN,
      projectRoot: PROJECT_ROOT,
      windowTitle: 'has "embedded" quote',
      platform: 'win32'
    });
    expect(specBad.ok).toBe(false);
    if (!specBad.ok) expect(specBad.unsupported).toBe(true);
  });

  test('returns unsupported when the windowTitle contains a newline (G1 defensive guard)', () => {
    const specBad = buildStartSpawn({
      peaksBin: PEAKS_BIN,
      projectRoot: PROJECT_ROOT,
      windowTitle: 'first line\nsecond line',
      platform: 'win32'
    });
    expect(specBad.ok).toBe(false);
    if (!specBad.ok) expect(specBad.unsupported).toBe(true);
  });
});

describe('buildStartSpawn — unsupported platform', () => {
  test('returns an unsupported result for aix / freebsd / etc.', () => {
    const spec = buildStartSpawn({
      peaksBin: PEAKS_BIN,
      projectRoot: PROJECT_ROOT,
      windowTitle: WINDOW_TITLE,
      platform: 'aix'
    });
    expect(spec.ok).toBe(false);
    if (spec.ok) return;
    expect(spec.unsupported).toBe(true);
  });
});

/**
 * Reconstruct the command line string that Node.js will pass to
 * CreateProcessW on Windows. We mirror the relevant subset of
 * libuv's quoting rules (see deps/uv/src/win/process.c and
 * deps/uv/src/win/snprintf.c in the Node source). For our
 * purposes:
 *   - An arg containing only safe chars (no spaces, no quotes,
 *     no `&`) is emitted as-is.
 *   - An arg containing whitespace, `&`, or other special chars
 *     is wrapped in double quotes, with literal `"` inside the
 *     arg escaped as `\"`.
 *   - The arg list is joined with single spaces; a `\` that
 *     immediately precedes a `"` is doubled (`\\"`) to survive
 *     the Windows command-line parser.
 */
function buildCmdLineForWin32(args: string[]): string {
  const out: string[] = [];
  for (const a of args) {
    if (a === '') {
      out.push('""');
      continue;
    }
    const needsQuotes = /[\s"&<>|^()]/.test(a);
    if (!needsQuotes) {
      out.push(a);
      continue;
    }
    const escaped = a.replaceAll('"', '\\"');
    out.push(`"${escaped}"`);
  }
  return out.join(' ');
}
