/**
 * service-shutdown — best-effort kill helper for sub-agent-registered
 * local services.
 *
 * Slice 2026-08-01-subagent-merge-and-e2e (Task 3). The parent session
 * reads `.peaks/_runtime/<sid>/dispatch/<dispatchId>/service-registrations.json`
 * (written by `peaks sub-agent shutdown register --pid <pid> --name <label>`)
 * and calls `killRegisteredServices` BEFORE the merge-back step so a
 * long-lived `vite dev` / mock-API / docker-proxy process started by the
 * sub-agent does not block the merge (file lock, port collision, dirty
 * db, etc).
 *
 * The helper is intentionally minimal:
 *   - pid <= 0 or pid === process.pid → skip (`not-running`).
 *   - win32: `taskkill /T /F /PID <pid>` (force, with subtree).
 *   - POSIX: `kill -TERM <pid>`; on failure escalate to `kill -KILL`.
 *   - any error → `not-running` (best-effort; the parent will retry
 *     merge regardless).
 *
 * All native calls are best-effort and never throw; the orchestrator
 * (merge-back-runner.ts) just records the array of outcomes on the
 * dispatch record's `serviceKill` field (added in Task 7).
 */
import { execFileSync } from 'node:child_process';

export type ServiceRegistration = {
  readonly pid: number;
  readonly name: string;
  readonly url?: string;
};

export type ServiceKillOutcome = {
  readonly pid: number;
  readonly name: string;
  readonly skipped: false;
  readonly signal: 'SIGTERM' | 'SIGKILL' | 'taskkill';
};

export type ServiceKillSkipped = {
  readonly pid: number;
  readonly name: string;
  readonly skipped: true;
  readonly reason: 'not-running';
};

export type ServiceKillResult = ServiceKillOutcome | ServiceKillSkipped;

export function killRegisteredServices(input: {
  readonly registrations: ReadonlyArray<ServiceRegistration>;
  readonly platform?: NodeJS.Platform;
}): ReadonlyArray<ServiceKillResult> {
  const platform = input.platform ?? process.platform;
  return input.registrations.map((reg) => {
    if (reg.pid <= 0 || reg.pid === process.pid) {
      return { pid: reg.pid, name: reg.name, skipped: true, reason: 'not-running' };
    }
    try {
      if (platform === 'win32') {
        execFileSync('taskkill', ['/T', '/F', '/PID', String(reg.pid)], { stdio: 'ignore' });
        return { pid: reg.pid, name: reg.name, skipped: false, signal: 'taskkill' };
      }
      // POSIX: try SIGTERM via the `kill` CLI (universally available);
      // escalate to SIGKILL on failure. The runner is best-effort.
      try {
        execFileSync('kill', ['-TERM', String(reg.pid)], { stdio: 'ignore' });
      } catch {
        execFileSync('kill', ['-KILL', String(reg.pid)], { stdio: 'ignore' });
        return { pid: reg.pid, name: reg.name, skipped: false, signal: 'SIGKILL' };
      }
      return { pid: reg.pid, name: reg.name, skipped: false, signal: 'SIGTERM' };
    } catch {
      return { pid: reg.pid, name: reg.name, skipped: true, reason: 'not-running' };
    }
  });
}