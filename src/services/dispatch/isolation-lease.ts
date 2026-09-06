import { spawn as childProcessSpawn } from 'node:child_process';

/**
 * Part 2.C (slice 2026-07-29-worktree-l2-extended) — spawn a worktree
 * lease by shelling out to `peaks worktree spawn` (avoid re-implementing
 * the lease-write + git-worktree-add sequence in this file). The CLI
 * does the lease write, the git worktree add, AND the error handling;
 * we just parse the JSON envelope and surface the leaseId + path.
 *
 * Throws on spawn failure; the caller converts the error to a
 * ISOLATION_SPAWN_FAILED envelope. Synchronous wait is acceptable: the
 * dispatch is already async, the lease is a few hundred ms of FS work,
 * and we need the leaseId before we build the dispatch record.
 */
export function spawnWorktreeLease(args: {
  projectRoot: string;
  sessionId: string;
  rid: string;
  role: string;
  purpose: string;
}): Promise<{ leaseId: string; path: string; branch: string; expiresAt: number }> {
  return new Promise((resolve, reject) => {
    const child = childProcessSpawn(process.execPath, [
      // The compiled CLI lives in dist/cli/peaks.js. We pass the entry
      // through node so the test suite (which also runs on the same
      // process) and the production binary share the same path. When
      // the binary is invoked as `peaks`, the package bin stub does
      // this for us; here we explicitly use process.execPath + the
      // resolved entry to avoid PATH surprises.
      process.argv[1] ?? '',
      'worktree', 'spawn',
      '--rid', args.rid,
      '--role', args.role,
      '--purpose', args.purpose,
      '--project', args.projectRoot,
      '--session', args.sessionId,
      '--json'
    ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: true });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
    child.on('error', (err) => reject(new Error(`worktree spawn subprocess failed: ${err.message}`)));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`peaks worktree spawn exited ${code}; stderr: ${stderr.trim() || '(empty)'}`));
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(stdout);
      } catch (err) {
        reject(new Error(`peaks worktree spawn produced unparseable JSON: ${(err as Error).message}; stdout: ${stdout.slice(0, 400)}`));
        return;
      }
      if (typeof parsed !== 'object' || parsed === null) {
        reject(new Error('peaks worktree spawn envelope is not an object'));
        return;
      }
      const env = parsed as { ok?: boolean; data?: { lease?: { leaseId: string; path: string; branch: string; expiresAt: number } } };
      if (env.ok !== true || !env.data?.lease) {
        reject(new Error(`peaks worktree spawn envelope missing lease; got: ${stdout.slice(0, 200)}`));
        return;
      }
      resolve({
        leaseId: env.data.lease.leaseId,
        path: env.data.lease.path,
        branch: env.data.lease.branch,
        expiresAt: env.data.lease.expiresAt
      });
      // Part 47: unref via setImmediate so the close handler
      // finishes first and Node's stdio 'end' events drain the
      // stdout/stderr buffers before the parent releases the
      // child handle. Without this microtask defer, the unref
      // races the buffered stdout close and the test receives
      // an empty JSON envelope.
      setImmediate(() => { child.unref(); });
    });
  });
}

/**
 * Slice 2026-07-29-worktree-l2-extended Part 12: container
 * isolation bridge. Shells out to `peaks container spawn` to
 * run `docker run` + write the container lease. Returns the
 * leaseId the dispatch record needs to persist. The shape is
 * a subset of the spawnWorktreeLease return (just leaseId);
 * we do not need the path/branch/expiresAt for the container
 * path because the envelope surfaces a different set of
 * fields (image + containerId; see container-lease.ts).
 */
export function spawnContainerLease(args: {
  projectRoot: string;
  sessionId: string;
  rid: string;
  role: string;
  purpose: string;
}): Promise<{ leaseId: string }> {
  return new Promise((resolve, reject) => {
    const child = childProcessSpawn(process.execPath, [
      process.argv[1] ?? '',
      'container', 'spawn',
      '--rid', args.rid,
      '--role', args.role,
      '--purpose', args.purpose,
      '--project', args.projectRoot,
      '--session', args.sessionId,
      '--json'
    ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
    child.on('error', (err) => reject(new Error(`container spawn subprocess failed: ${err.message}`)));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`peaks container spawn exited ${code}; stderr: ${stderr.trim() || '(empty)'}`));
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(stdout);
      } catch (err) {
        reject(new Error(`peaks container spawn produced unparseable JSON: ${(err as Error).message}; stdout: ${stdout.slice(0, 400)}`));
        return;
      }
      if (typeof parsed !== 'object' || parsed === null) {
        reject(new Error('peaks container spawn envelope is not an object'));
        return;
      }
      const env = parsed as { ok?: boolean; data?: { lease?: { leaseId: string } } };
      if (env.ok !== true || !env.data?.lease) {
        reject(new Error(`peaks container spawn envelope missing lease; got: ${stdout.slice(0, 200)}`));
        return;
      }
      resolve({ leaseId: env.data.lease.leaseId });
    });
    // See spawnWorktreeLease above for the rationale.
    child.unref();
  });
}
