import { spawn as nodeSpawn, ChildProcess } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface SpawnOpts {
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
    const spawnOpts: any = {
      detached: opts.detach,
      stdio: opts.stdio ?? 'pipe',
    };
    if (isWin) {
      spawnOpts.windowsHide = true;
      // CREATE_NEW_PROCESS_GROUP = 0x00000200, DETACHED_PROCESS = 0x00000008
      spawnOpts.detached = true;
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