/**
 * The per-session compact-history log one run appends to.
 *
 * Split out of `auto-compact-orchestrator.ts` (file-size cap campaign). The
 * orchestrator re-exports every name declared here, so existing importers keep
 * using `./auto-compact-orchestrator.js` unchanged.
 */
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getSessionDir } from '../session/getSessionDir.js';

/**
 * auto-compact dispatch. Appended at the end of `executeAutoCompact`
 * so the new 'peaks compact history' CLI + the
 * 'peaks statusline compact' indicator have a record. One file
 * per session (gitignored under `.peaks/_runtime/<sessionId>/`).
 */
export interface CompactHistoryEvent {
  readonly schemaVersion: 1;
  readonly ts: string;
  readonly target: 'main' | 'sub-agent' | 'worker';
  readonly mode: 'standard' | 'partial' | 'aggressive';
  readonly ide: string;
  readonly pathway: string;
  readonly beforeRatio: number;
  readonly redLine: boolean;
  readonly ok: boolean;
  readonly checkpointPath: string;
  readonly dispatchMessage: string;
  /**
   * instrument. `windowTokens` is the denominator peaks-loop divided by
   * (`probe.capacityTokens`), so `beforeRatio * windowTokens` is the exact
   * TOKEN POINT peaks-loop asked the harness to compact at. That number is
   * the deliverable — NOT a hand-picked threshold: this slice could not run a
   * real Claude Code session, so the real trigger point of
   * `CLAUDE_CODE_AUTO_COMPACT_WINDOW` (documented as a window, observed to
   * fire near the window's end) has no measured answer yet. Recording the
   * intent lets the first real session produce one.
   */
  readonly windowTokens?: number | null;
  /** Which layer produced `windowTokens` (see `ContextWindowSource`). */
  readonly windowSource?: string | null;
  /**
   * `dispatch` (default, and the only kind earlier releases wrote) or
   * `observed` — a row appended when a later probe MEASURED the ratio after
   * a dispatched compact, proving one landed. The pair is what yields the
   * intent-vs-observed delta.
   */
  readonly kind?: 'dispatch' | 'observed';
  /** `observed` rows only: the measured post-compact ratio. */
  readonly afterRatio?: number;
}
export function appendCompactHistoryEvent(input: {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly event: CompactHistoryEvent;
}): void {
  const dir = getSessionDir(input.projectRoot, input.sessionId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, 'compact-history.jsonl');
  appendFileSync(path, JSON.stringify(input.event) + '\n', 'utf8');
}
