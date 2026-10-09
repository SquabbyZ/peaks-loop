// src/services/ide/adapters/claude-code-model-window.ts
//
// Which Claude Code model is active, and how many tokens its context window
// holds. Those are the two questions `resolveClaudeModelFromEnv` and
// `modelContextWindowTokens` answer, and they are the pair that left
// `claude-code-adapter.ts`: that file is far past the
// 300-line cap, the repo's size ratchet only ever goes down, and the adapter
// needed room for its `mcpInstall` declaration. Same technique, and the same
// reason, as the `claude-code-local-state.ts` split before it — a self-contained
// responsibility leaves, instead of the ceiling going up.
//
// WHY THIS BLOCK AND NOT ANOTHER. Both functions are PURE: the env map is an
// argument, and nothing here reads a file, an env var or a process global. So
// the move needs no rewiring in either direction — the adapter imports both
// back and nothing here reaches for the adapter — which is what keeps the move
// a move. It is also the one block in that file whose eslint findings are zero,
// which a receiving file with no baseline row must be.
//
// The vendor spellings below (`ANTHROPIC_*`, `claude-opus-4`) are Claude Code's
// own. An adapter is the only place they belong (spec §13), which is why this is
// a second adapter module and not a shared one.

/**
 * 1M-context window size in tokens (documented single choice: 1,000,000).
 * EXPORTED because the adapter's late 1M rescue (`resolveContextWindowTokens`)
 * names it too — one number, one declaration, rather than a copy that can drift.
 */
export const ONE_MILLION_CONTEXT_TOKENS = 1_000_000;
/**
 * Safe-default (non-1M) context window size in tokens. Exported for the same
 * reason: `resolveContextWindow` compares the heuristic against it.
 */
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000;

/**
 * Known 1M-context Claude model id prefixes whose ids do NOT carry a `1m`
 * suffix (e.g. `claude-sonnet-4-5-20250929`). The substring match is
 * intentionally generous — every `claude-sonnet-4*` / `claude-opus-4*`
 * variant is 1M-context.
 */
const ONE_MILLION_CONTEXT_MODELS: readonly string[] = ['claude-opus-4', 'claude-sonnet-4'];

/**
 * Claude Code runtime env vars that may carry the currently-active model id,
 * in documented precedence order (first non-empty value wins):
 *   1. ANTHROPIC_MODEL                — explicit per-run model override
 *   2. ANTHROPIC_DEFAULT_OPUS_MODEL   — default Opus fallback
 *   3. ANTHROPIC_DEFAULT_SONNET_MODEL — default Sonnet fallback
 *   4. ANTHROPIC_DEFAULT_HAIKU_MODEL  — default Haiku fallback
 *   5. ANTHROPIC_DEFAULT_FABLE_MODEL  — default Fable fallback
 *   6. CLAUDE_CODE_SUBAGENT_MODEL     — sub-agent model (used when the others
 *                                       are absent, e.g. a sub-agent-only env)
 *
 * Why env-first: the transcript's `message.model` often drops Claude Code's
 * `[1M]` / `[200K]` suffix marker (observed: `deepseek-v4-flash`), while the
 * runtime env vars above carry it (`deepseek-v4-flash[1M]`). Reading them
 * first lets the window resolver see the true context window. This family is
 * vendor-specific, so it lives ONLY in the claude-code adapter.
 */
const CLAUDE_CODE_MODEL_ENV_VARS: readonly string[] = [
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL'
];

/**
 * Resolve the currently-active Claude Code model id from a runtime env map.
 * Returns the first non-empty `CLAUDE_CODE_MODEL_ENV_VARS` value (trimmed), or
 * `undefined` when none is present. Pure + exported for tests; the caller falls
 * back to the transcript `message.model` when this returns undefined.
 */
export function resolveClaudeModelFromEnv(env: NodeJS.ProcessEnv | undefined): string | undefined {
  if (!env) return undefined;
  for (const name of CLAUDE_CODE_MODEL_ENV_VARS) {
    const value = env[name];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }
  return undefined;
}

/**
 * Model-aware context-window size in tokens.
 *
 * Detection rule (documented):
 *   1. Empty / unknown model → DEFAULT_CONTEXT_WINDOW_TOKENS (200_000).
 *   2. Suffix heuristic — a model id containing `1m` (case-insensitive) is
 *      treated as 1M-context.
 *   3. Explicit allowlist — known 1M Claude model ids
 *      (ONE_MILLION_CONTEXT_MODELS).
 *   4. Everything else → 200_000 (the safe default).
 *
 * Callers MAY additionally infer ≥1M from the observed token count: if
 * `contextTokens > DEFAULT_CONTEXT_WINDOW_TOKENS`, the model cannot be a
 * 200K model and must be ≥1M (see `readClaudeTranscriptEstimate`).
 *
 * This is the HEURISTIC layer only. Explicit user overrides sit ABOVE it —
 * see `resolveContextWindow`, which is what the probe actually calls.
 */
export function modelContextWindowTokens(model: string): number {
  const m = model.trim().toLowerCase();
  if (m.length === 0) return DEFAULT_CONTEXT_WINDOW_TOKENS;
  if (m.includes('1m')) return ONE_MILLION_CONTEXT_TOKENS;
  for (const known of ONE_MILLION_CONTEXT_MODELS) {
    if (m.includes(known)) return ONE_MILLION_CONTEXT_TOKENS;
  }
  return DEFAULT_CONTEXT_WINDOW_TOKENS;
}
