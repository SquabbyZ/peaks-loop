/**
 * Input type for the auto context-percent probe (`auto-compact-reader.ts`).
 *
 * Split out of `auto-compact-reader.ts` (file-size cap campaign) so the reader
 * stays under the raw-line cap. The reader re-exports every name declared
 * here, so existing importers keep using `./auto-compact-reader.js` unchanged.
 */

export interface ReadContextPercentInput {
  readonly projectRoot: string;
  readonly sessionId: string;
  /**
   * Outer (harness / IDE) session id — the id the IDE uses to name its
   * transcript / session files. Resolved by the caller (env signal → bound
   * session meta) and passed through to the adapter's
   * `readContextPercentFallback`. Optional: when unresolved, the adapter
   * fallback returns null → conservative-fallback.
   */
  readonly outerSessionId?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  /**
   * When set to a finite non-negative number, short-circuits the entire
   * env / statusline / transcript chain with `source: 'user-overridden'`.
   * Mac escape hatch — some IDEs (e.g. Claude Code on macOS) do NOT
   * inject their context-percent env-var into PreToolUse sub-shells, so the
   * user (or a hook wrapper) can inject the bytes they observed themselves.
   * Priority P0 — above everything else.
   */
  readonly promptSizeBytes?: number | undefined;
}
