/**
 * Best-effort close of a spawned `peaks progress watch`
 * window. Used by `peaks progress close` (manual escape
 * hatch) and by the watch-side auto-exit when the sub-agent
 * hits a terminal phase.
 *
 * The close is best-effort by design: we never throw from
 * individual signals. One failed close primitive is a UX
 * paper cut, not a correctness bug — the caller still clears
 * the spawn record after this returns.
 *
 * Cross-platform strategy:
 *
 *   - macOS: pkill the watch process by command pattern
 *     (matches the project path, so we never close the
 *     wrong window), then send AppleScript to Terminal.app
 *     to close the window by `custom title`. Terminal.app
 *     is the dominant macOS terminal, and `custom title` is
 *     the only stable identifier we can target from outside
 *     the running shell.
 *   - Linux: pkill the watch process, then try `wmctrl -c
 *     peaks-cli-progress` to close the terminal window by
 *     WM class (set in `progress start` for alacritty /
 *     kitty; gnome-terminal / konsole / xfce4-terminal
 *     close on their own when the child exits). wmctrl is
 *     not always installed; we silently no-op on
 *     "command not found" (exit 127) and surface other
 *     errors as warnings.
 *   - Windows: `taskkill /F /FI "WINDOWTITLE eq
 *     peaks-cli:*"` to kill the cmd.exe wrapper. We use
 *     the title prefix because the exact title includes the
 *     `--reason` suffix which we do not know here.
 *
 * The kill is intentionally not a single primitive (e.g.
 * `process.kill(-pid, 'SIGTERM')` on the process group).
 * The launcher's PID is the spawn-time PID (osascript on
 * macOS, gnome-terminal on Linux), not the long-lived
 * watch process — and the long-lived process is the one we
 * actually need to terminate to make the terminal close.
 * Targeting by command pattern (pkill) + window title
 * (AppleScript / wmctrl / taskkill) is more reliable than
 * PID chasing across detached children.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getErrorMessage } from '../cli-helpers.js';
import type { ProgressSpawnRecord } from '../../services/progress/progress-service.js';

const execFileAsync = promisify(execFile);

export type KillSpawnedTerminalResult = {
  /** Each signal that was successfully sent. */
  signals: string[];
  /** Soft failures (e.g. pkill matched no process, wmctrl missing). */
  warnings: string[];
};

export async function killSpawnedTerminal(
  record: ProgressSpawnRecord,
  canonicalProjectRoot: string,
  currentPlatform: NodeJS.Platform
): Promise<KillSpawnedTerminalResult> {
  const signals: string[] = [];
  const warnings: string[] = [];
  // The watch command we spawned, escaped for use as a pkill
  // pattern. We anchor on `progress watch` (NOT `peaks progress
  // watch`) because the actual cmdline is `.../peaks.js progress
  // watch --project /path` — the literal substring
  // `peaks progress watch` does NOT appear in the cmdline
  // (there is a `.js` between `peaks` and `progress`).
  // Anchoring on the verb + the project path is specific
  // enough to not hit any user-owned `progress watch` process
  // for a different project.
  const watchPattern = `progress watch.*--project ${canonicalProjectRoot.replace(/[\\"\s]/g, '\\$&')}`;

  if (currentPlatform === 'darwin') {
    // pkill exit codes: 0 = matched & signalled, 1 = no processes
    // matched (silent miss), 2 = syntax error (warning), 3 = fatal
    // (warning). macOS pkill writes nothing to stderr on a clean
    // miss, so the exit code is the only signal we have.
    await trySignal('pkill', ['-f', watchPattern], signals, 'pkill-watch', warnings, /no.*process/i, new Set([1]));
    // AppleScript to close the Terminal.app window by
    // custom title. We use `every window whose custom title
    // is` so we only close the right tab. AppleScript returns
    // a non-zero exit when the window is already gone, the
    // app is not running, or the title does not match — all
    // of which are silent misses from the user's perspective
    // (the user-facing outcome is identical to the success
    // case: the window is no longer visible). Treat any
    // non-zero exit as silent.
    try {
      const escapedTitle = record.windowTitle.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
      await execFileAsync('osascript', [
        '-e',
        `tell application "Terminal" to close (every window whose custom title is "${escapedTitle}")`
      ]);
      signals.push('osascript-close-window');
    } catch {
      // Silent miss. See comment above.
    }
  } else if (currentPlatform === 'linux') {
    // Same pkill exit code semantics as macOS.
    await trySignal('pkill', ['-f', watchPattern], signals, 'pkill-watch', warnings, /no.*process/i, new Set([1]));
    // wmctrl by WM class (set in `progress start`). Missing
    // wmctrl is silent (exit 127) — most distros ship it but
    // headless / minimal installs do not.
    await trySignal('wmctrl', ['-c', 'peaks-cli-progress'], signals, 'wmctrl-close-class', warnings, /not found|No such file/i, new Set([127]));
  } else if (currentPlatform === 'win32') {
    // Title prefix is set in `progress start` to `peaks-cli:`.
    // We match the prefix because the full title includes
    // the `--reason` suffix which we do not know here.
    // taskkill exit codes: 0 = success, 1 = no tasks matched
    // (silent miss — the window is already gone), 128 = error.
    const titlePrefix = 'peaks-cli:';
    await trySignal('taskkill', ['/F', '/FI', `WINDOWTITLE eq ${titlePrefix}*`], signals, 'taskkill-window-title', warnings, /no.*task/i, new Set([1]));
  } else {
    warnings.push(`unsupported platform: ${currentPlatform}`);
  }
  return { signals, warnings };
}

/**
 * Run a single close primitive. If it throws AND either
 *   (a) the error matches the "expected" stderr pattern
 *       (e.g. "no process matched" for pkill, "command not
 *       found" for wmctrl) — most platforms print this on
 *       stderr; or
 *   (b) the exit code is in `silentMissExitCodes` (pkill 1,
 *       wmctrl 127, taskkill 1) — the primitive ran, found
 *       nothing, and is not telling us via stderr,
 * we silently no-op — that is the success case for the
 * primitive. Other errors are appended to `warnings` for
 * the caller to surface. On a clean resolve, the named
 * signal is appended to `signals`.
 */
async function trySignal(
  command: string,
  args: string[],
  signals: string[],
  signal: string,
  warnings: string[],
  expectedFailurePattern: RegExp,
  silentMissExitCodes: ReadonlySet<number>
): Promise<void> {
  try {
    await execFileAsync(command, args);
  } catch (error) {
    // execFile's error object exposes `code` as either a
    // numeric exit code (when the process ran) or a string
    // system code like 'ENOENT' (when the binary itself
    // is missing). Only numeric exit codes are candidates
    // for silent-miss.
    const execError = error as { code?: number | string };
    if (typeof execError.code === 'number' && silentMissExitCodes.has(execError.code)) {
      // Exit code says "ran, but found nothing to act on".
      // The user-facing outcome is identical to the success
      // case, so do not surface a warning.
      return;
    }
    const message = getErrorMessage(error);
    if (expectedFailurePattern.test(message)) {
      return;
    }
    warnings.push(`${command}: ${message}`);
    return;
  }
  // Reached only if execFile resolves (exit 0). All three
  // primitives exit non-zero on a miss, so a clean resolve
  // means the signal landed.
  signals.push(signal);
}
