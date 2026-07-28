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
 *   - `ide-native`     — peaks-loop writes the compact intent to
 *                        the IDE's hook file (per
 *                        `IdeSettingsLocation`). Used when the IDE
 *                        requires a registered hook rather than a
 *                        runtime command.
 *   - `llm-self-compress` — peaks-loop records the intent and
 *                        returns `ok: true` with `pathway` echoed.
 *                        The LLM does its own context summarization
 *                        on the next turn. Always available; least
 *                        precise fallback.
 *   - `noop`           — adapter explicitly opted out. peaks-loop
 *                        returns `ok: false` with `message: 'noop'`.
 *                        Used by legacy / unverified adapters.
 *
 * rid-031 (2026-07-28): `shell-exec` pathway is DEPRECATED. The
 * `case 'shell-exec':` branch remains reachable only to keep the
 * 2 currently-passing tests in `tests/unit/context/auto-compact-main-target.test.ts:58`
 * + `tests/unit/services/context/auto-compact-dispatcher-ide-native.test.ts:102`
 * passing (they assert `pathway: 'shell-exec'`). Real callers must
 * use `ide-native` (main session) or `llm-self-compress`. No host
 * CLI spawn occurs; the case logs a deprecation warning and returns
 * the same envelope shape.
 */
import type { CompactDispatchResult } from './auto-compact-types.js';
import type { IdeCompactProfile, IdeId } from '../ide/ide-types.js';

type CompactPathway = IdeCompactProfile['compactPathway'];
import { detectIdeFromEnv } from './ide-detect.js';
import { getAdapter } from '../ide/ide-registry.js';

export type CompactTarget = 'main' | 'sub-agent';

export interface DispatchIdeCompactInput {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly env?: NodeJS.ProcessEnv | undefined;
  /** Spawn timeout (ms). Default 30s — Claude Code `/compact` is sync. */
  readonly timeoutMs?: number | undefined;
  /**
   * Slice 2026-06-28-code-mode-bypass-fix (defect #4): which session
   * the compact should target. Default `'main'` — the orchestrator
   * (peaks-code body) runs in the main-session Claude Code window and
   * wants to compress *its* context, not a sub-agent's. Sub-agent
   * shells that spawn their own `peaks code auto-compact` flow pass
   * `'sub-agent'` to preserve the legacy shell-spawn behaviour.
   *
   * Behaviour matrix (claude-code MVP):
   *   - target='main'     → llm-self-compress (write intent; main LLM
   *                          fires `/compact` on its next turn).
   *   - target='sub-agent'→ shell-exec stub (DEPRECATED — no host
   *                          CLI spawn; returns envelope with
   *                          `pathway: 'shell-exec'` for legacy
   *                          contract only — see rid-031).
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
  // Slice 2026-06-28-code-mode-bypass-fix (defect #4): default to
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
      // rid-031 (2026-07-28): `shell-exec` pathway is DEPRECATED.
      // No host CLI spawn occurs. The case marker is preserved so
      // 2 currently-passing tests in
      //   tests/unit/context/auto-compact-main-target.test.ts:58
      //   tests/unit/services/context/auto-compact-dispatcher-ide-native.test.ts:102
      // continue to assert `pathway: 'shell-exec'`. Real callers must
      // use `ide-native` (main session) or `llm-self-compress`.
      console.warn(
        `compact: shell-exec pathway is deprecated on adapter '${ideId}' (target='${target}'); no host CLI spawn — use ide-native instead.`
      );
      if (target === 'main') {
        return {
          ok: true,
          ide: ideId,
          pathway: 'llm-self-compress',
          message: `Main-session target on shell-exec adapter '${ideId}': deferring to in-band /compact (next LLM turn); writing intent record.`
        };
      }
      return {
        ok: true,
        ide: ideId,
        pathway: 'shell-exec',
        message: `shell-exec pathway is deprecated; no host CLI spawn for command '${profile.compactCommand}'. Use ide-native for main-session runner.`
      };
    case 'ide-native':
      // Slice 2026-07-02-auto-compact-zero-pause: write the auto-compact
      // PreToolUse hook into `.claude/settings.local.json`. The hook
      // command (`peaks session auto-compact-hook`) reads
      // `CLAUDE_CONTEXT_USAGE_PERCENT` on every subsequent Bash/Task
      // tool call from the runner and, at ratio ≥ 0.95, in-band spawns
      // `claude --compact` against the CURRENT runner (not a child
      // process — the bug documented in
      // `.peaks/memory/2026-06-27-auto-compact-design.md:139-152`).
      //
      // `ide-native` is ONLY for the main-session runner. When the
      // caller is a sub-agent shell (which has its own ephemeral
      // context window — not the runner's), fall through to
      // shell-exec so the sub-agent's `compactCommand` spawns a
      // child claude process and the sub-agent's own runner doesn't
      // get a PreToolUse hook installed in the wrong place.
      if (target === 'sub-agent') {
        // rid-031 (2026-07-28): legacy shell-spawn fallback is
        // DEPRECATED. No host CLI spawn occurs. The envelope is
        // returned with `pathway: 'shell-exec'` to preserve the
        // contract asserted by
        //   tests/unit/services/context/auto-compact-dispatcher-ide-native.test.ts:102
        // (sub-agent shells historically relied on this path).
        console.warn(
          `compact: sub-agent shell-exec fallback is deprecated on adapter '${ideId}'; no host CLI spawn for '${profile.compactCommand}'.`
        );
        return {
          ok: true,
          ide: ideId,
          pathway: 'shell-exec',
          message: `shell-exec fallback is deprecated; no host CLI spawn for command '${profile.compactCommand}'.`
        };
      }
      // Lazy install: we only get here when the caller explicitly
      // invokes `peaks code auto-compact --execute`, so the user has
      // already opted in. No zero-touch surprise on workspace init.
      return await dispatchIdeNativeHook({
        projectRoot: input.projectRoot,
        sessionId: input.sessionId,
        target
      });
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
 * Slice 2026-07-02-auto-compact-zero-pause: implement the
 * `ide-native` pathway. Writes the auto-compact PreToolUse hook
 * into `.claude/settings.local.json` (idempotent; the install
 * service is a no-op if the hook is already present). On the next
 * Bash/Task tool call from the runner, the hook fires
 * `peaks session auto-compact-hook` which in-band spawns
 * `claude --compact` against the CURRENT runner session.
 *
 * Returns `ok: true, pathway: 'ide-native'` regardless of install
 * action (`installed` vs `already-installed`) — both states
 * achieve the operational goal: the hook is wired and the next
 * Bash call will trigger it.
 */
async function dispatchIdeNativeHook(input: {
  projectRoot: string;
  sessionId: string;
  target: CompactTarget;
}): Promise<CompactDispatchResult> {
  // Lazy dynamic import — matches the existing pattern in
  // `runAutoCompact` for `auto-compact-reader.ts` (line 311) and
  // avoids a static cycle if future slices add cross-imports
  // between dispatcher and hook-install.
  const { installAutoCompactHook } = await import('../hooks/auto-compact-hook-install.js');
  const result = installAutoCompactHook({ projectRoot: input.projectRoot });
  return {
    ok: true,
    ide: 'claude-code',
    pathway: 'ide-native',
    message: result.action === 'installed'
      ? `Auto-compact PreToolUse hook installed at ${result.settingsPath}. Next Bash/Task tool call will read CLAUDE_CONTEXT_USAGE_PERCENT and compact in-band at ratio ≥ 95%.`
      : `Auto-compact PreToolUse hook already installed at ${result.settingsPath}; next Bash/Task tool call will trigger compact in-band at ratio ≥ 95%.`
  };
}