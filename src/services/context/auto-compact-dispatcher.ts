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
 * rid-031 (2026-07-28): `shell-exec` pathway is DEPRECATED. Real
 * callers must use `ide-native` (main session) or
 * `llm-self-compress`. No host CLI spawn occurs; the `case
 * 'shell-exec':` branch logs a deprecation warning and returns the
 * same envelope shape.
 *
 * Slice 2026-09-12-auto-compact-vendor-neutrality (defect #2 of the QA
 * pass): the paragraph above used to justify keeping that branch with
 * "the 2 currently-passing tests" it named by path and line (`:58` of
 * one file, `:102` of another, asserting `pathway: 'shell-exec'`).
 * That justification ROTTED and is false as of today: both files were
 * deleted by `f17aa377 test(rebuild): delete 559 legacy unit tests and
 * reset vitest config`, and `grep -rn "shell-exec" tests/` now returns
 * nothing — no test in this repo asserts `pathway: 'shell-exec'`. The
 * branch is retained for the rid-031 ENVELOPE CONTRACT itself
 * (`pathway` is part of `CompactDispatchResult` and is echoed to
 * `peaks code auto-compact` callers), not for a test. Deleting it is a
 * contract change, deliberately out of this slice.
 */
import { join } from 'node:path';
import type { CompactDispatchResult } from './auto-compact-types.js';
import type { IdeAdapter, IdeCompactProfile, IdeId } from '../ide/ide-types.js';

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
   * Behaviour matrix, keyed on the ADAPTER'S DECLARED pathway only
   * — never on the adapter's name (slice
   * 2026-09-12-auto-compact-vendor-neutrality):
   *   - target='main'     → llm-self-compress (write intent; main LLM
   *                          fires its compact command on its next turn).
   *   - target='sub-agent'→ shell-exec stub (DEPRECATED — no host
   *                          CLI spawn; returns envelope with
   *                          `pathway: 'shell-exec'` for legacy
   *                          contract only — see rid-031).
   * An adapter with no registered `compact` profile returns noop for
   * BOTH targets; an adapter whose profile serves the main session is
   * dispatched regardless of which IDE it is.
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
 * context actually shrunk; the next `peaks code auto-compact` probe
 * confirms.
 */
export async function dispatchIdeCompact(
  input: DispatchIdeCompactInput
): Promise<CompactDispatchResult> {
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

  // Slice 2026-09-12-auto-compact-vendor-neutrality — the up-front
  // `target === 'main' && ideId !== 'claude-code'` refusal is GONE.
  //
  // It decided by adapter NAME what the adapter's own profile already
  // declares, contradicting this file's contract ("No hard-coded IDE
  // names", :5-8): any adapter that filled in `compact` was still
  // rejected for not being called `claude-code`.
  //
  // It was also redundant. Every pathway below owns its own
  // main-session semantics — `ide-native` installs the hook against the
  // caller's own window; `shell-exec` is explicitly degraded to
  // `llm-self-compress` for a main target; `llm-self-compress` and
  // `noop` behave identically for both targets (so `noop` still returns
  // `ok: false` on main); an UNKNOWN pathway falls through to the
  // default noop. An adapter with no `compact` profile keeps its own
  // explicit refusal immediately below. No remaining capability test
  // would have been anything but a duplicate of one of those branches,
  // so the check was deleted rather than re-keyed. The two candidate
  // re-keyings were both rejected: `pathway !== 'ide-native'` would
  // refuse `shell-exec` and `llm-self-compress` adapters that the
  // switch already serves, and `pathway === 'noop'` IS the branch
  // immediately below.

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
      // No host CLI spawn occurs. The case marker is preserved for the
      // rid-031 envelope contract (callers read `pathway`), NOT for a
      // test — see this file's header, defect #2 of the 2026-09-12 QA
      // pass: the tests the previous comment named were deleted by
      // f17aa377 and no test asserts `pathway: 'shell-exec'` now.
      // Real callers must use `ide-native` (main session) or
      // `llm-self-compress`.
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
      // PreToolUse hook into the IDE's MACHINE-LOCAL settings layer,
      // resolved from the adapter (`settings.dirName` +
      // `settings.localSettingsFileName`) — never from a path literal
      // here. The hook command (`peaks code auto-compact`) reads the
      // adapter-declared `envVarForContextPercent` on every subsequent
      // Bash/Task tool call from the runner and, at ratio ≥ 0.95,
      // in-band spawns the adapter-declared `compactCommand` against the
      // CURRENT runner (not a child process — the bug documented in
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
        // returned with `pathway: 'shell-exec'` to preserve the rid-031
        // contract for callers that read `pathway` (sub-agent shells
        // historically relied on this path). The test the previous
        // comment named was deleted by f17aa377 — see this file's
        // header, defect #2 of the 2026-09-12 QA pass.
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
      // invokes `peaks code auto-compact`, so the user has
      // already opted in. No zero-touch surprise on workspace init.
      return await dispatchIdeNativeHook({
        projectRoot: input.projectRoot,
        sessionId: input.sessionId,
        target,
        adapter,
        profile
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
 * into the IDE's MACHINE-LOCAL settings file (idempotent; the
 * install service is a no-op if the hook is already present). On
 * the next Bash/Task tool call from the runner, the hook fires
 * `peaks code auto-compact` which in-band spawns the adapter's
 * declared compact command against the CURRENT runner session.
 *
 * Slice 2026-09-12-auto-compact-vendor-neutrality: the settings path
 * AND the echoed `ide` are read off the adapter, so this function no
 * longer names a vendor. An adapter that declares
 * `compactPathway: 'ide-native'` and its own `settings` location gets
 * its own hook file — the `.claude/settings.local.json` value survives
 * only as the installer's default for callers with no adapter in hand.
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
  adapter: IdeAdapter;
  profile: IdeCompactProfile;
}): Promise<CompactDispatchResult> {
  // Lazy dynamic import — matches the existing pattern in
  // `runAutoCompact` for `auto-compact-reader.ts` (line 311) and
  // avoids a static cycle if future slices add cross-imports
  // between dispatcher and hook-install.
  const { installAutoCompactHook } = await import('../hooks/auto-compact-hook-install.js');
  // Resolve the local settings file from the adapter's declared
  // location. `undefined` means "this IDE declares no machine-local
  // layer" → the installer's documented default applies.
  const localFileName = input.adapter.settings.localSettingsFileName;
  const settingsPath =
    localFileName === undefined
      ? undefined
      : join(input.projectRoot, input.adapter.settings.dirName, localFileName);
  const result = installAutoCompactHook({ projectRoot: input.projectRoot, settingsPath });
  const envVar = input.profile.envVarForContextPercent;
  return {
    ok: true,
    ide: input.adapter.id,
    pathway: 'ide-native',
    message:
      result.action === 'installed'
        ? `Auto-compact PreToolUse hook installed at ${result.settingsPath}. Next Bash/Task tool call will read ${envVar} and compact in-band at ratio ≥ 95%.`
        : result.action === 'updated'
          ? `Auto-compact PreToolUse hook REPAIRED at ${result.settingsPath} — the installed entry carried a stale command and was rewritten.`
          : `Auto-compact PreToolUse hook already installed at ${result.settingsPath}; next Bash/Task tool call will trigger compact in-band at ratio ≥ 95%.`
  };
}
