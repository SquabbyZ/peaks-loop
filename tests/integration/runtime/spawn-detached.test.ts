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

    // The vendor CLI is OPTIONAL — this test runs on machines and CI runners
    // where `claude` is not installed, and spawn() reports that asynchronously
    // as an 'error' event. So the contract under test is NOT "claude exists";
    // it is that the failure arrives as a TYPED value on the dispatch envelope.
    // Before the fix it escaped this promise chain as an uncaught exception:
    // every test still reported "passed" and the run exited 1, which is the
    // "looks green, checked nothing" shape this assertion exists to kill.
    if (r.spawnError) {
      expect(r.spawnError.code).toBe('ENOENT');
    } else {
      // The CLI was installed and the child really started.
      expect(r.pid).toBeGreaterThan(0);
    }

    // The record on disk must agree with the outcome instead of claiming a
    // running child that was never spawned.
    const record = JSON.parse(readFileSync(r.dispatchRecordPath, 'utf8'));
    expect(record.status).toBe(r.spawnError ? 'failed' : 'running');

    rmSync(root, { recursive: true, force: true });
  }, 15000);
});