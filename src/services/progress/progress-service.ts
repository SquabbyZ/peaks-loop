/**
 * Sub-agent progress file for the RD/QA sub-agents in `peaks-solo`'s
 * Swarm phase. A sub-agent (or the LLM via the `peaks progress step`
 * CLI) writes a stable JSON file at
 * `.peaks/_sub_agents/<sid>/subagent-progress.json`. The dispatch +
 * heartbeat flow (slice #009 + #010) reads this file as the source
 * of truth for "is this sub-agent still alive?".
 *
 * Token cost design (the binding constraint of this feature):
 *   - The LLM side (step CLI) writes the file at most once per
 *     phase transition. That is approximately one Bash call per
 *     RD/QA sub-step. In a typical 5-step sub-agent slice the
 *     cost is < 10 output tokens.
 *   - The dispatch side polls the file via `peaks sub-agent
 *     heartbeat`, not the LLM. Zero token cost.
 *
 * Slice #014: the legacy `peaks progress start|watch|close` auto-spawn
 * surface is DELETED. With dispatch + heartbeat (slice #009 + #010), the
 * same sub-agent now runs in the same IDE/terminal as the main loop, so
 * a separate watch window is dead weight. The only remaining consumer
 * of this module is the `peaks progress step` write path + the
 * dispatcher's read-back of the progress file.
 *
 * This module is pure filesystem. It does NOT import the LLM
 * harness, does NOT spawn terminals, and does NOT talk to any
 * IPC. The dispatch-side consumption is in
 * `src/services/dispatch/sub-agent-dispatcher.ts` and reads the
 * progress file via `subAgentProgressPath`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { getSessionIdCanonical } from '../session/session-manager.js';
import { findProjectRoot } from '../config/config-safety.js';

// As of slice 2026-06-06-sub-agent-spawn-bug-and-decouple, the per-session
// sub-agent state files live under `.peaks/_sub_agents/<sid>/`, NOT under
// `.peaks/_runtime/<sid>/system/`. The new path mirrors the existing `_runtime/`
// and `_dogfood/` convention (leading underscore = meta-classification, not
// a per-session artifact). The previous `<sid>/system/...` locations are
// migrated to the new path on first run of `peaks workspace reconcile
// --apply` (see `migrateSubAgentState` in reconcile-service.ts).
const SUB_AGENTS_DIR = '_sub_agents';
const PROGRESS_FILE_NAME = 'subagent-progress.json';

export type SubAgentProgressPhase = 'starting' | 'running' | 'verifying' | 'completing' | 'finished' | 'failed' | 'idle';

export type SubAgentProgressStep = {
  /** ISO-8601 timestamp at which the sub-agent started. */
  startedAt: string;
  /** ISO-8601 timestamp at which the sub-agent finished (or now, if still running). */
  updatedAt: string;
  /** Free-form human-readable sub-step label, e.g. "running test/ut". */
  step: string;
  /** Current phase bucket. `idle` is the pre-start sentinel. */
  phase: SubAgentProgressPhase;
  /** When set, the sub-agent is finished and reports the verdict here. */
  verdict?: 'pass' | 'return-to-rd' | 'blocked';
  /** Optional count of in-scope files touched, assertions run, etc. */
  counts?: {
    filesTouched?: number;
    testsRun?: number;
  };
};

export type SubAgentProgress = {
  version: 1;
  sessionId: string;
  outerSessionId?: string;
  /** Outer-agent role that owns the slice (e.g. "rd", "qa"). */
  role: string;
  /** Per-slice identifier. */
  requestId: string;
  /** When the sub-agent entered the first non-idle state. */
  startedAt: string;
  /** When the sub-agent last touched the file. */
  updatedAt: string;
  /** Current step. */
  current: SubAgentProgressStep;
  /**
   * History of completed steps. Length is unbounded; the watch
   * tool renders the most recent N. Kept for after-the-fact
   * forensics ("how long did step 3 take?").
   */
  history: SubAgentProgressStep[];
};

export type ReadProgressOptions = {
  projectRoot: string;
};

export type ReadProgressResult =
  | { ok: true; data: SubAgentProgress; path: string }
  | { ok: false; reason: 'no-binding' | 'no-progress-file' | 'invalid-json' };

export type WriteProgressOptions = {
  projectRoot: string;
  requestId: string;
  role: string;
  step: string;
  phase: SubAgentProgressPhase;
  verdict?: 'pass' | 'return-to-rd' | 'blocked';
  counts?: SubAgentProgressStep['counts'];
  outerSessionId?: string;
};

function progressPath(projectRoot: string): string {
  // The progress file lives at `.peaks/_sub_agents/<sid>/subagent-progress.json`.
  // The leading `_sub_agents/` is a meta-classification (mirrors `_runtime/`,
  // `_dogfood/`) — the SID is the per-session discriminator inside that meta
  // dir. Without the SID, sessions would collide on the same file.
  const sessionId = getSessionIdCanonical(projectRoot);
  const subDir = sessionId ?? 'unbound';
  return join(projectRoot, '.peaks', SUB_AGENTS_DIR, subDir, PROGRESS_FILE_NAME);
}

function ensureParentDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Read the current progress file. Returns a tagged result so
 * the CLI can map each failure mode to a distinct nextActions
 * hint (no-binding → run peaks workspace init; no-progress-file
 * → sub-agent has not started yet; invalid-json → the LLM wrote
 * garbage; recover by writing a fresh file).
 */
export function readSubAgentProgress(options: ReadProgressOptions): ReadProgressResult {
  const sessionId = getSessionIdCanonical(options.projectRoot);
  if (sessionId === null) {
    return { ok: false, reason: 'no-binding' };
  }
  const path = progressPath(options.projectRoot);
  if (!existsSync(path)) {
    return { ok: false, reason: 'no-progress-file' };
  }
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as SubAgentProgress;
    if (data.version !== 1 || typeof data.sessionId !== 'string') {
      return { ok: false, reason: 'invalid-json' };
    }
    return { ok: true, data, path };
  } catch {
    return { ok: false, reason: 'invalid-json' };
  }
}

/**
 * Append-or-replace the current step. Idempotent on identical
 * (step, phase) — the file is rewritten with the same payload
 * (no new history entry) so heartbeats from the same phase do
 * not pollute the history. Phase transitions append a new step
 * to the history and replace `current`.
 */
export function writeSubAgentProgress(options: WriteProgressOptions): SubAgentProgress {
  const existing = readSubAgentProgress({ projectRoot: options.projectRoot });
  const now = nowIso();
  const path = progressPath(options.projectRoot);

  if (existing.ok) {
    const prev = existing.data;
    // Heartbeat on the same current step: just bump updatedAt, do
    // NOT add a history entry. The shape of `current` is preserved.
    if (prev.current.step === options.step && prev.current.phase === options.phase) {
      const next: SubAgentProgress = {
        ...prev,
        updatedAt: now,
        current: {
          ...prev.current,
          updatedAt: now,
          ...(options.verdict !== undefined ? { verdict: options.verdict } : {}),
          ...(options.counts !== undefined ? { counts: options.counts } : {})
        }
      };
      ensureParentDir(path);
      writeFileSync(path, JSON.stringify(next, null, 2) + '\n', 'utf8');
      return next;
    }
    // Real phase / step transition: archive the prior current
    // into history, install the new current.
    const archived: SubAgentProgressStep = {
      ...prev.current,
      updatedAt: now
    };
    const next: SubAgentProgress = {
      ...prev,
      updatedAt: now,
      current: {
        startedAt: now,
        updatedAt: now,
        step: options.step,
        phase: options.phase,
        ...(options.verdict !== undefined ? { verdict: options.verdict } : {}),
        ...(options.counts !== undefined ? { counts: options.counts } : {})
      },
      history: [...prev.history, archived]
    };
    ensureParentDir(path);
    writeFileSync(path, JSON.stringify(next, null, 2) + '\n', 'utf8');
    return next;
  }

  // No prior file: this is the first write. Bootstrap a fresh
  // progress doc. The sessionId is whatever the binding points
  // at, so cross-session confusion is impossible.
  const sessionId = getSessionIdCanonical(options.projectRoot) ?? 'unbound';
  const fresh: SubAgentProgress = {
    version: 1,
    sessionId,
    ...(options.outerSessionId !== undefined ? { outerSessionId: options.outerSessionId } : {}),
    role: options.role,
    requestId: options.requestId,
    startedAt: now,
    updatedAt: now,
    current: {
      startedAt: now,
      updatedAt: now,
      step: options.step,
      phase: options.phase,
      ...(options.verdict !== undefined ? { verdict: options.verdict } : {}),
      ...(options.counts !== undefined ? { counts: options.counts } : {})
    },
    history: []
  };
  ensureParentDir(path);
  writeFileSync(path, JSON.stringify(fresh, null, 2) + '\n', 'utf8');
  return fresh;
}

/**
 * Resolve the project root for a CLI invocation: --project
 * override wins, otherwise the canonical git-root promotion
 * (so the sub-agent's writes land in the same `.peaks/_runtime/<sid>/`
 * the user's manual CLI would use). Re-exports the same
 * helper peaks workspace init / session rotate already use
 * for symmetry.
 */
export function resolveProgressProjectRoot(override: string | undefined, cwd: string): string {
  if (override !== undefined) return override;
  return findProjectRoot(cwd) ?? cwd;
}

/**
 * Compute the absolute path to the progress file for a given
 * project root, for callers that need to display / fs.watch it
 * (the dispatcher's read-back, the LLM-side step write banner,
 * etc.). This MUST agree with `progressPath` — the read/write
 * helpers resolve through `progressPath` and use the session
 * sub-directory, so the displayed path does too. Without this
 * agreement the dispatcher's read-back would point at a path
 * the writer never touches.
 */
export function subAgentProgressPath(projectRoot: string): string {
  return progressPath(resolve(projectRoot));
}
