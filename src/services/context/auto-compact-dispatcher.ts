/**
 * AC-3 — IDE-aware compact dispatcher.
 *
 * Reads the active IDE's `IdeAdapter.compact` profile and dispatches
 * compact via the adapter-declared pathway. No hard-coded IDE names
 * — Claude Code is the MVP that fills `compact`; other adapters
 * register their own `compact` profile as L2-dogfood verifies
 * each IDE's actual compact surface.
 *
 * Pathway dispatch:
 *
 *   - `shell-exec`     — peaks-cli spawns the adapter's
 *                        `compactCommand` via `child_process.spawn`.
 *                        Works for any IDE that accepts a slash
 *                        command via a shell-spawnable entry point
 *                        (Claude Code MVP: `/compact`).
 *   - `ide-native`     — peaks-cli writes the compact intent to
 *                        the IDE's hook file (per
 *                        `IdeSettingsLocation`). Used when the IDE
 *                        requires a registered hook rather than a
 *                        runtime command.
 *   - `llm-self-compress` — peaks-cli records the intent and
 *                        returns `ok: true` with `pathway` echoed.
 *                        The LLM does its own context summarization
 *                        on the next turn. Always available; least
 *                        precise fallback.
 *   - `noop`           — adapter explicitly opted out. peaks-cli
 *                        returns `ok: false` with `message: 'noop'`.
 *                        Used by legacy / unverified adapters.
 */
import { spawn } from 'node:child_process';
import type { CompactDispatchResult } from './auto-compact-types.js';
import type { IdeCompactProfile, IdeId } from '../ide/ide-types.js';

type CompactPathway = IdeCompactProfile['compactPathway'];
import { detectIdeFromEnv } from './main-session-monitor.js';
import { getAdapter } from '../ide/ide-registry.js';

export type CompactTarget = 'main' | 'sub-agent';

export interface DispatchIdeCompactInput {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly env?: NodeJS.ProcessEnv | undefined;
  /** Spawn timeout (ms). Default 30s — Claude Code `/compact` is sync. */
  readonly timeoutMs?: number | undefined;
  /**
   * Slice 2026-06-28-solo-mode-bypass-fix (defect #4): which session
   * the compact should target. Default `'main'` — the orchestrator
   * (peaks-solo body) runs in the main-session Claude Code window and
   * wants to compress *its* context, not a sub-agent's. Sub-agent
   * shells that spawn their own `peaks solo auto-compact` flow pass
   * `'sub-agent'` to preserve the legacy shell-spawn behaviour.
   *
   * Behaviour matrix (claude-code MVP):
   *   - target='main'     → llm-self-compress (write intent; main LLM
   *                          fires `/compact` on its next turn).
   *   - target='sub-agent'→ shell-exec (spawn `sh -c /compact` in the
   *                          sub-agent's own shell, preserving the
   *                          pre-slice behaviour).
   * Non-claude-code IDEs + target='main' return noop + warning.
   */
  readonly target?: CompactTarget | undefined;
}

/**
 * Dispatch compact via the active IDE's registered pathway.
 *
 * Returns a `CompactDispatchResult` envelope. The result is `ok`
 * when the dispatch path completed without error — for
 * `llm-self-compress` the LLM still has to do the actual summary,
 * so the orchestrator MUST NOT treat `ok: true` as proof that the
 * context actually shrunk; the next `peaks context now` probe
 * confirms.
 */
export async function dispatchIdeCompact(input: DispatchIdeCompactInput): Promise<CompactDispatchResult> {
  const env = input.env ?? process.env;
  const detected = detectIdeFromEnv(env);
  // See auto-compact-reader.ts for the IdeKind→IdeId cast rationale.
  const ideId: IdeId = (detected === 'unknown' ? 'claude-code' : detected) as IdeId;
  const adapter = getAdapter(ideId);
  // Slice 2026-06-28-solo-mode-bypass-fix (defect #4): default to
  // `'main'` so the orchestrator's auto-compact actually compresses
  // the main-session context. The orchestrator passes `'sub-agent'`
  // explicitly when a sub-agent shell dispatches the call.
  const target: CompactTarget = input.target ?? 'main';

  // Slice 2026-06-28: when targeting the MAIN session, refuse
  // up-front for adapters we cannot dispatch a main-session compact
  // against. We DO this before the `!adapter.compact` short-circuit
  // so the test message reflects the operational cause (target vs
  // adapter capability). Even non-claude-code adapters without a
  // registered `compact` profile should report "main-session target
  // unsupported" rather than the generic "no compact profile" line.
  if (target === 'main' && ideId !== 'claude-code') {
    return {
      ok: false,
      ide: ideId,
      pathway: 'noop',
      message: `main-session target unsupported on adapter '${ideId}'; only claude-code supports in-band main-session compact.`
    };
  }

  // Adapters that don't declare `compact` (legacy / unverified) →
  // explicit noop so the caller can distinguish "IDE doesn't support
  // compact" from "IDE supports but dispatch failed".
  if (!adapter.compact) {
    return {
      ok: false,
      ide: ideId,
      pathway: 'noop',
      message: `IDE '${ideId}' has no registered compact profile; cannot dispatch.`
    };
  }

  const profile = adapter.compact;
  const timeoutMs = input.timeoutMs ?? 30_000;

  const pathway: CompactPathway = profile.compactPathway;
  switch (pathway) {
    case 'shell-exec':
      // Slice 2026-06-28: shell-exec is only correct when the caller
      // IS the shell whose context we want compressed. Sub-agents
      // qualify; the main-session orchestrator does not.
      if (target === 'main') {
        return {
          ok: true,
          ide: ideId,
          pathway: 'llm-self-compress',
          message: `Main-session target on shell-exec adapter '${ideId}': deferring to in-band /compact (next LLM turn); writing intent record.`
        };
      }
      return await dispatchShellExec({
        ideId,
        command: profile.compactCommand,
        timeoutMs
      });
    case 'ide-native':
      // Future slice: write the compact intent to the IDE's hook
      // file (per `IdeSettingsLocation`). For v2.13.0 MVP the
      // shell-exec pathway covers Claude Code; this branch stays
      // reserved.
      return {
        ok: false,
        ide: ideId,
        pathway: 'ide-native',
        message: `ide-native compact pathway is reserved for a future slice; adapter '${ideId}' should declare shell-exec or llm-self-compress for now.`
      };
    case 'llm-self-compress':
      return {
        ok: true,
        ide: ideId,
        pathway: 'llm-self-compress',
        message: `Adapter '${ideId}' uses LLM-self-compress; LLM will summarize on next turn.`
      };
    case 'noop':
      return {
        ok: false,
        ide: ideId,
        pathway: 'noop',
        message: `Adapter '${ideId}' explicitly opted out of auto-compact.`
      };
    default:
      // Forward-compatibility: if a new pathway is added to the
      // union, we fall through to noop + log the unknown value.
      return {
        ok: false,
        ide: ideId,
        pathway: 'noop',
        message: `Unknown compact pathway '${String(pathway)}' for adapter '${ideId}'.`
      };
  }
}

/**
 * Spawn the adapter's `compactCommand` via child_process. Returns
 * the dispatch envelope with `pathway: 'shell-exec'`.
 *
 * MVP: Claude Code registers `compactCommand: '/compact'` and
 * `compactPathway: 'shell-exec'`. We spawn via `sh -c` so the
 * slash-command resolves inside the runner's shell session.
 *
 * For other IDEs that adopt `shell-exec` in the future, the
 * `compactCommand` field drives whatever shell-spawnable token
 * the IDE accepts (e.g. trae's compact-token).
 */
function dispatchShellExec(input: {
  ideId: string;
  command: string;
  timeoutMs: number;
}): Promise<CompactDispatchResult> {
  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', input.command], {
      stdio: 'ignore',
      // Detach so the IDE's runner picks up the slash command.
      detached: true,
      env: process.env
    });
    child.unref();
    const timer = setTimeout(() => {
      // Don't kill — the IDE runner keeps the command alive in
      // its own session; we just stop waiting.
      resolve({
        ok: true,
        ide: input.ideId,
        pathway: 'shell-exec',
        message: `Compact command '${input.command}' dispatched (timeout=${input.timeoutMs}ms); IDE runner should pick it up.`
      });
    }, input.timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        ide: input.ideId,
        pathway: 'shell-exec',
        message: `Failed to spawn compact command '${input.command}': ${err.message}`
      });
    });
    child.on('spawn', () => {
      // Spawn succeeded — return immediately; the IDE runner
      // continues processing the slash command in its own session.
      clearTimeout(timer);
      resolve({
        ok: true,
        ide: input.ideId,
        pathway: 'shell-exec',
        message: `Compact command '${input.command}' spawned successfully.`
      });
    });
  });
}