import { spawn as nodeSpawn, ChildProcess, type SpawnOptions } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface SpawnOpts {
  /**
   * F2 in-shell background subprocess contract: this flag is a no-op
   * retained for backward compat with the pre-F2 public surface.
   * The supervisor always forces `detached: false` so the child runs
   * in the parent's process group (visible to the user's shell) and
   * the parent retains pipe ownership for SIGTERM/SIGKILL control.
   * Pre-F2 callers passing `detach: true` see identical runtime
   * behavior (F2 makes OS-detached detach a no-op, not an error).
   */
  detach: boolean;
  rid: string;
  stdio?: 'pipe' | 'ignore';
}
export interface SpawnHandle {
  pid: number;
  child: ChildProcess;
  kill(signal?: NodeJS.Signals): void;
  /**
   * Resolves once the OS confirms the launch (`'spawn'`) or the launch fails
   * (`'error'`). Never rejects: `null` means the process is running; a launch
   * failure resolves to the otherwise-unhandled ErrnoException (ENOENT when the
   * vendor CLI is not installed). The listener that settles this is attached
   * synchronously in `spawn()` — see the comment there for why no caller can
   * attach one in time.
   */
  settled: Promise<NodeJS.ErrnoException | null>;
}

export class ProcessSupervisor {
  constructor(private readonly cfg: { runtimeDir: string }) {}

  async spawn(binary: string, args: string[], opts: SpawnOpts): Promise<SpawnHandle> {
    const isWin = process.platform === 'win32';
    // F2: in-shell background subprocess. The pre-F2 OS-detached path
    // used the Windows process-group + detached-process flags (and the
    // POSIX session-detach helpers), which spawned a popup PowerShell
    // window detached from the user's shell. The new contract keeps
    // the child in the parent's process group so the user can see
    // what the sub-agent is doing, and the parent owns the stdio
    // pipes for capture + lifecycle control.
    const spawnOpts: SpawnOptions = {
      detached: false,
      stdio: opts.stdio ?? 'pipe',
    };
    if (isWin) {
      // Suppress the popup console window on Windows without changing
      // process group membership. The child is still part of the
      // parent's process group (no Windows process-group detach flag).
      // Deliberately NOT set on POSIX — pinned by
      // `tests/unit/runtime/process-supervisor-in-shell.test.ts` 1a/1b,
      // which assert this platform split by name. The spawn-hygiene guard
      // reads this assignment form; see `collectWindowsHideAssignments`.
      spawnOpts.windowsHide = true;
    }

    const child = nodeSpawn(binary, args, spawnOpts);

    // Attach the 'error' listener in the SAME synchronous turn the child is
    // created, because no caller can do it in time. A missing binary does not
    // throw from spawn(): Node emits it asynchronously as an 'error' event, and
    // an EventEmitter with no 'error' listener re-throws it as a process-level
    // uncaught exception. That emission runs on the nextTick queue, which
    // drains BEFORE the awaiting caller resumes — so the documented caller-side
    // pattern (`await spawn(...); child.on('error', …)`) loses the race by
    // construction, whatever caller writes it. Capturing it here turns the
    // failure into a typed value on `settled` and removes the crash.
    const settled = new Promise<NodeJS.ErrnoException | null>((resolve) => {
      child.on('error', (err: Error) => resolve(err as NodeJS.ErrnoException));
      child.on('spawn', () => resolve(null));
    });

    const dir = join(this.cfg.runtimeDir, opts.rid);
    mkdirSync(dir, { recursive: true });
    // `<rid>/pid` exists IFF a real OS process was launched. `child.pid` is
    // `undefined` until the OS confirms the spawn, so a failed launch used to
    // write `String(undefined ?? '')` — an EMPTY pid file. That is not a
    // cosmetic wart: `Number('')` is `0`, so a cleanup path doing
    // `kill(Number(readFileSync(pid)))` would send its signal to pid 0 (the
    // whole process group), and an existence check for "is something running
    // here" reads `true` for a launch that never happened.
    //
    // Nothing is lost by omitting it: the launch failure is recorded as a
    // VALUE on the dispatch record (`status: 'failed'` + `spawnError`), which
    // is the surface a reader should consult. Absence in the pid file is the
    // one encoding that cannot be misread as a pid.
    if (child.pid !== undefined) {
      writeFileSync(join(dir, 'pid'), String(child.pid));
    }

    return {
      pid: child.pid ?? -1,
      child,
      kill: (signal: NodeJS.Signals = 'SIGTERM') => child.kill(signal),
      settled,
    };
  }
}