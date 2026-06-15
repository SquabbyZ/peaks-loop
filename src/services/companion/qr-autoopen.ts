/**
 * 2026-06-15-qr-inline-display follow-up: cross-platform helper to open a
 * file path in the user's default application (Preview on macOS, Photos on
 * Windows, xdg-open on Linux).
 *
 * Why a separate helper (not inline in setup-service.ts)?
 *   - Cross-platform behavior is testable in isolation.
 *   - Windows requires the `start "" <path>` invocation with an empty
 *     title placeholder, which is non-obvious; capturing it once here
 *     prevents the bug from recurring in future callers.
 *   - The helper is intentionally fire-and-await: we wait for the `spawn`
 *     event (success) or `error` event (failure) and return a structured
 *     result, so callers can decide how to surface failures (warn, fall
 *     back to printing the path, etc.).
 *
 * Cross-platform reference:
 *   - macOS  : `open <path>` (handles PNG via Preview, default image viewer)
 *   - win32  : `cmd /c start "" <path>` (the empty `""` is a mandatory
 *              window-title placeholder; without it, `start` treats the
 *              path as the title and never opens the file)
 *   - linux  : `xdg-open <path>` (best-effort; if xdg-open is not
 *              installed the OS spawn() will emit an error event)
 *   - other  : returns {ok:false, error: "unsupported platform:<x>"} —
 *              we never throw, since this is best-effort UX in setup.
 *
 * Windows quirk source: see Windows `start` command docs. The empty
 * quotes are documented in the Microsoft command-line reference as the
 * required title parameter when called from a non-interactive shell.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { detectPlatform, type Platform } from '../../shared/platform.js';

export type OpenResult =
  | { ok: true; error: null; pid: number | undefined }
  | { ok: false; error: string; pid?: undefined };

export type OpenOptions = {
  /**
   * Override the platform detection. Defaults to the host platform.
   * Useful for tests and for future runtimes (WSL, Docker, etc.).
   */
  platform?: Platform;
};

/**
 * Open `filePath` in the system's default application. Resolves with a
 * structured result; never throws.
 *
 * The returned promise resolves when one of:
 *   - the child emits `spawn` (success — the OS has accepted the request)
 *   - the child emits `error` (failure — e.g., binary not found, EACCES)
 *   - the synchronous `spawn()` call itself throws (e.g., invalid args);
 *     this is caught and surfaced as `{ok:false, error}`
 */
export function openInDefaultApp(filePath: string, options: OpenOptions = {}): Promise<OpenResult> {
  const platform = options.platform ?? detectPlatform();

  let cmd: string;
  let args: string[];
  let spawnOpts: { detached: boolean; stdio: 'ignore'; shell: false };

  if (platform === 'darwin') {
    cmd = 'open';
    args = [filePath];
    spawnOpts = { detached: true, stdio: 'ignore', shell: false };
  } else if (platform === 'win32') {
    // Windows: `cmd /c start "" <path>`. The empty `""` is the mandatory
    // window-title placeholder. Without it, `start` interprets the path
    // as a title and never opens the file. This is a well-known Windows
    // quirk documented in the cmd /c start reference.
    cmd = 'cmd';
    args = ['/c', 'start', '', filePath];
    // On Windows, `detached: false` matches the codegraph-process-runner
    // pattern (process group semantics differ from POSIX).
    spawnOpts = { detached: false, stdio: 'ignore', shell: false };
  } else if (platform === 'linux') {
    cmd = 'xdg-open';
    args = [filePath];
    spawnOpts = { detached: true, stdio: 'ignore', shell: false };
  } else {
    // Unknown platform (sandboxed env, CI on a non-{darwin,win32,linux}
    // OS, future WSL2/Docker host, etc.) — we never throw, just return a
    // structured failure. Callers can print the path as a fallback.
    return Promise.resolve({ ok: false, error: `unsupported platform: ${platform}` });
  }

  let child: ChildProcess;
  try {
    child = spawn(cmd, args, spawnOpts);
  } catch (err) {
    // Synchronous spawn() failure (e.g., invalid binary path on Windows
    // when cmd.exe is not on PATH). Surface as a structured result.
    return Promise.resolve({ ok: false, error: getErrorMessage(err) });
  }

  // Detach on POSIX so the child survives the parent (Node) exiting.
  // On Windows, detached: false is used; the unref() call is a no-op.
  try {
    child.unref();
  } catch {
    // unref() can throw if the handle is already closed; ignore.
  }

  return new Promise<OpenResult>((resolve) => {
    let settled = false;
    const settle = (result: OpenResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    // 'spawn' fires when the OS has accepted the child launch. For
    // spawn() this is essentially immediate on success.
    child.once('spawn', () => {
      settle({ ok: true, error: null, pid: child.pid });
    });
    // 'error' fires when the binary cannot be launched (ENOENT, EACCES,
    // command not found on Windows). We surface the OS-provided message.
    child.once('error', (err) => {
      settle({ ok: false, error: getErrorMessage(err) });
    });
  });
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'unknown error';
}
