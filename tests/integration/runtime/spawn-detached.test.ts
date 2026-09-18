import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatchDetached } from '../../../packages/peaks-loop-internal-runtime/src/index.js';

describe('spawn detached mock vendor', () => {
  it('writes pid file, log file path placeholder, status.json, owner-session', async () => {
    const root = join(tmpdir(), `dt-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    const runtimeDir = join(root, 'runtime');
    const subAgentsDir = join(root, 'subagents');
    mkdirSync(runtimeDir, { recursive: true });
    mkdirSync(subAgentsDir, { recursive: true });

    const r = await dispatchDetached({
      sid: 's1',
      rid: 'r-det-1',
      role: 'rd',
      vendor: 'claude',
      userTask: 'echo hi',
      files: [],
      refs: [],
      runtimeDir,
      subAgentsDir
    });
    // `owner-session` and the dispatch record are written unconditionally: they
    // record which session owns this rid directory, and what the launch outcome
    // was. Both are true whether or not an OS process started, so they are not
    // branched. The `pid` file is — see below.
    expect(existsSync(join(runtimeDir, 'r-det-1', 'owner-session'))).toBe(true);
    expect(existsSync(r.dispatchRecordPath)).toBe(true);

    // The vendor CLI is OPTIONAL — this test runs on machines and CI runners
    // where `claude` is not installed, and spawn() reports that asynchronously
    // as an 'error' event. So the contract under test is NOT "claude exists";
    // it is that the failure arrives as a TYPED value on the dispatch envelope.
    // Before the fix it escaped this promise chain as an uncaught exception:
    // every test still reported "passed" and the run exited 1, which is the
    // "looks green, checked nothing" shape this assertion exists to kill.
    //
    // `<rid>/pid` exists IFF a real OS process was launched. That is the
    // invariant `ProcessSupervisor.spawn` enforces by writing the file only when
    // `child.pid !== undefined`, so the file is asserted in BOTH directions and
    // sits next to the outcome it is derived from. A failed launch used to write
    // an EMPTY pid file (`String(undefined ?? '')`), and `Number('')` is 0 — a
    // cleanup path doing `kill(Number(read(pid)))` would signal the whole
    // process group. Absence is the encoding that cannot be misread as a pid.
    if (r.spawnError) {
      expect(r.spawnError.code).toBe('ENOENT');
      expect(existsSync(join(runtimeDir, 'r-det-1', 'pid'))).toBe(false);
    } else {
      // The CLI was installed and the child really started.
      expect(r.pid).toBeGreaterThan(0);
      expect(existsSync(join(runtimeDir, 'r-det-1', 'pid'))).toBe(true);
    }

    // The record on disk must agree with the outcome instead of claiming a
    // running child that was never spawned.
    const record = JSON.parse(readFileSync(r.dispatchRecordPath, 'utf8'));
    expect(record.status).toBe(r.spawnError ? 'failed' : 'running');

    rmSync(root, { recursive: true, force: true });
  }, 15000);
});
