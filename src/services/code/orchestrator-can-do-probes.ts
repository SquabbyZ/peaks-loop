/**
 * orchestrator-can-do-probes.js — the Q2/Q4 subprocess probes behind
 * `peaks code orchestrator-can-do`.
 *
 * Hoisted verbatim out of `./orchestrator-can-do.ts` (slice c2w1 of
 * `strict-remediation-abc`) so that module keeps only the pure decision side.
 * The names leave this file ONLY through that module's re-export: the CLI shim
 * (`src/cli/commands/code-orchestrator-can-do.ts`) reaches them via
 * `await import('../../services/code/orchestrator-can-do.js')`, and the unit
 * tests import them from the same path, so the surface below must stay
 * reachable from there.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// 2026-09-10 D1: both probes used to spawn a bare `peaks`. On Windows that name
// resolves to a `.cmd` shim, which `execFile` cannot run: it does not apply
// PATHEXT, and Node >= 20 refuses to spawn `.cmd`/`.bat` at all without
// `shell: true` (CVE-2024-27980). So Q2 reported "sub-agent dispatch
// unavailable" and Q4 reported ratio 0 for every slice-spec on Windows —
// phantom blockers produced by the spawn, not by the CLI. Running this tree's
// own CLI entry through `process.execPath` needs no shell and no shim.
import { cliEntryPath, interpreterArgs } from '../web/daemon-supervisor.js';

const execFileAsync = promisify(execFile);

/** Sentinel: no explicit binary was injected, so resolve this tree's own CLI. */
const DEFAULT_PEAKS_BIN = 'peaks';

/**
 * Spawn argv for the peaks CLI. An explicitly injected `peaksBin` (the
 * `--peaks-bin` test seam) is spawned verbatim; the default sentinel resolves
 * to this tree's own CLI entry, interpreted by the running Node.
 */
function peaksSpawn(peaksBin: string): { command: string; args: readonly string[] } {
  if (peaksBin !== DEFAULT_PEAKS_BIN) {
    return { command: peaksBin, args: [] };
  }
  return { command: process.execPath, args: interpreterArgs(cliEntryPath()) };
}

export interface ContextProbe {
  /** 0.0–1.0; ≥0.85 = pre-compact; ≥0.95 = red-line. */
  readonly ratio: number;
  /** Source tag from `peaks code context-now`. */
  readonly source: string;
}

/**
 * Q2: probe `peaks sub-agent dispatch --role rd --help`. Returns
 * true when the subprocess exits 0. Resolves to false on spawn
 * failure or non-zero exit.
 */
export async function probeSubAgentAvailable(
  projectRoot: string,
  peaksBin: string = DEFAULT_PEAKS_BIN
): Promise<boolean> {
  try {
    const { command, args } = peaksSpawn(peaksBin);
    await execFileAsync(command, [...args, 'sub-agent', 'dispatch', '--role', 'rd', '--help'], {
      cwd: projectRoot,
      timeout: 5000,
      windowsHide: true
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Q4: probe `peaks code context-now --json`. Parses the data.ratio
 * field. Falls back to {ratio: 0, source: 'unavailable'} when the
 * subprocess fails or returns malformed JSON.
 */
export async function probeContextRatio(
  projectRoot: string,
  peaksBin: string = DEFAULT_PEAKS_BIN
): Promise<ContextProbe> {
  try {
    const { command, args } = peaksSpawn(peaksBin);
    const { stdout } = await execFileAsync(
      command,
      [...args, 'code', 'context-now', '--project', projectRoot, '--json'],
      {
        cwd: projectRoot,
        timeout: 10000,
        windowsHide: true
      }
    );
    const parsed = JSON.parse(stdout) as { data?: { ratio?: number; source?: string } };
    const ratio = typeof parsed.data?.ratio === 'number' ? parsed.data.ratio : 0;
    const source = typeof parsed.data?.source === 'string' ? parsed.data.source : 'unavailable';
    return { ratio, source };
  } catch {
    return { ratio: 0, source: 'unavailable' };
  }
}
