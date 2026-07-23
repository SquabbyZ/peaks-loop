/**
 * AC-3 (legacy) → Task 1.7 honest-blocked stub.
 *
 * Pre-Task-1.7 the dispatcher could:
 *   - `shell-exec`     — `spawn('sh', ['-c', profile.compactCommand])`
 *   - `ide-native`     — write a PreToolUse hook to
 *                        `.claude/settings.local.json` so the runner
 *                        fired a hard-coded `claude --compact` against
 *                        itself.
 *   - `llm-self-compress` — record intent and return ok.
 *   - `noop`           — explicit opt-out.
 *
 * Design §13.1 / §13.2 retires every shape that:
 *   - claims a host CLI spawn proves compact completion
 *   - hard-codes `claude --compact` in a hook payload
 *   - returns `ok: true` without a capability cert
 *
 * This rewrite keeps the module's *signature* (callers in
 * `auto-compact-orchestrator.ts` and `tests/unit/context/...` still
 * import `dispatchIdeCompact` / `CompactTarget`) but routes every
 * pathway through a single honest `blocked` envelope. The next LLM
 * step is `peaks compact auto` — the capability-first control plane
 * (Task 1.6) — and only that path can ever mark a compact attempt as
 * completed. The old IDE-hook install service
 * (`src/services/hooks/auto-compact-hook-install.ts`) is now dead
 * code; a follow-up slice can remove it.
 */
import type { CompactDispatchResult } from './auto-compact-types.js';
import { detectIdeFromEnv } from './main-session-monitor.js';

export type CompactTarget = 'main' | 'sub-agent';

export interface DispatchIdeCompactInput {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly env?: NodeJS.ProcessEnv | undefined;
  /** Pre-1.7 timeout seam; preserved for signature compatibility. */
  readonly timeoutMs?: number | undefined;
  /** Pre-1.7 target seam; preserved for signature compatibility. */
  readonly target?: CompactTarget | undefined;
}

const NEXT_ACTION = 'peaks compact auto --project <repo> --session-id <sid> --json';

/**
 * Dispatch compact via the active IDE's registered pathway.
 *
 * As of Task 1.7 this function is a thin forwarder. It does NOT
 * spawn a host CLI, does NOT install a PreToolUse hook, and does
 * NOT return `ok: true` under any input. It maps the legacy
 * `pathway` discriminator to a single `blocked` envelope so callers
 * (orchestrator, tests) can distinguish "Task 1.7 retired this
 * pathway" from a real dispatch success.
 *
 * The next step in every envelope is `peaks compact auto` — the
 * only path the capability-first control plane honours.
 */
export async function dispatchIdeCompact(input: DispatchIdeCompactInput): Promise<CompactDispatchResult> {
  const env = input.env ?? process.env;
  const detected = detectIdeFromEnv(env);
  // `CompactDispatchResult.ide` is `string`, not the narrow `IdeId`
  // union — a hostile / missing env must still surface an honest
  // "unknown" id without coercing to a registered adapter (the
  // pre-1.7 cast was the false-success shape Task 1.7 retires).
  const ide: string = detected === 'unknown' ? 'unknown' : detected;
  const target: CompactTarget = input.target ?? 'main';
  return {
    ok: false,
    ide,
    pathway: 'noop',
    message:
      `Task 1.7 (design §13.1) retired this pathway: legacy ${target}-session ` +
      `compact dispatch via the registered IDE adapter is no longer a ` +
      `authoritative completion signal. The next step is the capability-first ` +
      `control plane (\`${NEXT_ACTION}\`).`
  };
}
