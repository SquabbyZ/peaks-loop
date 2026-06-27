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

export interface DispatchIdeCompactInput {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly env?: NodeJS.ProcessEnv | undefined;
  /** Spawn timeout (ms). Default 30s — Claude Code `/compact` is sync. */
  readonly timeoutMs?: number | undefined;
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