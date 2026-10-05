/**
 * Input types for the IDE-aware compact dispatcher (`auto-compact-dispatcher.ts`).
 *
 * Split out of `auto-compact-dispatcher.ts` (file-size cap campaign) so the
 * dispatcher stays under the raw-line cap. The dispatcher re-exports every
 * name declared here, so existing importers keep using
 * `./auto-compact-dispatcher.js` unchanged.
 */

export type CompactTarget = 'main' | 'sub-agent';

export interface DispatchIdeCompactInput {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly env?: NodeJS.ProcessEnv | undefined;
  /** Spawn timeout (ms). Default 30s — Claude Code `/compact` is sync. */
  readonly timeoutMs?: number | undefined;
  /**
   * the compact should target. Default `'main'` — the orchestrator
   * (peaks-code body) runs in the main-session Claude Code window and
   * wants to compress *its* context, not a sub-agent's. Sub-agent
   * shells that spawn their own `peaks code auto-compact` flow pass
   * `'sub-agent'` to preserve the legacy shell-spawn behaviour.
   *
   * Behaviour matrix, keyed on the ADAPTER'S DECLARED pathway only
   * — never on the adapter's name (slice
   *   - target='main'     → llm-self-compress (write intent; main LLM
   *                          fires its compact command on its next turn).
   *   - target='sub-agent'→ shell-exec stub (DEPRECATED — no host
   *                          CLI spawn; returns envelope with
   *                          `pathway: 'shell-exec'` for legacy
   * An adapter with no registered `compact` profile returns noop for
   * BOTH targets; an adapter whose profile serves the main session is
   * dispatched regardless of which IDE it is.
   */
  readonly target?: CompactTarget | undefined;
}
