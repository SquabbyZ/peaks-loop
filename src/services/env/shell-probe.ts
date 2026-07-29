/**
 * Slice 2026-07-29-dispatch-stall-governance / S6 — typed shell probe.
 *
 * Codifies the prose-only red rule recorded in
 * .peaks/memory/2026-07-27-windows-shell-pref.md: on Windows, a
 * sub-agent must probe `which bash` and prefer Git Bash; an
 * unavailable bash must surface as an explicit `ShellProbeReport`
 * (with `available: false` + a `reason`), not as a silent fallback
 * to PowerShell.
 *
 * Pre-S6, the rule was *only* documented in `.peaks/memory/`; nothing
 * in the code path enforced it, so a sub-agent could silently land on
 * PowerShell, emit a bash-syntax command, and hang on a parser error —
 * which the orchestrator would observe as a stall (PRD §1.6).
 *
 * Public surface:
 *   - `probeShell(opts)` → `Promise<ShellProbeReport>`
 *   - `ShellProbeReport` (typed, JSON-serializable)
 *   - `ShellProbeRunner` (test seam: inject a fake runner)
 *
 * The probe is **lazy**: it only spawns a process when the caller
 * actually invokes `probeShell`. Calling `formatTestToolDetection()`
 * or any other dispatch hot path does NOT trigger a shell probe. The
 * probe is opt-in at the dispatch / tool boundary; we do NOT
 * broadcast-probe every dispatch (that would add a 50–200ms hit to
 * the hot path).
 *
 * On non-Windows platforms the probe is a passthrough: `available:
 * true`, `shell: 'bash'`, `reason: 'non-windows passthrough'`. Linux
 * and macOS hosts already have a usable shell, so the Windows-only
 * Git-Bash probe is unnecessary.
 */
import { spawn } from 'node:child_process';

export type ShellKind = 'bash' | 'pwsh' | 'powershell' | 'cmd' | 'unknown';

export interface ShellProbeReport {
  /** Whether a usable bash was located. `false` ⇒ caller MUST NOT silently fall back to PowerShell. */
  readonly available: boolean;
  /** The recommended shell command name. `'bash'` on success, `'pwsh'` / `'powershell'` only as an explicit non-silent fallback (with available=false). */
  readonly shell: ShellKind;
  /** Absolute path to the resolved binary, when found. `null` otherwise. */
  readonly path: string | null;
  /**
   * Why the probe returned what it returned. Always populated —
   * `null` reasons are forbidden. `'unavailable'` carries a single-
   * line explanation the orchestrator can render to the user.
   */
  readonly reason: string;
  /** Wall-clock duration of the probe (ms). Useful for the dispatch envelope's `notes[]`. */
  readonly elapsedMs: number;
  /** Probe platform — `win32` triggers the Git-Bash preference. */
  readonly platform: NodeJS.Platform;
}

export interface ShellProbeOptions {
  /**
   * Override `process.platform`. Tests use this to simulate Windows
   * hosts on Linux CI (and vice versa) without mutating process.
   */
  readonly platform?: NodeJS.Platform;
  /**
   * Override the runner that performs the `which bash` / `where
   * bash` probe. The default delegates to `child_process.spawn`; the
   * test seam injects a fake.
   */
  readonly runner?: ShellProbeRunner;
  /**
   * Override the process env. Default: process.env.
   */
  readonly env?: NodeJS.ProcessEnv;
  /**
   * Probe timeout (ms). Default: 3000. A sub-agent that hangs the
   * probe would itself be a stall; bounded so the call site fails
   * fast and the orchestrator can surface `available: false`.
   */
  readonly timeoutMs?: number;
  /**
   * Wall clock for tests.
   */
  readonly now?: () => number;
  /**
   * Test seam: override the literal-path probe. The default
   * delegates to `node:fs#existsSync`; the test seam injects a
   * fake so the Windows-no-bash scenario can be exercised on a
   * host that has Git Bash installed (and vice versa).
   */
  readonly probeFile?: (absPath: string) => Promise<boolean> | boolean;
}

export interface ShellProbeRunner {
  /**
   * Run a command. Returns the captured stdout on success and
   * throws (or returns `null`) on failure. The probe treats
   * `null`-returns the same as thrown errors.
   */
  run(command: string, args: readonly string[], opts: { timeoutMs: number }): Promise<{ stdout: string } | null>;
}

const DEFAULT_TIMEOUT_MS = 3_000;

/** Default runner: child_process.spawn, with a 3s ceiling. */
const defaultRunner: ShellProbeRunner = {
  async run(command, args, opts) {
    return await new Promise((resolveRun) => {
      let resolved = false;
      const finish = (value: { stdout: string } | null): void => {
        if (resolved) return;
        resolved = true;
        resolveRun(value);
      };
      try {
        const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        child.stdout?.on('data', (chunk) => {
          stdout += chunk.toString('utf8');
        });
        child.on('error', () => finish(null));
        child.on('close', (code) => {
          if (code === 0 && stdout.trim().length > 0) {
            finish({ stdout });
          } else {
            finish(null);
          }
        });
        const t = setTimeout(() => {
          child.kill();
          finish(null);
        }, opts.timeoutMs);
        t.unref?.();
      } catch {
        finish(null);
      }
    });
  }
};

/**
 * Probe the host shell. The returned report is the single source of
 * truth: callers MUST surface `reason` when `available: false` rather
 * than silently falling back to PowerShell.
 */
export async function probeShell(options: ShellProbeOptions = {}): Promise<ShellProbeReport> {
  const platform = options.platform ?? process.platform;
  const runner = options.runner ?? defaultRunner;
  const env = options.env ?? process.env;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = options.now ?? (() => Date.now());
  const probeFileFn = options.probeFile ?? defaultProbeFile;
  const startedAt = now();

  if (platform !== 'win32') {
    return {
      available: true,
      shell: 'bash',
      path: '/bin/bash',
      reason: 'non-windows passthrough',
      elapsedMs: now() - startedAt,
      platform
    };
  }

  // 1. Prefer Git Bash explicitly. Git for Windows installs at
  //    `C:\Program Files\Git\bin\bash.exe` (or `C:\nvm4w\nodejs\git-
  //    bash.exe` on the nvm4w layout). The env var `PEAKS_GIT_BASH`
  //    lets an operator pin a non-default path without code change.
  const pinnedGitBash = env.PEAKS_GIT_BASH;
  const gitBashCandidates: readonly string[] = pinnedGitBash
    ? [pinnedGitBash]
    : [
        'C:\\Program Files\\Git\\bin\\bash.exe',
        'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
        'C:\\nvm4w\\nodejs\\git-bash.exe',
        'C:\\Program Files\\Git\\usr\\bin\\bash.exe'
      ];
  for (const candidate of gitBashCandidates) {
    if (await probeFileFn(candidate)) {
      return {
        available: true,
        shell: 'bash',
        path: candidate,
        reason: 'Git Bash located at pinned or default path',
        elapsedMs: now() - startedAt,
        platform
      };
    }
  }

  // 2. Fall back to PATH lookup (`where bash` on Windows). This
  //    catches portable Git installs that land in a non-default
  //    directory.
  const where = await runner.run('where', ['bash'], { timeoutMs });
  if (where !== null && where.stdout.trim().length > 0) {
    const first = where.stdout.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0);
    if (first !== undefined) {
      return {
        available: true,
        shell: 'bash',
        path: first,
        reason: 'bash located via `where bash` (PATH lookup)',
        elapsedMs: now() - startedAt,
        platform
      };
    }
  }

  // 3. Explicit unavailable report — the orchestrator MUST surface
  //    this rather than silently falling back to PowerShell.
  return {
    available: false,
    shell: 'unknown',
    path: null,
    reason:
      'No bash found on this Windows host. Install Git for Windows ' +
      '(https://git-scm.com/download/win) or set PEAKS_GIT_BASH to the ' +
      'absolute path of a bash.exe binary. Per .peaks/memory/2026-07-27-' +
      'windows-shell-pref.md, PowerShell is NOT a silent fallback.',
    elapsedMs: now() - startedAt,
    platform
  };
}

/**
 * Default literal-path probe. Uses Node's `fs.existsSync` (a single
 * stat call, no spawn). Tests inject a custom `probeFile` through
 * `ShellProbeOptions.probeFile` to simulate a no-bash Windows host
 * without needing a host-specific override.
 */
async function defaultProbeFile(absPath: string): Promise<boolean> {
  const { existsSync } = await import('node:fs');
  return existsSync(absPath);
}