/**
 * Pure platform-specific spawn-args construction for
 * `peaks progress start`. Extracted out of the commander
 * action handler so the three platform branches (darwin /
 * linux / win32) can be unit-tested without spawning real
 * terminals.
 *
 * The CLI action calls `buildStartSpawn` once per start
 * attempt and feeds the returned `{ command, args }` pair to
 * `child_process.spawn(..., { detached: true, stdio: 'ignore' })`.
 *
 * Cross-platform strategy (see progress-commands.ts for the
 * full design notes):
 *
 *   - macOS:  `osascript -e 'tell application "Terminal" to
 *              do script "<shell>"'`. The shell command sets
 *              the title via the OSC 0 escape (printf), runs
 *              the brand banner, then exec's the watch.
 *   - Linux:  First existing terminal emulator in
 *              { gnome-terminal, konsole, xfce4-terminal,
 *              tilix, alacritty, kitty }, with per-emulator
 *              flag translation. The shell inside also sets
 *              the title via OSC 0 (emulator --title is
 *              best-effort only — the shell overrides it).
 *   - Win32:  `cmd /c start "<title>" cmd /k <shell>`. The
 *              shell uses the `title` builtin (cmd.exe
 *              builtin) to re-anchor the title before the
 *              watch runs, because cmd.exe overrides the
 *              start-title with the running command name.
 *
 * The function never throws on unsupported platforms; it
 * returns a discriminated `unsupported` result so the caller
 * can surface a clean error envelope.
 */

import { existsSync } from 'node:fs';

export type StartSpawnSpec =
  | { ok: true; command: string; args: string[] }
  | { ok: false; unsupported: true };

export type BuildStartSpawnOptions = {
  /** The peaks binary path the spawned shell will invoke. */
  peaksBin: string;
  /** Canonical project root (used to build the watch command). */
  projectRoot: string;
  /** Window/tab title shared across platforms. */
  windowTitle: string;
  /** Current platform (from `os.platform()`). */
  platform: NodeJS.Platform;
  /**
   * Override for terminal detection on Linux. Defaults to
   * `existsSync('/usr/bin/<name>')` for each candidate. Tests
   * pass a stub to make the linux branch deterministic.
   */
  linuxTerminalExists?: (name: string) => boolean;
};

/** Brand banner the user sees in the spawned shell. */
const BANNER = 'echo "peaks-cli — sub-agent progress"';

/**
 * Build the POSIX OSC 0 title escape. The single-quote
 * escape is bash's `'\''` for embedding a single quote in a
 * single-quoted string; we need it because windowTitle may
 * contain user-provided text (the `--reason` argument).
 */
function buildPosixTitleCmd(windowTitle: string): string {
  const escaped = windowTitle.replaceAll("'", "'\\''");
  return `printf '\\033]0;${escaped}\\007'`;
}

/**
 * cmd.exe `title` builtin call. Quoting is REQUIRED: cmd /k parses the
 * subsequent tokens as a command line, and a `:` in the unquoted title (the
 * canonical peaks windowTitle starts with `peaks-cli:`) gets mis-read as a
 * drive-letter prefix, triggering Windows' "找不到文件 'sub-agent'" dialog.
 *
 * The double-quote wrap makes the whole title one parameter to `title`.
 * Defensive guard: reject embedded `"`, `\n`, or `\r` (the `cmd /k` parser
 * will not survive a literal newline or an un-escaped quote in the title).
 * Callers (progress-commands.ts:267) compose the title from CLI args; if
 * the user passed a `--reason` containing one of these characters, the
 * spawn attempt is abandoned with a tagged result so the CLI can surface
 * a clear error envelope.
 */
function buildWinTitleCmd(windowTitle: string): { ok: true; cmd: string } | { ok: false; unsupported: true } {
  if (windowTitle.includes('"') || windowTitle.includes('\n') || windowTitle.includes('\r')) {
    return { ok: false, unsupported: true };
  }
  return { ok: true, cmd: `title "${windowTitle}"` };
}

/** Shared helper: the shell command that runs the watch. */
function buildWatchCommand(peaksBin: string, projectRoot: string): string {
  return `${peaksBin} progress watch --project "${projectRoot}"`;
}

export function buildStartSpawn(options: BuildStartSpawnOptions): StartSpawnSpec {
  const { peaksBin, projectRoot, windowTitle, platform: currentPlatform } = options;
  const watchCommand = buildWatchCommand(peaksBin, projectRoot);
  const posixTitleCmd = buildPosixTitleCmd(windowTitle);
  const winTitleCmd = buildWinTitleCmd(windowTitle);

  if (currentPlatform === 'darwin') {
    const innerShell = `${posixTitleCmd}; ${BANNER}; ${watchCommand}`;
    const escapedInner = innerShell.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
    return {
      ok: true,
      command: 'osascript',
      args: [
        '-e',
        `tell application "Terminal" to do script "${escapedInner}"`,
        '-e',
        'tell application "Terminal" to activate'
      ]
    };
  }

  if (currentPlatform === 'linux') {
    const exists = options.linuxTerminalExists ?? ((name: string) => existsSync(`/usr/bin/${name}`));
    const candidates = ['gnome-terminal', 'konsole', 'xfce4-terminal', 'tilix', 'alacritty', 'kitty'] as const;
    const terminal = candidates.find((c) => exists(c)) ?? candidates[0];
    const titleArg: string[] = ['--title', windowTitle];
    const bannerShell = `bash -c '${posixTitleCmd}; ${BANNER}; exec ${watchCommand}'`;
    if (terminal === 'alacritty' || terminal === 'kitty') {
      return {
        ok: true,
        command: terminal,
        args: ['--class', 'peaks-cli-progress', ...titleArg, '-e', bannerShell]
      };
    }
    if (terminal === 'gnome-terminal' || terminal === 'tilix' || terminal === 'xfce4-terminal') {
      return {
        ok: true,
        command: terminal,
        args: [...titleArg, '--', '/bin/bash', '-lc', bannerShell]
      };
    }
    if (terminal === 'konsole') {
      return {
        ok: true,
        command: terminal,
        args: ['--title', windowTitle, '--p', 'tabtitle', windowTitle, '-e', bannerShell]
      };
    }
    // xterm / fallback: no --title support; bannerShell only.
    return { ok: true, command: terminal, args: ['-e', bannerShell] };
  }

  if (currentPlatform === 'win32') {
    if (!winTitleCmd.ok) {
      return { ok: false, unsupported: true };
    }
    const bannerCmd = `${winTitleCmd.cmd} && echo peaks-cli --- sub-agent progress && ${watchCommand}`;
    return {
      ok: true,
      command: 'cmd',
      args: ['/c', 'start', `"${windowTitle}"`, 'cmd', '/k', bannerCmd]
    };
  }

  return { ok: false, unsupported: true };
}
