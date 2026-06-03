/**
 * Sub-agent progress surfacing for the RD/QA sub-agents in
 * `peaks-solo`'s Swarm phase. A sub-agent (or the LLM via the
 * `peaks progress step` CLI) writes a stable JSON file at
 * `.peaks/<sid>/system/subagent-progress.json`. The user-side
 * `peaks progress watch` CLI polls this file in a separate
 * terminal tab and renders elapsed / spinner / sub-step. The
 * `peaks progress start` CLI auto-spawns the watch in a new
 * terminal window so the user does not have to remember to do
 * it.
 *
 * Token cost design (the binding constraint of this feature):
 *   - The LLM side (step CLI) writes the file at most once per
 *     phase transition. That is approximately one Bash call per
 *     RD/QA sub-step. In a typical 5-step sub-agent slice the
 *     cost is < 10 output tokens.
 *   - The watch side polls a local file, not the LLM. Zero token
 *     cost.
 *   - The auto-spawn side (start CLI) is invoked once per
 *     session by the LLM at the first phase transition. One
 *     Bash call. The user closes the new terminal at any time;
 *     no further side effects.
 *
 * Net: the LLM pays a one-time < 10 token cost per slice to
 * give the user real-time progress visibility. The user pays
 * zero manual setup.
 *
 * This module is pure filesystem. It does NOT import the LLM
 * harness, does NOT spawn terminals, and does NOT talk to any
 * IPC. Those are concerns of the CLI layer (../cli/commands/
 * progress-commands.ts and hooks-settings-service.ts).
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { getSessionId } from '../session/session-manager.js';
import { findProjectRoot } from '../config/config-safety.js';

const PROGRESS_REL_PATH = 'system/subagent-progress.json';
const SPAWN_REL_PATH = 'system/progress-spawn.json';

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
  // The progress file lives under the *session* directory, not
  // directly under .peaks/. Every other per-slice artefact
  // (rd/tech-doc.md, qa/test-cases/<rid>.md, prd/requests/<rid>.md,
  // memory/, openspec/) lives under .peaks/<sid>/, so progress
  // should too. Without the session prefix, a session rotation
  // would orphan the file in the project root, and switching
  // sessions would have the watch reading the wrong slice's
  // progress.
  const sessionId = getSessionId(projectRoot);
  const subDir = sessionId ?? 'unbound';
  return join(projectRoot, '.peaks', subDir, PROGRESS_REL_PATH);
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
  const sessionId = getSessionId(options.projectRoot);
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
  const sessionId = getSessionId(options.projectRoot) ?? 'unbound';
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
 * (so the sub-agent's writes land in the same `.peaks/<sid>/`
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
 * (the watch banner, the auto-spawn helper, the close command).
 * This MUST agree with `progressPath` — the read/write helpers
 * resolve through `progressPath` and use the session sub-directory,
 * so the displayed path does too. Without this agreement the
 * watch banner would point at a path the file is never written
 * to, and the user would `cat` an empty file.
 */
export function subAgentProgressPath(projectRoot: string): string {
  return progressPath(resolve(projectRoot));
}

/**
 * Compute the absolute path to the spawn record for a given
 * project root. Exported so `peaks progress close` (and the
 * start command's success payload) can advertise the on-disk
 * location without re-deriving the session sub-directory.
 */
export function subAgentSpawnPath(projectRoot: string): string {
  const sessionId = getSessionId(projectRoot);
  const subDir = sessionId ?? 'unbound';
  return join(projectRoot, '.peaks', subDir, SPAWN_REL_PATH);
}

// ─────────────────────────────────────────────────────────────────────
// Spawn record: which terminal process did we open on behalf of
// this session, so we can kill it on completion. This file is
// separate from the progress JSON so the watch-side read on the
// progress file does not have to also parse the spawn record,
// and so `peaks progress close` can be invoked without
// reading or writing the progress file at all.
// ─────────────────────────────────────────────────────────────────────

export type ProgressSpawnRecord = {
  version: 1;
  sessionId: string;
  pid: number;
  platform: NodeJS.Platform;
  command: string;
  args: string[];
  spawnedAt: string;
  reason?: string;
  /** The title we asked the terminal emulator to set. */
  windowTitle: string;
};

function spawnRecordPath(projectRoot: string): string {
  const sessionId = getSessionId(projectRoot);
  const subDir = sessionId ?? 'unbound';
  return join(projectRoot, '.peaks', subDir, SPAWN_REL_PATH);
}

export type WriteSpawnRecordOptions = {
  projectRoot: string;
  pid: number;
  platform: NodeJS.Platform;
  command: string;
  args: string[];
  reason?: string;
  windowTitle: string;
};

export function writeSpawnRecord(options: WriteSpawnRecordOptions): ProgressSpawnRecord | null {
  const sessionId = getSessionId(options.projectRoot);
  if (sessionId === null) return null;
  const now = nowIso();
  const record: ProgressSpawnRecord = {
    version: 1,
    sessionId,
    pid: options.pid,
    platform: options.platform,
    command: options.command,
    args: options.args,
    spawnedAt: now,
    ...(options.reason !== undefined ? { reason: options.reason } : {}),
    windowTitle: options.windowTitle
  };
  const path = spawnRecordPath(options.projectRoot);
  ensureParentDir(path);
  writeFileSync(path, JSON.stringify(record, null, 2) + '\n', 'utf8');
  return record;
}

export type ReadSpawnRecordResult =
  | { ok: true; data: ProgressSpawnRecord; path: string }
  | { ok: false; reason: 'no-binding' | 'no-spawn-record' | 'invalid-json' };

export function readSpawnRecord(projectRoot: string): ReadSpawnRecordResult {
  const sessionId = getSessionId(projectRoot);
  if (sessionId === null) return { ok: false, reason: 'no-binding' };
  const path = spawnRecordPath(projectRoot);
  if (!existsSync(path)) return { ok: false, reason: 'no-spawn-record' };
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as ProgressSpawnRecord;
    if (data.version !== 1 || typeof data.pid !== 'number') {
      return { ok: false, reason: 'invalid-json' };
    }
    return { ok: true, data, path };
  } catch {
    return { ok: false, reason: 'invalid-json' };
  }
}

export function clearSpawnRecord(projectRoot: string): boolean {
  const path = spawnRecordPath(projectRoot);
  if (!existsSync(path)) return false;
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

export type PhaseClosingTrigger = 'finished' | 'failed';

const PHASES_THAT_AUTO_CLOSE: ReadonlySet<SubAgentProgressPhase> = new Set<SubAgentProgressPhase>([
  'finished',
  'failed'
]);

/**
 * True if a transition into the given phase should auto-close
 * the spawned watch window. `finished` and `failed` both
 * indicate the sub-agent is done; a `blocked` verdict on a
 * `finished` step is intentionally NOT a close trigger
 * because a blocked slice usually means the user needs to
 * read the watch output before deciding what to do. The CLI
 * layer reads `data.current.phase`, not the verdict, so this
 * helper is the only close-decision source of truth.
 */
export function phaseAutoClosesSpawn(phase: SubAgentProgressPhase): boolean {
  return PHASES_THAT_AUTO_CLOSE.has(phase);
}
