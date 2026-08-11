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
      spawnOpts.windowsHide = true;
    }

    const child = nodeSpawn(binary, args, spawnOpts);
    const dir = join(this.cfg.runtimeDir, opts.rid);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'pid'), String(child.pid ?? ''));

    return {
      pid: child.pid ?? -1,
      child,
      kill: (signal: NodeJS.Signals = 'SIGTERM') => child.kill(signal),
    };
  }
}