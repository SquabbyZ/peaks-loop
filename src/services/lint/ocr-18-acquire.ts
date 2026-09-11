/**
 * OCR 1.8.x acquisition — the ONE step that is allowed to install the reviewer.
 *
 * ## Why this exists as its own module
 *
 * `detect-ocr-18` is a *read-only probe*, but it used to produce its answer by
 * running `npx --package <pin> -- ocr version`, which INSTALLS the package when
 * it is not already cached. Dogfooding 4.0.38: a window titled `npm i @…`
 * appeared on the user's desktop, opened by a command whose own help text says
 * "Read-only probe". The probe no longer spawns at all (see
 * `detect-ocr-18.ts`); the install it was performing as a side effect lives
 * HERE, where it is explicit, named, and on the human's channel — the same
 * split `peaks web status` (probe) / `peaks web install` (acquire) already
 * uses, and whose discipline this module mirrors rather than reinvents.
 *
 * ## Visibility is the requirement, not a nicety
 *
 * The user's words: *"最起码可以看到进度"* — at minimum the progress must be
 * visible. So the installer's stdio is INHERITED, never piped-and-dropped and
 * never detached: npm's own progress lands on the terminal the caller is
 * already watching. Two consequences, both deliberate:
 *
 *   - **`windowsHide: true` is not the opposite of visibility.** It stops
 *     Windows from allocating a NEW console window; inherited stdio keeps
 *     writing to the console that already exists. The window in the bug report
 *     was *new*; the progress is *inherited*. `detached: true` is deliberately
 *     absent — a silent background install is exactly what was rejected.
 *   - **In `--json` mode the child's STDOUT is dropped** (`'ignore'`) so npm's
 *     output cannot corrupt the JSON envelope `printResult` writes to stdout,
 *     while its STDERR stays inherited — npm puts progress and warnings there,
 *     so the wait is still explained on screen. Human mode inherits both.
 *
 * ## Shell preference — and why this is NOT `resolveHookShell`
 *
 * Order: **Git Bash, then PowerShell, then a plain spawn with no shell.**
 *
 * Slice `4637baa8` pinned the *hook* shell to PowerShell on Windows, and it is
 * still right: a hook fires on every Bash tool call, and MSYS2's bash
 * force-allocates its own console window, so the hook must avoid bash. An
 * ACQUISITION is the opposite case — it runs once, takes seconds, and the user
 * wants to watch it.
 *
 * **The two preferences are not a contradiction waiting to be "reconciled" —
 * they answer two different questions** ("run constantly, be invisible" vs
 * "run once, be visible"). Changing `resolveHookShell` to this order would put
 * a console window back on every tool call; changing this order to match the
 * hook would take away the shell the user explicitly asked for
 * (*"优先使用git bash没有才是powershell"*). Leave both alone.
 *
 * The Git Bash half is NOT re-implemented: `probeShell`
 * (`src/services/env/shell-probe.ts`) already owns the lookup (the
 * `PEAKS_GIT_BASH` pin, the default install paths, the `where bash` PATH
 * sweep) and already refuses to fall back silently. This module adds the
 * PowerShell step and keeps `probeShell`'s refusal visible: the resolution
 * carries a `note` naming the shell that was used and, when it is not the
 * first choice, why it is not. Silently using a different shell is how this
 * confusion started.
 */
import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { getErrorMessage } from 'peaks-loop-shared/result';

import { probeShell, type ShellProbeRunner } from '../env/shell-probe.js';
import { isProcessAlive } from '../web/daemon-registry.js';
import { resolveNpxInvocation } from './npx-resolver.js';
import { OCR_18_PACKAGE } from './ocr-multilang-adapter.js';

/**
 * The network wait, named BEFORE it starts and never skipped silently.
 *
 * The size is not quoted as a figure the way `INSTALL_SIZE_WARNING` quotes
 * chromium's 704 MiB: this package's download size is not measured here, and a
 * guessed number in a warning is worse than no number. What the user needs to
 * know before the block is that this touches the network and is one-time.
 */
export const ACQUIRE_NETWORK_WARNING =
  `fetching ${OCR_18_PACKAGE} from the npm registry (needs network, one time)`;

/**
 * A held lock older than this is reclaimed even if its owner is alive.
 * Deliberately longer than `ACQUIRE_TIMEOUT_MS`, so a timed-out install still
 * owns its lock while it winds down.
 */
const ACQUIRE_LOCK_STALE_MS = 30 * 60_000;

/**
 * A blocking `spawnSync` needs a ceiling or "never hang" is not true. The
 * package is far smaller than chromium, so this is the web installer's 20 min
 * cut down; the child is killed at this point and a partial fetch is recovered
 * by simply running the verb again (npm exec is idempotent).
 */
const ACQUIRE_TIMEOUT_MS = 10 * 60_000;

/** 0600 mirrors the web install lock's reasoning: ours, and nobody else's. */
const LOCK_FILE_MODE = 0o600;

interface AcquireLockBody {
  readonly pid: number;
  readonly startedAt: string;
}

/** Which shell the acquisition runs through, in preference order. */
export type AcquireShellKind = 'bash' | 'powershell' | 'direct';

export interface AcquireShell {
  readonly kind: AcquireShellKind;
  /** Absolute path to the shell, or `null` for `direct` (nothing is spawned). */
  readonly path: string | null;
  /**
   * ALWAYS populated: which shell was chosen, and when it is not the first
   * choice, why. A caller that drops this makes the choice silent again.
   */
  readonly note: string;
}

export interface AcquireOutcome {
  readonly ok: boolean;
  /** `''` on success, else `OCR18_ACQUIRE_BUSY` | `OCR18_ACQUIRE_FAILED` | `OCR18_ACQUIRE_TIMEOUT`. */
  readonly code: string;
  readonly message: string;
  /** Which shell ran it, and whether that was the preferred one. */
  readonly shell: AcquireShell;
  readonly durationMs: number;
  /** `[ACQUIRE_NETWORK_WARNING]` whenever this call actually spawned the installer. */
  readonly warnings: readonly string[];
}

/**
 * `<homedir>/.peaks/ocr/install.lock` — the OCR acquisition lock.
 *
 * MACHINE-GLOBAL, like the web install lock and for the same reason: what it
 * guards is npm's per-user exec cache (`~/.npm/_npx`, `%LOCALAPPDATA%
 * \npm-cache\_npx`), which every project and every session of this user
 * shares. A per-project lock would serialize nothing.
 */
export function ocrAcquireLockPath(): string {
  return join(homedir(), '.peaks', 'ocr', 'install.lock');
}

/**
 * Take the OCR acquire lock (O_EXCL create), reclaiming a STALE one — dead
 * owner, unreadable body, or older than `ACQUIRE_LOCK_STALE_MS`. `false` when
 * another process holds a live lock.
 *
 * Same protocol as `web-install-service.acquireInstallLock`, deliberately
 * including the R15 detail that **the reclaim is a rename, not an unlink**:
 * `O_EXCL` serializes the create only if the removal before it cannot be
 * replayed against a fresh file — `A unlink → A create → B unlink (A's FRESH
 * lock) → B create` leaves both holders. A file can only be moved once, so
 * exactly one reclaimer wins and the create that follows decides.
 *
 * The two copies are not shared because the web module's lock is bound to its
 * own artifact root and this change does not reach into it. If a third
 * acquirer appears, lift the pair into a shared helper with a lock-path
 * parameter rather than writing a third copy.
 */
export function acquireOcrLock(): boolean {
  const target = ocrAcquireLockPath();
  mkdirSync(dirname(target), { recursive: true });
  if (tryCreateLock(target)) {
    return ownsLock(target);
  }
  if (isLiveLock(readLock(target))) {
    return false;
  }
  const claim = `${target}.reclaim-${String(process.pid)}`;
  try {
    renameSync(target, claim);
  } catch {
    // Another reclaimer moved it first (ENOENT), or it cannot be moved.
    return false;
  }
  if (isLiveLock(readLock(claim))) {
    // We moved a lock a racer had just legitimately (re)created: put it back
    // rather than steal a lock its owner is already installing under.
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
    // Already gone; the create below is the decider.
  }
  return tryCreateLock(target) && ownsLock(target);
}

/** Release the OCR acquire lock, but only when this process is its owner. */
export function releaseOcrLock(): void {
  const target = ocrAcquireLockPath();
  const existing = readLock(target);
  // An UNREADABLE body is not proof of ownership, so it is left alone: the
  // worst case is one `ACQUIRE_LOCK_STALE_MS` wait, where unlinking a racer's
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

function isLiveLock(body: AcquireLockBody | null): boolean {
  return body !== null && isProcessAlive(body.pid) && Date.now() - Date.parse(body.startedAt) <= ACQUIRE_LOCK_STALE_MS;
}

function ownsLock(target: string): boolean {
  return readLock(target)?.pid === process.pid;
}

function tryCreateLock(target: string): boolean {
  const body: AcquireLockBody = { pid: process.pid, startedAt: new Date().toISOString() };
  try {
    writeFileSync(target, JSON.stringify(body), { flag: 'wx', encoding: 'utf8', mode: LOCK_FILE_MODE });
    return true;
  } catch {
    // `EEXIST` (held) and any other write failure both mean "not acquired".
    return false;
  }
}

function readLock(target: string): AcquireLockBody | null {
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

export interface ResolveAcquireShellOptions {
  /** Override `process.platform` (tests simulate a host without Git Bash). */
  readonly platform?: NodeJS.Platform;
  /** Override `process.env` (the `PEAKS_GIT_BASH` pin and `SystemRoot` live here). */
  readonly env?: NodeJS.ProcessEnv;
  /**
   * Test seam for BOTH lookups: it answers the Git Bash default paths inside
   * `probeShell` and the PowerShell path below, so one injected map can
   * simulate "Windows with no Git Bash" on a host that has it.
   */
  readonly probeFile?: (absPath: string) => boolean | Promise<boolean>;
  /** Test seam forwarded to `probeShell` for its `where bash` PATH sweep. */
  readonly runner?: ShellProbeRunner;
}

/**
 * Resolve the shell the acquisition runs through: Git Bash → PowerShell →
 * no shell. Never throws, and never returns a shell without a `note`.
 */
export async function resolveAcquireShell(options: ResolveAcquireShellOptions = {}): Promise<AcquireShell> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const probeFile = options.probeFile ?? existsSync;

  const probe = await probeShell({
    platform,
    env,
    probeFile,
    ...(options.runner !== undefined ? { runner: options.runner } : {})
  });
  if (probe.available && probe.path !== null) {
    return { kind: 'bash', path: probe.path, note: `bash: ${probe.path} (${probe.reason})` };
  }

  const powershell = await findPowershell(platform, env, probeFile);
  if (powershell !== null) {
    return {
      kind: 'powershell',
      path: powershell,
      note: `PowerShell: ${powershell} — Git Bash is absent on this host (${probe.reason})`
    };
  }

  return {
    kind: 'direct',
    path: null,
    note: 'no shell: this host has neither Git Bash nor PowerShell, so npx is launched directly'
  };
}

/**
 * The Windows PowerShell that ships with the OS, or `null`.
 *
 * Its location is not searched for on PATH: `%SystemRoot%\System32\
 * WindowsPowerShell\v1.0\powershell.exe` is where Windows has put it since
 * Windows 7, and a PATH that cannot see it is a PATH problem the `direct`
 * branch below already survives.
 */
async function findPowershell(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  probeFile: (absPath: string) => boolean | Promise<boolean>
): Promise<string | null> {
  if (platform !== 'win32') {
    return null;
  }
  const root = env['SystemRoot'] ?? env['windir'] ?? 'C:\\Windows';
  const candidate = join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return (await probeFile(candidate)) ? candidate : null;
}

/**
 * The exact argv of the one-time acquisition. Exported so a unit test can
 * assert the arguments WITHOUT spawning anything — an install is not a test's
 * side effect (same rule as `installCommandLine`).
 *
 * `--yes` is what makes this non-interactive: without it `npx` stops to ask
 * "Ok to proceed?" on a machine that has not cached the package, which is the
 * hang this verb exists to avoid.
 */
export function acquireCommandArgs(): readonly string[] {
  return ['--yes', '--package', OCR_18_PACKAGE, '--', 'ocr', 'version'];
}

/**
 * The same argv as ONE shell line, for the bash / PowerShell branches.
 *
 * Every token is double-quoted, and that is load-bearing rather than
 * cosmetic: a bare `@alibaba-group/…` is PowerShell's array syntax. Every
 * token here is a module constant built from `OCR_18_PACKAGE`, so quoting is
 * sufficient — no token carries a `"`, `\`, `$` or backtick that the two
 * shells would escape differently, and none is caller-supplied.
 */
export function acquireCommandLine(): string {
  return ['npx', ...acquireCommandArgs()].map((token) => `"${token}"`).join(' ');
}

export interface AcquireOcr18Options {
  /** True when the caller prints a JSON envelope to stdout and must not be handed npm's. */
  readonly asJson?: boolean;
  /** Pre-resolved shell. Production callers omit it; tests inject one. */
  readonly shell?: AcquireShell;
}

/**
 * Run the acquisition once, under the lock. Returns an outcome on every path —
 * a held lock, a non-zero exit, a timeout, a thrown spawn — so no caller ever
 * sees an exception from here, and never a silent no-op.
 */
export async function acquireOcr18(options: AcquireOcr18Options = {}): Promise<AcquireOutcome> {
  const startedAt = Date.now();
  const shell = options.shell ?? (await resolveAcquireShell());
  let locked = false;
  try {
    locked = acquireOcrLock();
    if (!locked) {
      return failure(
        'OCR18_ACQUIRE_BUSY',
        'another OCR 1.8.x acquisition is already running on this machine; ' +
          `the lock (${ocrAcquireLockPath()}) prevents a second download — retry once it finishes`,
        shell,
        startedAt
      );
    }
    // R2's discipline, mirrored: name the network wait BEFORE the block, on the
    // channel a human reads, so the pause is never unexplained.
    process.stderr.write(`peaks code-review: ${ACQUIRE_NETWORK_WARNING}\n`);
    const result = runOcrAcquire(shell, options.asJson === true);
    if (result.error !== undefined && result.error !== null) {
      return spawnFailure(result.error, shell, startedAt);
    }
    if (result.status !== 0) {
      return failure(
        'OCR18_ACQUIRE_FAILED',
        `\`npx --package ${OCR_18_PACKAGE} -- ocr version\` exited with status ` +
          `${String(result.status)} (shell: ${shell.kind})`,
        shell,
        startedAt
      );
    }
    return {
      ok: true,
      code: '',
      message: '',
      shell,
      durationMs: Date.now() - startedAt,
      warnings: [ACQUIRE_NETWORK_WARNING]
    };
  } catch (error) {
    return failure('OCR18_ACQUIRE_FAILED', getErrorMessage(error), shell, startedAt);
  } finally {
    // Every path releases, including a thrown spawn — but only if THIS call
    // took the lock; releasing someone else's would let a second install in.
    if (locked) {
      releaseOcrLock();
    }
  }
}

/**
 * One blocking acquisition. See the module docstring for why `stdio` is the
 * visibility switch and why `windowsHide` complements rather than hides it.
 */
function runOcrAcquire(shell: AcquireShell, asJson: boolean): ReturnType<typeof spawnSync> {
  const stdio: SpawnSyncOptions['stdio'] = asJson ? ['ignore', 'ignore', 'inherit'] : 'inherit';
  const options: SpawnSyncOptions = { stdio, timeout: ACQUIRE_TIMEOUT_MS, windowsHide: true };
  if (shell.kind === 'powershell' && shell.path !== null) {
    return spawnSync(shell.path, ['-NoProfile', '-NonInteractive', '-Command', acquireCommandLine()], options);
  }
  if (shell.kind === 'bash' && shell.path !== null) {
    return spawnSync(shell.path, ['-c', acquireCommandLine()], options);
  }
  // No shell at all: bypass the Windows `npx.cmd` shim the way every other
  // spawn in this repo does (see `resolveNpxInvocation`). `shell: true` is NOT
  // an alternative — it concatenates and splits the `--package` argv.
  const invocation = resolveNpxInvocation(acquireCommandArgs());
  return spawnSync(invocation.command, [...invocation.args], { ...options, env: invocation.baseEnv });
}

function spawnFailure(error: Error, shell: AcquireShell, startedAt: number): AcquireOutcome {
  const code = (error as NodeJS.ErrnoException).code === 'ETIMEDOUT' ? 'OCR18_ACQUIRE_TIMEOUT' : 'OCR18_ACQUIRE_FAILED';
  return failure(code, `the acquisition did not complete: ${error.message}`, shell, startedAt);
}

function failure(code: string, message: string, shell: AcquireShell, startedAt: number): AcquireOutcome {
  return { ok: false, code, message, shell, durationMs: Date.now() - startedAt, warnings: [] };
}
