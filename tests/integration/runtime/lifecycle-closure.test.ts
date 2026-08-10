import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, readdirSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LifecycleOwner } from '../../../packages/peaks-loop-internal-runtime/src/index';

describe('Lifecycle closure invariant', () => {
  it('removes pid/log/status/owner-session on success', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clo-'));
    const lo = new LifecycleOwner(dir);
    const rid = 'rClo';
    mkdirSync(join(dir, rid), { recursive: true });
    writeFileSync(join(dir, rid, 'pid'), '1');
    writeFileSync(join(dir, rid, 'log.txt'), 'x');
    writeFileSync(join(dir, rid, 'status.json'), '{}');
    writeFileSync(join(dir, rid, 'owner-session'), 's');
    lo.register(1, rid, 's');
    await lo.markExit(rid, 0);
    const active = ['pid', 'log.txt', 'status.json', 'owner-session']
      .filter(f => existsSync(join(dir, rid, f)));
    expect(active).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('archives log and status (does not lose data)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clo-'));
    const lo = new LifecycleOwner(dir);
    const rid = 'rClo2';
    mkdirSync(join(dir, rid), { recursive: true });
    writeFileSync(join(dir, rid, 'pid'), '1');
    writeFileSync(join(dir, rid, 'log.txt'), 'A');
    writeFileSync(join(dir, rid, 'status.json'), '{}');
    writeFileSync(join(dir, rid, 'owner-session'), 's');
    lo.register(1, rid, 's');
    await lo.markExit(rid, 0);
    expect(existsSync(join(dir, rid, 'log-archive.txt'))).toBe(true);
    expect(existsSync(join(dir, rid, 'status-final.json'))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});