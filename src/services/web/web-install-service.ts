/**
 * Browser acquisition: the disable gate, the cache probe and the one-time
 * chromium install (slice S3, file 18; AC5, R2, R6).
 *
 * Three properties this module owns, all of them testable without a browser:
 *
 *   - **The gate is a value, not a side effect.** `isWebDisabled` reads one env
 *     var and only the exact string `'1'` counts (a truthy `'true'` / `'0'` /
 *     trailing space are all "not disabled"). It is step 1 of the ordered gate
 *     in `browser-acquire.ts` and of the `install` verb, so nothing it guards
 *     can be reached by accident.
 *   - **The probe never downloads and never spawns** (R6, tech-doc §5.3). It
 *     asks the resolved Playwright package where its executable WOULD be and
 *     checks the filesystem: no network, no process, so `peaks web status` — the
 *     diagnosis path — can report cache state on a machine with nothing
 *     installed. We never delete anything in that cache; recovery from a
 *     half-download is delegated to Playwright's own `install --force`
 *     (design §10.1).
 *   - **The install never throws and never hangs** (R2). It returns an outcome
 *     for every path — a held lock, a non-zero exit, a timeout — and it takes
 *     the `install.lock` around the spawn so two callers cannot download 700 MB
 *     each (R6). The lock is released on every path, including a thrown spawn.
 */
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

import { getErrorMessage } from 'peaks-loop-shared/result';

import { resolveNpxInvocation } from '../lint/npx-resolver.js';
import { isProcessAlive } from './daemon-registry.js';
import { PLAYWRIGHT_VERSION_PIN } from './playwright-loader.js';
import { webInstallLockPath } from './web-artifact-paths.js';
import { type InstallLockBody, type InstallOutcome } from './web-install-types.js';

// The probe and the path derivations it reads live in `browser-cache-probe.ts`,
// and the three record shapes in `web-install-types.ts` (wave-3 file-size cap
// split; declarations moved verbatim). `probeBrowserInstalled`, `BrowserProbe`
// and `InstallOutcome` are re-exported here so importers keep resolving them
// from `web-install-service.js` unchanged; `InstallLockBody` was module-private
// and is imported for use only.
export { probeBrowserInstalled } from './browser-cache-probe.js';
export type { BrowserProbe, InstallOutcome } from './web-install-types.js';

/**
 * R2: the size of the one-time download, named so it is never a surprise.
 *
 * Measured, not guessed (perf baseline S3, P6): one install of the pin writes
 * **704 MiB** — `chromium-1243` 433 MiB plus `chromium_headless_shell-1243`
 * 271 MiB. The old "~150–300 MB" was the wire estimate and understated the
 * figure the machine actually pays. Nothing reaps obsolete revisions either, so
 * each pin bump adds another ~700 MiB beside the old one (1.4 GiB held here).
 */
export const INSTALL_SIZE_WARNING = 'downloading chromium (~700 MB on disk, one time)';

/**
 * A held install lock older than this is reclaimed even if its owner is alive.
 *
 * Deliberately long: the whole point of the lock is to prevent a SECOND 700 MB
 * download (R6), and a premature reclaim is exactly that. It must therefore
 * outlast any plausible install — the spawn timeout below is shorter, so a
 * timed-out install still owns its lock while it winds down.
 */
const INSTALL_LOCK_STALE_MS = 30 * 60_000;

/**
 * A blocking `spawnSync` needs a ceiling or "never hang" is not true (R2). The
 * child is killed at this point; a partial download is left on disk and is
 * recovered by `peaks web install --force` (Playwright's own path, R6).
 */
const INSTALL_TIMEOUT_MS = 20 * 60_000;

/** Lock and log are ours; 0600 mirrors the daemon record's reasoning. */
const LOCK_FILE_MODE = 0o600;

/**
 * `PEAKS_WEB_DISABLED=1`, and nothing else. `'0'`, `'true'`, `''` and `'1 '`
 * are all "not disabled" — the flag is an explicit opt-out, so a typo must fail
 * towards the local browser rather than silently skipping it.
 */
export function isWebDisabled(env: NodeJS.ProcessEnv): boolean {
  return env['PEAKS_WEB_DISABLED'] === '1';
}

/**
 * The exact argv of the one-time download (tech-doc §3.3):
 * `npx --yes --package playwright@<pin> -- playwright install chromium`, with
 * `--force` before the browser name for the recovery path.
 *
 * Exported so the exact arguments are asserted by a unit test WITHOUT spawning
 * anything — the download is ~700 MB and must not be a test's side effect.
 */
export function installCommandLine(options: { force?: boolean } = {}): string[] {
  return [
    '--yes',
    '--package',
    `playwright@${PLAYWRIGHT_VERSION_PIN}`,
    '--',
    'playwright',
    'install',
    ...(options.force === true ? ['--force'] : []),
    'chromium'
  ];
}

/**
 * Take the chromium install lock (O_EXCL). `false` when another process holds a
 * live lock; a STALE one — owner pid dead, unreadable body, or older than
 * `INSTALL_LOCK_STALE_MS` — is reclaimed and retried once (R6).
 *
 * **The reclaim is a rename, not an unlink** (R15). `O_EXCL` serializes the
 * *create*, but only if the removal that precedes it cannot be replayed against
 * a fresh file: two callers that both read the same dead-pid body used to
 * interleave as `A unlink → A create → B unlink (A's FRESH lock) → B create`,
 * leaving both holding. `rename` gives the reclaim the same atomicity the
 * create has — a given file can only be moved once, so exactly one reclaimer
 * wins — and the O_EXCL create serializes whatever follows.
 */
export function acquireInstallLock(): boolean {
  const target = webInstallLockPath();
  mkdirSync(dirname(target), { recursive: true });
  if (tryCreateInstallLock(target)) {
    return ownsInstallLock(target);
  }
  const existing = readInstallLock(target);
  if (isLiveInstallLock(existing)) {
    return false;
  }
  const claim = `${target}.reclaim-${String(process.pid)}`;
  try {
    renameSync(target, claim);
  } catch {
    // Another reclaimer moved it first (ENOENT), or it cannot be moved.
    return false;
  }
  if (isLiveInstallLock(readInstallLock(claim))) {
    // We moved a lock a racer had just legitimately (re)created: put it back,
    // rather than steal a lock its owner is already downstairs downloading
    // under.
    try {
      renameSync(claim, target);
    } catch {
      try {
        unlinkSync(claim);
      } catch {
        // Nothing left to clean up.
      }
    }
    return false;
  }
  try {
    unlinkSync(claim);
  } catch {
    // The claimed file is already gone; the create below is the decider.
  }
  return tryCreateInstallLock(target) && ownsInstallLock(target);
}

/** Release the install lock, but only when this process is its owner. */
export function releaseInstallLock(): void {
  const target = webInstallLockPath();
  const existing = readInstallLock(target);
  // An UNREADABLE body is not proof of ownership, so it is left alone: the
  // worst case is one `INSTALL_LOCK_STALE_MS` wait, where unlinking a racer's
  // half-written `wx` create would hand its lock to whoever asked next.
  if (existing === null || existing.pid !== process.pid) {
    return;
  }
  try {
    unlinkSync(target);
  } catch {
    // Already released (or never held).
  }
}

/** Is this body a lock we must not touch — an owner that is alive and in date? */
function isLiveInstallLock(body: InstallLockBody | null): boolean {
  return (
    body !== null &&
    isProcessAlive(body.pid) &&
    Date.now() - Date.parse(body.startedAt) <= INSTALL_LOCK_STALE_MS
  );
}

/** Does the file at `target` still name this process? */
function ownsInstallLock(target: string): boolean {
  return readInstallLock(target)?.pid === process.pid;
}

/**
 * Run `playwright install chromium` once, under the lock. Returns an outcome on
 * every path — a held lock, a non-zero exit, a timeout, a thrown spawn — so a
 * caller never sees an exception from here (R2).
 *
 * **Callers are CLIs, never the daemon** (R3). The spawn below blocks the
 * event loop for the whole download (one real acquisition measured 170 s), so
 * running it inside the daemon starved `/health` — `status` read `orphaned`,
 * `stop` could not prove ownership and left the daemon running — while the CLI
 * gave up at 30 s and reported failure. Acquisition is therefore delegated: the
 * daemon answers the op with the tier-3 envelope and this verb, on the human's
 * channel, performs the download.
 */
export async function installChromium(
  options: { readonly force?: boolean } = {}
): Promise<InstallOutcome> {
  const { force = false } = options;
  let locked = false;
  try {
    locked = acquireInstallLock();
    if (!locked) {
      return failure(
        'WEB_INSTALL_BUSY',
        'another `playwright install chromium` is already running on this machine; ' +
          `the lock (${webInstallLockPath()}) prevents a second download — retry once it finishes`
      );
    }
    // Say the size BEFORE the block, so the wait is explained on the channel a
    // human reads.
    process.stderr.write(`peaks web: ${INSTALL_SIZE_WARNING}\n`);
    const invocation = resolveNpxInvocation(installCommandLine({ force }));
    const result = spawnSync(invocation.command, [...invocation.args], {
      // `ignore`, never `inherit`: the installer's output would otherwise land
      // on the CLI's stdout and break `--json`.
      stdio: 'ignore',
      timeout: INSTALL_TIMEOUT_MS,
      // The one-time download must not pop a console window at the user.
      windowsHide: true
    });
    if (result.error !== undefined) {
      return spawnFailure(result.error);
    }
    if (result.status !== 0) {
      return failure(
        'WEB_INSTALL_FAILED',
        `\`playwright install chromium\` exited with status ${String(result.status)}; ` +
          'a partial download is recovered by `peaks web install --force`'
      );
    }
    return { ok: true, code: '', message: '', warnings: [INSTALL_SIZE_WARNING] };
  } catch (error) {
    return failure('WEB_INSTALL_FAILED', getErrorMessage(error));
  } finally {
    // R6: every path releases, including a thrown spawn — but only if THIS call
    // took the lock; releasing someone else's would let a second download in.
    if (locked) {
      releaseInstallLock();
    }
  }
}

function spawnFailure(error: Error): InstallOutcome {
  const code =
    (error as NodeJS.ErrnoException).code === 'ETIMEDOUT'
      ? 'WEB_INSTALL_TIMEOUT'
      : 'WEB_INSTALL_FAILED';
  return failure(code, `\`playwright install chromium\` did not complete: ${error.message}`);
}

function failure(code: string, message: string): InstallOutcome {
  return { ok: false, code, message, warnings: [] };
}

function tryCreateInstallLock(target: string): boolean {
  const body: InstallLockBody = { pid: process.pid, startedAt: new Date().toISOString() };
  try {
    writeFileSync(target, JSON.stringify(body), {
      flag: 'wx',
      encoding: 'utf8',
      mode: LOCK_FILE_MODE
    });
    return true;
  } catch {
    // `EEXIST` (held) and any other write failure both mean "not acquired".
    return false;
  }
}

function readInstallLock(target: string): InstallLockBody | null {
  try {
    const parsed = JSON.parse(readFileSync(target, 'utf8')) as Record<string, unknown>;
    const { pid, startedAt } = parsed;
    if (typeof pid !== 'number' || typeof startedAt !== 'string') {
      return null;
    }
    return { pid, startedAt };
  } catch {
    return null;
  }
}
