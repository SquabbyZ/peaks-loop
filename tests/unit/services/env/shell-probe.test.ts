/**
 * Slice 2026-07-29-dispatch-stall-governance / S6 — shell probe tests
 * (AC-6.1 / AC-6.2).
 *
 * Verifies the typed `probeShell` service:
 *   - on a Windows host with Git Bash present (path-pinned or PATH
 *     lookup), returns `available: true` with the resolved path
 *   - on a Windows host with no Git Bash, returns `available: false`
 *     with an explicit `reason` (NEVER a silent PowerShell fallback)
 *   - on a non-Windows host, returns the non-Windows passthrough
 *     shape (`available: true`, `shell: 'bash'`)
 *
 * The test uses the injected `ShellProbeRunner`, `probeFile`, and
 * `platform` test seams so it runs on any host (with or without Git
 * Bash installed) without spawning real processes.
 */
import { describe, expect, it } from 'vitest';
import { probeShell, type ShellProbeRunner } from '../../../../src/services/env/shell-probe.js';

const passthroughRunner: ShellProbeRunner = {
  async run() {
    return null;
  }
};

const noBashRunner: ShellProbeRunner = {
  async run() {
    return null;
  }
};

const whereBashRunner: ShellProbeRunner = {
  async run(cmd) {
    if (cmd === 'where') return { stdout: 'C:\\custom\\bash.exe\r\n' };
    return null;
  }
};

// Test seam: simulate "no bash anywhere" on Windows. The literal-path
// candidates all return `false`; the `where bash` runner returns null.
const noBashProbeFile = (_absPath: string): boolean => false;

// Test seam: simulate "bash at the default Git path". Only the
// pinned candidate is found; the runner still returns null so the
// `where bash` step never runs.
const pinnedBashProbeFile = (absPath: string): boolean =>
  absPath === 'C:\\pinned\\bash.exe';

describe('probeShell (slice 2026-07-29-dispatch-stall-governance / S6)', () => {
  it('on non-Windows hosts returns a passthrough (available: true)', async () => {
    const r = await probeShell({
      platform: 'linux',
      runner: noBashRunner
    });
    expect(r.available).toBe(true);
    expect(r.shell).toBe('bash');
    expect(r.platform).toBe('linux');
  });

  it('on Windows with PEAKS_GIT_BASH pinned and present returns the pinned path', async () => {
    const r = await probeShell({
      platform: 'win32',
      runner: passthroughRunner,
      probeFile: pinnedBashProbeFile,
      env: { PEAKS_GIT_BASH: 'C:\\pinned\\bash.exe' }
    });
    expect(r.platform).toBe('win32');
    expect(r.available).toBe(true);
    expect(r.path).toBe('C:\\pinned\\bash.exe');
    expect(r.reason).toContain('pinned');
  });

  it('on Windows with no bash anywhere returns an explicit unavailable report (no silent PowerShell fallback)', async () => {
    const r = await probeShell({
      platform: 'win32',
      runner: noBashRunner,
      probeFile: noBashProbeFile
    });
    expect(r.available).toBe(false);
    expect(r.shell).toBe('unknown');
    expect(r.path).toBeNull();
    // The reason MUST be populated (no null reasons allowed).
    expect(r.reason.length).toBeGreaterThan(0);
    // The reason must explicitly mention the next step (no silent
    // PowerShell fallback per .peaks/memory/2026-07-27-windows-shell-pref.md).
    expect(r.reason.toLowerCase()).toMatch(/not.*fallback|not a.*fallback|no.*silent/);
  });

  it('on Windows with `where bash` returning a path resolves the PATH-discovered bash', async () => {
    const r = await probeShell({
      platform: 'win32',
      runner: whereBashRunner,
      probeFile: noBashProbeFile
    });
    expect(r.available).toBe(true);
    expect(r.shell).toBe('bash');
    expect(r.path).toBe('C:\\custom\\bash.exe');
    expect(r.reason).toContain('PATH');
  });

  it('returns a typed JSON-serializable report (no functions, no circular refs)', async () => {
    const r = await probeShell({ platform: 'linux', runner: noBashRunner });
    // The full round-trip through JSON.stringify / parse must
    // succeed (the orchestrator's watch surface consumes the
    // report as JSON).
    const json = JSON.parse(JSON.stringify(r)) as Record<string, unknown>;
    expect(typeof json.available).toBe('boolean');
    expect(typeof json.shell).toBe('string');
    expect(typeof json.reason).toBe('string');
    expect(typeof json.elapsedMs).toBe('number');
    expect(typeof json.platform).toBe('string');
  });
});