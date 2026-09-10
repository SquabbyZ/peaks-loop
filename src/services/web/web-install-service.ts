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
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

import { getErrorMessage } from 'peaks-loop-shared/result';

import { resolveNpxInvocation } from '../lint/npx-resolver.js';
import { isProcessAlive } from './daemon-registry.js';
import { loadPlaywright, PLAYWRIGHT_VERSION_PIN, playwrightVersion } from './playwright-loader.js';
import { webInstallLockPath } from './web-artifact-paths.js';

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

interface InstallLockBody {
  readonly pid: number;
  readonly startedAt: string;
}

/** What the cache says, without downloading anything (tech-doc §5.3). */
export interface BrowserProbe {
  readonly installed: boolean;
  /** The resolved Playwright PACKAGE version, or `null` when the package is absent. */
  readonly version: string | null;
  readonly executablePath: string | null;
}

export interface InstallOutcome {
  readonly ok: boolean;
  /** `''` on success, otherwise `WEB_INSTALL_BUSY` | `WEB_INSTALL_FAILED` | `WEB_INSTALL_TIMEOUT`. */
  readonly code: string;
  readonly message: string;
  /** The size warning whenever this call actually ran the installer. */
  readonly warnings: readonly string[];
}

/**
 * `PEAKS_WEB_DISABLED=1`, and nothing else. `'0'`, `'true'`, `''` and `'1 '`
 * are all "not disabled" — the flag is an explicit opt-out, so a typo must fail
 * towards the local browser rather than silently skipping it.
 */
export function isWebDisabled(env: NodeJS.ProcessEnv): boolean {
  return env['PEAKS_WEB_DISABLED'] === '1';
}

/**
 * Is the pinned browser on disk? Never throws, never spawns, never downloads.
 *
 * **It answers about the artifact `launch()` starts** (R6). `executablePath()`
 * names the `chromium` build, but `chromium.launch()` with no options and
 * `headless` defaulting true resolves `chromium-headless-shell`
 * (`registry.getExecutableName`) — a SEPARATE ~271 MiB download. Probing the
 * full chromium therefore answered "installed" for a machine on which no op
 * could launch: `launch()` failed, S1's net downloaded, the probe kept saying
 * installed, and `peaks web install` short-circuited to a no-op success. See
 * `headlessShellDir` for how the right path is obtained.
 *
 * `version` is reported even when the executable is missing, because "the
 * package is cached but its browser is not" is a different diagnosis from
 * "nothing is installed" — the first is one `peaks web install` away.
 */
export async function probeBrowserInstalled(): Promise<BrowserProbe> {
  const version = await playwrightVersion();
  if (version === null) {
    return { installed: false, version: null, executablePath: null };
  }
  try {
    const chromiumPath = (await loadPlaywright()).chromium.executablePath();
    const shellDir = headlessShellDir(chromiumPath);
    if (shellDir === null) {
      // Not a registry shape we recognise: answer about the path Playwright
      // handed us, exactly as this probe did before R6, rather than about a
      // directory we invented.
      return { installed: existsSync(chromiumPath), version, executablePath: chromiumPath };
    }
    // Absent is the answer, and the whole point: `null` here is what steers
    // `peaks web install` to download and `acquireChromium` to refuse.
    const executablePath = headlessShellExecutable(shellDir);
    return { installed: executablePath !== null, version, executablePath };
  } catch {
    // The package resolved but would not load — a broken cache, not a download.
    return { installed: false, version, executablePath: null };
  }
}

/**
 * The `chromium_headless_shell-<rev>` directory that sits beside
 * `chromiumExecutablePath`'s own revision directory, or `null` when the path is
 * not shaped like Playwright's registry.
 *
 * Playwright's public API cannot name the shell — `BrowserType.executablePath()`
 * takes no options and always answers with the `chromium` build — so it is
 * derived from the one path Playwright does hand out. One naming rule is
 * assumed, and it is the one the cache itself shows: `<rev>` directories are
 * named after the browser, `chromium-1243` beside `chromium_headless_shell-1243`.
 */
function headlessShellDir(chromiumExecutablePath: string): string | null {
  const segments = chromiumExecutablePath.split(/[\\/]/);
  let revision = -1;
  for (let i = segments.length - 1; i > 0; i -= 1) {
    if (/^chromium-\d+$/.test(segments[i] ?? '')) {
      revision = i;
      break;
    }
  }
  const revisionDir = segments[revision];
  if (revision <= 0 || revisionDir === undefined) {
    return null;
  }
  return join(
    segments.slice(0, revision).join(sep),
    revisionDir.replace('chromium-', 'chromium_headless_shell-')
  );
}

/**
 * The shell executable inside `shellDir`, or `null`.
 *
 * The shell's own platform directory is deliberately NOT assumed — it is
 * `chrome-headless-shell-<platform>` where chromium's is `chrome-<platform>` —
 * so the file is looked for rather than named from a copy of Playwright's
 * per-platform path table.
 */
function headlessShellExecutable(shellDir: string): string | null {
  for (const entry of safeReaddir(shellDir)) {
    const platformDir = join(shellDir, entry);
    for (const file of safeReaddir(platformDir)) {
      if (/^chrome-headless-shell(\.exe)?$/.test(file)) {
        return join(platformDir, file);
      }
    }
  }
  return null;
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    // Absent is the normal case on a machine that never installed the shell.
    return [];
  }
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
    body !== null && isProcessAlive(body.pid) && Date.now() - Date.parse(body.startedAt) <= INSTALL_LOCK_STALE_MS
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
export async function installChromium(options: { readonly force?: boolean } = {}): Promise<InstallOutcome> {
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
  const code = (error as NodeJS.ErrnoException).code === 'ETIMEDOUT' ? 'WEB_INSTALL_TIMEOUT' : 'WEB_INSTALL_FAILED';
  return failure(code, `\`playwright install chromium\` did not complete: ${error.message}`);
}

function failure(code: string, message: string): InstallOutcome {
  return { ok: false, code, message, warnings: [] };
}

function tryCreateInstallLock(target: string): boolean {
  const body: InstallLockBody = { pid: process.pid, startedAt: new Date().toISOString() };
  try {
    writeFileSync(target, JSON.stringify(body), { flag: 'wx', encoding: 'utf8', mode: LOCK_FILE_MODE });
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
