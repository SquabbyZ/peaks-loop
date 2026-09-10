/**
 * The `peaks web` daemon process entry (slice S2, file 15).
 *
 * This file IS the process: it is what `spawnDaemon` launches, so it must run
 * under plain `node` (built tree) as well as under `tsx` (source tree). It is
 * deliberately a thin shell — read the environment, start the service, register
 * with the parent, wire the signals. Everything worth testing lives in
 * `web-daemon-service.ts`.
 *
 * stdout and stderr are already redirected to `web/daemon/daemon.log` by
 * `spawnDaemon`, which is why every diagnostic here is a plain stderr write and
 * never a `console.log` to a terminal (tech-doc §7.2 rule 6).
 */
import { getErrorMessage } from 'peaks-loop-shared/result';
import { CLI_VERSION } from 'peaks-loop-shared/version';

import { registerWithParent } from './daemon-supervisor.js';
import { webDir } from './web-artifact-paths.js';
import { startWebDaemon } from './web-daemon-service.js';

function fatal(reason: string): never {
  process.stderr.write(`peaks web daemon: ${reason}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const projectRoot = process.env['PEAKS_WEB_PROJECT_ROOT'] ?? '';
  const sessionId = process.env['PEAKS_WEB_SESSION_ID'] ?? '';
  if (projectRoot === '' || sessionId === '') {
    fatal('PEAKS_WEB_PROJECT_ROOT and PEAKS_WEB_SESSION_ID are both required');
  }
  // The artifact dir is derived, never taken on trust: a mis-set env would make
  // the daemon write outside this session's `web/` tree (AC1), and the failure
  // would surface as a mystery `WEB_PATH_ESCAPE` much later.
  const derivedArtifactDir = webDir(projectRoot, sessionId);
  const declaredArtifactDir = process.env['PEAKS_WEB_ARTIFACT_DIR'] ?? '';
  if (declaredArtifactDir !== derivedArtifactDir) {
    fatal(
      `PEAKS_WEB_ARTIFACT_DIR ${JSON.stringify(declaredArtifactDir)} does not match this session's web dir ${JSON.stringify(derivedArtifactDir)}`
    );
  }

  const daemon = await startWebDaemon({ projectRoot, sessionId, version: CLI_VERSION });
  // Q7: reuse the existing sub-agent shutdown registry, best-effort. Lifetime
  // is register + parent kill + `peaks web stop` — there is no idle-exit.
  registerWithParent(process.pid, process.env['PEAKS_DISPATCH_ID'] ?? 'current');

  let closing = false;
  const shutdown = async (): Promise<void> => {
    if (closing) {
      return;
    }
    closing = true;
    const closed = await daemon.close();
    // Never silent: a dispatch whose `storageState.json` did not persist is
    // silent data loss for S4's login profile, and the daemon's stderr is the
    // only channel that reaches `daemon.log` (R1).
    for (const failure of closed.stateWriteFailures) {
      process.stderr.write(
        `peaks web daemon: could not persist storageState for dispatch ${failure.dispatchId}: ${failure.reason}\n`
      );
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void shutdown();
  });
  process.on('SIGINT', () => {
    void shutdown();
  });
}

main().catch((error: unknown) => {
  fatal(`startup failed: ${getErrorMessage(error)}`);
});
