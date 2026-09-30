/**
 * Auto-compact capability types: the per-IDE compact descriptor and the
 * vendor-specific context-percent fallback input. Hoisted verbatim out of
 * `ide-types.ts` by the b1 file-size campaign; both names are re-exported
 * from `ide-types.ts`, so every `import type { … } from '../ide-types.js'`
 * keeps resolving through the original path. No field, doc comment or
 * string-union member was edited.
 */
import type { ContextPercentProbe } from '../context/auto-compact-types.js';

/**
 * Per-IDE auto-compact capability descriptor. See `IdeAdapter.compact`
 * for the protocol contract. The `MvpCompactPathway` string union
 * keeps the field exhaustive — adding a new pathway requires updating
 * every adapter that opts in.
 */
export interface IdeCompactProfile {
  /** Env-var name the IDE writes per turn to expose context-fill %. */
  readonly envVarForContextPercent: string;
  /**
   * Slash command or shell-call to invoke compact. The orchestrator
   * spawns this via `child_process.spawn` (shell-exec pathway) or
   * writes it to an IDE hook file (ide-native pathway).
   *
   * ZERO EXECUTOR as of slice 2026-09-13-auto-compact-trigger-ownership: every
   * `shell-exec` branch now only REPORTS that it will not spawn (see
   * `auto-compact-dispatcher.ts`), and the `ide-native` branch registers a
   * harness-side trigger instead. The field is retained because the sibling
   * work (A2, harness-side state re-injection) still needs it; nothing in this
   * slice deletes it. Do not read it as a capability peaks-loop has.
   */
  readonly compactCommand: string;
  /**
   * `shell-exec` — peaks-loop spawns the command via child_process
   *                (works for any IDE that accepts a slash command
   *                via a shell-spawnable entry point).
   * `ide-native` — peaks-loop writes to an IDE-specific hook file;
   *                used when the IDE requires a registered hook
   *                rather than a runtime command.
   * `llm-self-compress` — peaks-loop prompts the LLM to summarize
   *                its own context (no IDE integration required;
   *                least precise but always available).
   * `noop` — peaks-loop records the intent but performs no action;
   *          used by IDEs that explicitly opt out (e.g. legacy
   *          adapters still on the v2.11.x model).
   */
  readonly compactPathway: 'shell-exec' | 'ide-native' | 'llm-self-compress' | 'noop';
  /**
   * Optional settings key / env var the IDE reads its AUTO-COMPACT WINDOW
   * from — i.e. the window the harness itself compacts against. When
   * declared, peaks-loop writes the window it computes its ratio against
   * into the adapter's machine-local settings `env` block, under this key,
   * so both sides reference one number instead of two independent
   * resolutions (slice 2026-09-13-auto-compact-trigger-ownership).
   *
   * `undefined` = this IDE exposes no such knob. peaks-loop then cannot
   * close the drift; `peaks compact harness-window` reports that instead of
   * pretending. Adapters that do not opt in are unchanged.
   */
  readonly autoCompactWindowEnvVar?: string;
  /**
   * Optional command the runner invokes post-compact to confirm
   * ratio dropped (e.g. `peaks code auto-compact --json`). When omitted,
   * the orchestrator polls `envVarForContextPercent` directly.
   */
  readonly postCompactDetectCommand?: string;
  /**
   * Optional vendor-specific fallback the generic `readContextPercent`
   * reader calls when the primary env-var probe misses. Returns a
   * completed `ContextPercentProbe` (e.g. `statusline-poll` /
   * `transcript-estimate`) or `null` when the adapter has no signal —
   * the reader then falls through to `conservative-fallback`.
   *
   * Keeps IDE-specific filesystem / env knowledge (Claude Code's
   * `~/.claude/statusline-state.json` + `~/.claude/projects` transcript
   * layout, etc.) inside the adapter, not the generic reader. Adapters
   * that do not opt in simply omit the field; new IDEs are addable
   * without touching the generic reader.
   *
   * Added in slice 2026-09-02-vendor-neutral-context-probe.
   */
  readonly readContextPercentFallback?: (
    input: ContextPercentFallbackInput
  ) => ContextPercentProbe | null;
  /**
   * Optional locator for the IDE's per-session transcript file (jsonl),
   * keyed by the OUTER (harness) session id. `peaks code context-audit`
   * (slice 2026-09-10-context-audit-and-discipline, Slice A) uses it to
   * group the session's tool results by tool + short input key, so the
   * generic audit service never learns any vendor's on-disk layout.
   *
   * Returns the absolute path, or `null` when the transcript does not
   * exist. Adapters MUST NOT throw on a missing file — the audit treats
   * `null` as `available: false` and continues.
   *
   * Adapters that do not opt in simply omit the field; the audit then
   * reports `transcript-locator-unavailable`.
   */
  readonly resolveTranscriptPath?: (outerSessionId: string) => string | null;
}

/**
 * Input the generic `readContextPercent` reader passes to an adapter's
 * optional `IdeCompactProfile.readContextPercentFallback` hook. The adapter
 * owns the vendor-specific fallback logic (statusline poll, transcript
 * lookup, etc.); the generic reader stays IDE-agnostic.
 *
 * Added in slice 2026-09-02-vendor-neutral-context-probe.
 */
export interface ContextPercentFallbackInput {
  /** Project root (the probe's `--project` anchor). */
  readonly projectRoot: string;
  /** Peaks session id (NOT the harness / IDE transcript id). */
  readonly sessionId: string;
  /**
   * Outer (harness / IDE) session id — the id the IDE uses to name its
   * transcript / session files (e.g. a UUID). Optional: when unresolved,
   * adapters whose fallback depends on it should return `null`.
   */
  readonly outerSessionId?: string | undefined;
  /** Injectable env (defaults to process.env in the reader). */
  readonly env?: NodeJS.ProcessEnv | undefined;
  /**
   * Raw `context.windowTokens` value from the merged config (project layer
   * over user layer), read by the generic reader so the adapter stays free
   * of config-path knowledge. UNVALIDATED — the adapter validates it via
   * `parseContextWindowOverride` and warns on a bad value.
   *
   * Slice 2026-09-09-context-window-override.
   */
  readonly configWindowTokens?: unknown;
  /**
   * Raw value of the adapter's `autoCompactWindowEnvVar`, resolved by the
   * generic reader from the adapter's own declarations (settings path +
   * key name) — the window peaks-loop configured for the harness. Feeds the
   * `harness-env` layer of `resolveContextWindow`.
   *
   * Slice 2026-09-13-auto-compact-trigger-ownership.
   */
  readonly harnessWindowTokens?: unknown;
  /**
   * True when `harnessWindowTokens` is a value peaks-loop ITSELF wrote (the
   * harness settings carry the provenance marker matching it), false when a
   * human set the key by hand.
   *
   * The `harness-env` layer outranks the model heuristic either way — that is
   * what keeps peaks-loop's ratio and the harness's trigger on one number. The
   * flag decides only whether the late 1M rescue may OVERRULE that layer when
   * the observed context proves it too small: peaks-loop's own earlier
   * resolution is self-correcting, whereas a human's explicit pin must not be
   * silently rewritten (and, since it is persisted, permanently so).
   *
   * Omitted = treated as not peaks-written (the safe direction: do not touch
   * what you did not write).
   */
  readonly harnessWindowPeakWritten?: boolean;
}
