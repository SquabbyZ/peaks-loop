/**
 * Slice 2026-08-12 best-practice-scan — auto-trigger post-step (Slice F).
 *
 * When peaks-prd's request artifact transitions to `handed-off`, this helper
 * extracts the `businessGoal` (first non-empty bullet under `## Goals` of the
 * PRD body) and fires `peaks best-practice-scan --project <root> --intent "<goal>"`
 * as a fire-and-forget post-step. The PRD → handed-off transition is the
 * canonical moment when "businessGoal transitions to complete" (the prd state
 * machine's terminal state).
 *
 * Failure modes (all non-fatal — the prd → handed-off transition MUST NOT
 * block on BPS issues):
 *   - Empty businessGoal        → status: 'skipped-empty-goal' (no spawn)
 *   - Artifact missing           → status: 'skipped-artifact-missing'
 *   - Peaks binary missing       → status: 'skipped-artifact-missing'
 *   - Spawn 'error' event        → status: 'failed' (logged, not thrown)
 *   - Spawn event timeout (5 s)  → status: 'failed' (logged, not thrown)
 *   - Spawn 'spawn' event        → status: 'triggered' (resolved; child detached)
 *
 * Karpathy §1 (Think Before Coding): extracted from the QA verdict
 * `verdict-rid-best-practice-scan-qa-ship.md` AC-1 PARTIAL finding. The
 * `prd:handed-off` transition in `src/cli/commands/request-commands.ts`
 * is the canonical hook point — peaks-prd's contract in
 * `skills/bee/peaks-prd/SKILL.md` §"Step 2.5 sub-step" mandates this firing
 * BEFORE peaks-rd takes over.
 *
 * Karpathy §2 (Simplicity First): single spawn, no retry, no async queue.
 * Karpathy §3 (Surgical Changes): one new file, no other source files
 * touched (the call site wiring in request-commands.ts is the only other
 * edit; that is the "Pattern A: inline post-step" from the dispatch spec).
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { showRequestArtifact } from '../artifacts/request-artifact-service.js';

export type BestPracticeTriggerStatus =
  | 'triggered'
  | 'skipped-empty-goal'
  | 'skipped-artifact-missing'
  | 'failed';

export type BestPracticeTriggerResult = {
  readonly status: BestPracticeTriggerStatus;
  readonly businessGoal?: string;
  readonly pid?: number;
  readonly reason?: string;
};

/** Extract the first non-empty bullet from the `## Goals` section of a PRD
 *  body. Falls back to the `raw input (sanitized):` line at the top when
 *  the Goals section is missing or empty. Returns null when no goal can
 *  be derived (caller should treat as `skipped-empty-goal`).
 *
 *  Pure function — exported separately so unit tests can target the
 *  extraction logic without spawning child processes. */
export function extractBusinessGoal(prdBody: string): string | null {
  const goalsMatch = /##\s+Goals\s*\n([\s\S]*?)(?=\n##\s|\n#\s|\Z)/.exec(prdBody);
  if (goalsMatch !== null && goalsMatch[1] !== undefined) {
    for (const raw of goalsMatch[1].split(/\r?\n/)) {
      const line = raw.replace(/^[\s>*\-]+/, '').trim();
      if (line.length > 0 && line !== '...') return line;
    }
  }
  const rawInputMatch = /^- raw input \(sanitized\):\s*(.+)$/m.exec(prdBody);
  if (rawInputMatch !== null && rawInputMatch[1] !== undefined) {
    const line = rawInputMatch[1].trim();
    if (line.length > 0 && line !== '...') return line;
  }
  return null;
}

/** Fire-and-forget: invoke `peaks best-practice-scan --project <root>
 *  --intent "<businessGoal>"`. Never throws — always resolves with a
 *  BestPracticeTriggerResult envelope. The child is detached via `unref()`
 *  on the 'spawn' event so the parent process is not blocked waiting for
 *  the BPS scan to finish (the scan itself sleeps ~100 ms in the v1
 *  Context7 stub).
 *
 *  `PEAKS_BEST_PRACTICE_STDIN` is forced to empty so the BPS catch-gate
 *  auto-accepts the recommended option — auto-trigger is non-interactive
 *  by design (no user at the prompt when prd → handed-off fires). */
export async function triggerBestPracticeScan(opts: {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly requestId: string;
}): Promise<BestPracticeTriggerResult> {
  const artifact = await showRequestArtifact({
    projectRoot: opts.projectRoot,
    role: 'prd',
    requestId: opts.requestId,
    sessionId: opts.sessionId
  });
  if (artifact === null) {
    return { status: 'skipped-artifact-missing' };
  }
  const businessGoal = extractBusinessGoal(artifact.content);
  if (businessGoal === null) {
    return { status: 'skipped-empty-goal' };
  }
  const peaksBin = join(opts.projectRoot, 'bin', 'peaks.js');
  if (!existsSync(peaksBin)) {
    return { status: 'skipped-artifact-missing', reason: `peaks binary not found at ${peaksBin}` };
  }
  return await new Promise<BestPracticeTriggerResult>((resolveTrigger) => {
    let resolved = false;
    const resolveOnce = (result: BestPracticeTriggerResult): void => {
      if (resolved) return;
      resolved = true;
      resolveTrigger(result);
    };
    const child = spawn(
      process.execPath,
      [
        peaksBin,
        'best-practice-scan',
        '--project',
        opts.projectRoot,
        '--intent',
        businessGoal,
        '--json'
      ],
      {
        cwd: opts.projectRoot,
        stdio: 'ignore',
        detached: true,
        env: { ...process.env, PEAKS_BEST_PRACTICE_STDIN: '' }
      }
    );
    child.once('error', (err: Error) => {
      resolveOnce({ status: 'failed', businessGoal, reason: err.message });
    });
    child.once('spawn', () => {
      if (typeof child.unref === 'function') child.unref();
      resolveOnce({
        status: 'triggered',
        businessGoal,
        pid: typeof child.pid === 'number' ? child.pid : -1
      });
    });
    setTimeout(() => {
      resolveOnce({ status: 'failed', businessGoal, reason: 'spawn event timeout (5s)' });
    }, 5_000).unref();
  });
}