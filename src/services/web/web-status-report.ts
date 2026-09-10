/**
 * `peaks web status` — which daemon instances exist for this session, and which
 * of them are still real (slice S2, file 17).
 *
 * The three states are the three states of the loopback protocol (tech-doc
 * §1.3): `live` (pid alive AND `/health` answers), `orphaned` (pid alive,
 * `/health` dead — the daemon was SIGKILLed or wedged mid-startup, R3), `stale`
 * (pid dead — a `daemon.json` left behind by a clean-free crash).
 *
 * This is a diagnosis path and nothing else: it opens no browser, downloads
 * nothing, and never spawns. `peaks web stop` and `peaks web status` are the
 * two verbs that keep working under S3's disable gate for exactly that reason
 * (decision C2) — the gate is READ here (to report the flag) but never applied,
 * and the browser probe it triggers is spawn- and download-free (R6).
 *
 * S3 extends the report with the browser-cache probe (`probeBrowserInstalled`),
 * the `disabled` flag and the single `instance` view; the `instances` half here
 * is S2's AC3/AC6 surface.
 */
import { isProcessAlive, listSessionDaemons } from './daemon-registry.js';
import { WebDaemonClient } from './web-client.js';
import { isWebDisabled, probeBrowserInstalled, type BrowserProbe } from './web-install-service.js';

/**
 * `live` = reachable, `orphaned` = alive but not answering, `stale` = the pid
 * is gone. Only `live` may be reported as usable.
 */
export type WebInstanceState = 'live' | 'orphaned' | 'stale';

export interface WebStatusInstance {
  readonly pid: number;
  readonly port: number;
  readonly state: WebInstanceState;
  readonly startedAt: string;
}

export interface WebStatusReport {
  readonly projectRoot: string;
  readonly sessionId: string;
  /**
   * At most one entry: there is one daemon per `(projectRoot, sessionId)`
   * (design §10.2). It is a list because a leftover record and a live daemon
   * can coexist until the record is reaped.
   */
  readonly instances: readonly WebStatusInstance[];
  /**
   * The same thing, unsugared: `instances[0]` or `null`. AC5's matrix reads
   * `data.instance === null` for a session with no daemon, and `instances: []`
   * is the list — one of the two has to be the caller-visible answer.
   */
  readonly instance: WebStatusInstance | null;
  /** S3: the diagnosis path must be able to say WHY nothing will run. */
  readonly disabled: boolean;
  readonly browser: BrowserProbe;
}

/** Probe this session's daemon records. Never throws: a probe failure is a state, not an error. */
export async function buildStatusReport(
  projectRoot: string,
  sessionId: string
): Promise<WebStatusReport> {
  const instances: WebStatusInstance[] = [];
  for (const info of listSessionDaemons(projectRoot, sessionId)) {
    const alive = isProcessAlive(info.pid);
    // `/health` is probed only for a live pid: a dead pid's port may have been
    // reused by an unrelated listener, and that must not read as our daemon
    // answering.
    const healthy = alive && (await new WebDaemonClient(info).health());
    instances.push({
      pid: info.pid,
      port: info.port,
      startedAt: info.startedAt,
      state: !alive ? 'stale' : healthy ? 'live' : 'orphaned'
    });
  }
  return {
    projectRoot,
    sessionId,
    instances,
    instance: instances[0] ?? null,
    disabled: isWebDisabled(process.env),
    browser: await probeBrowserInstalled()
  };
}
