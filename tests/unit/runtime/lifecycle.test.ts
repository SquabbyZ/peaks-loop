import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LifecycleOwner } from '../../../packages/peaks-loop-internal-runtime/src/lifecycle';

describe('LifecycleOwner closure', () => {
  let dir: string;
  let lo: LifecycleOwner;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lo-'));
    lo = new LifecycleOwner(dir);
  });

  it('removes pid/log/status/owner-session on normal exit', async () => {
    const rid = 'r1';
    const detDir = join(dir, rid);
    mkdirSync(detDir, { recursive: true });
    writeFileSync(join(detDir, 'pid'), '1234');
    writeFileSync(join(detDir, 'log.txt'), 'log');
    writeFileSync(join(detDir, 'status.json'), '{}');
    writeFileSync(join(detDir, 'owner-session'), 'sid-1');
    lo.register(1234, rid, 'sid-1');

    await lo.markExit(rid, 0);

    const residual = readdirSync(detDir).filter(f =>
      ['pid', 'log.txt', 'status.json', 'owner-session'].includes(f),
    );
    expect(residual).toEqual([]);
  });

  it('archives log and status on normal exit (not delete)', async () => {
    const rid = 'r1';
    const detDir = join(dir, rid);
    mkdirSync(detDir, { recursive: true });
    writeFileSync(join(detDir, 'pid'), '1234');
    writeFileSync(join(detDir, 'log.txt'), 'x');
    writeFileSync(join(detDir, 'status.json'), 'x');
    writeFileSync(join(detDir, 'owner-session'), 'sid');
    lo.register(1234, rid, 'sid');

    await lo.markExit(rid, 0);

    expect(existsSync(join(detDir, 'log-archive.txt'))).toBe(true);
    expect(existsSync(join(detDir, 'status-final.json'))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});