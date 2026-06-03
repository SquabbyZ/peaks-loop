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
const WINDOW_TITLE = 'peaks-cli: sub-agent progress — test';

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

  test('uses cmd /c start with the title as the first quoted arg', () => {
    expect(spec.ok).toBe(true);
    if (!spec.ok) return;
    expect(spec.command).toBe('cmd');
    expect(spec.args[0]).toBe('/c');
    expect(spec.args[1]).toBe('start');
    // Title is the next quoted arg. Quotes are part of the
    // string passed to start; the title is not bash-quoted.
    expect(spec.args[2]).toBe(`"${WINDOW_TITLE}"`);
    expect(spec.args[3]).toBe('cmd');
    expect(spec.args[4]).toBe('/k');
  });

  test('embeds the `title` builtin BEFORE the banner so the title sticks', () => {
    if (!spec.ok) return;
    // The shell command is the last arg. It must start with
    // `title <windowTitle>` so the title is re-anchored
    // before cmd.exe overrides it with the running command.
    const shellCmd = spec.args[spec.args.length - 1] as string;
    expect(shellCmd.startsWith(`title ${WINDOW_TITLE}`)).toBe(true);
    expect(shellCmd).toContain('echo peaks-cli --- sub-agent progress');
    expect(shellCmd).toContain(PEAKS_BIN);
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
