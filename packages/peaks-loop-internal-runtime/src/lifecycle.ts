import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface ActiveRecord { pid: number; rid: string; ownerSession: string; }

export class LifecycleOwner {
  private active = new Map<string, ActiveRecord>();

  constructor(private readonly runtimeDir: string) {}

  register(pid: number, rid: string, ownerSession: string): void {
    this.active.set(rid, { pid, rid, ownerSession });
  }

  async markExit(rid: string, code: number, signal?: string): Promise<void> {
    const dir = join(this.runtimeDir, rid);
    if (!existsSync(dir)) return;
    const exit = { code, signal, at: Date.now() };
    writeFileSync(join(dir, 'exit.json'), JSON.stringify(exit));

    // Archive
    if (existsSync(join(dir, 'log.txt'))) renameSync(join(dir, 'log.txt'), join(dir, 'log-archive.txt'));
    if (existsSync(join(dir, 'status.json'))) renameSync(join(dir, 'status.json'), join(dir, 'status-final.json'));

    // Delete active markers
    for (const f of ['pid', 'owner-session']) {
      const p = join(dir, f);
      if (existsSync(p)) rmSync(p);
    }
    this.active.delete(rid);
  }

  async reap(currentSessionId: string): Promise<string[]> {
    const orphans: string[] = [];
    for (const rec of this.active.values()) {
      if (rec.ownerSession !== currentSessionId) orphans.push(rec.rid);
    }
    return orphans; // user decides via `peaks sub-agent cleanup --orphan`
  }
}