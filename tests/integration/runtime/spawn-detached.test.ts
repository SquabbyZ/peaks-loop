import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatchDetached } from '../../../packages/peaks-loop-internal-runtime/src/index';

describe('spawn detached mock vendor', () => {
  it('writes pid file, log file path placeholder, status.json, owner-session', async () => {
    const root = join(tmpdir(), `dt-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    const runtimeDir = join(root, 'runtime');
    const subAgentsDir = join(root, 'subagents');
    mkdirSync(runtimeDir, { recursive: true });
    mkdirSync(subAgentsDir, { recursive: true });

    const r = await dispatchDetached({
      sid: 's1', rid: 'r-det-1', role: 'rd',
      vendor: 'claude', userTask: 'echo hi',
      files: [], refs: [],
      runtimeDir, subAgentsDir,
    });
    expect(existsSync(join(runtimeDir, 'r-det-1', 'pid'))).toBe(true);
    expect(existsSync(join(runtimeDir, 'r-det-1', 'owner-session'))).toBe(true);
    expect(existsSync(r.dispatchRecordPath)).toBe(true);

    rmSync(root, { recursive: true, force: true });
  }, 15000);
});