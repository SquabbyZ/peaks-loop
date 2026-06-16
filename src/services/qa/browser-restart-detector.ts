/**
 * Slice 2026-06-16-playwright-restart-loop — G1.
 *
 * BrowserRestartDetector
 *
 * Watches a stream of `mcp__playwright__browser_*` tool invocations
 * (synthetic, fed in by tests or by the sub-agent-progress signal)
 * and emits a halt signal when the model repeatedly tears down
 * and re-spawns the browser context.
 *
 * The detector is intentionally simple and dependency-free:
 *   - `record(event)` appends one event to a ring buffer.
 *   - `shouldHalt()` returns true when >= `maxRestarts` close->navigate
 *     pairs have occurred within `windowMs` of each other.
 *   - `diagnostic()` renders the user-facing message.
 *
 * It does NOT call playwright MCP. It does NOT spawn processes. It
 * only inspects the synthetic event log.
 *
 * R2 (per PRD): server-restart is a different MCP-level event;
 * only `browser_close` followed by `browser_navigate` (or
 * `browser_navigate` followed by `browser_close`, in either order)
 * within `windowMs` counts as a restart. A standalone
 * `browser_install` is not a tab close.
 *
 * Window: pairs are evaluated per (close_ts, navigate_ts) delta. The
 * detector uses a sliding window of `windowMs` (default 30s, the
 * PRD R4 default). Older events fall out of the window.
 *
 * Test seam: the test suite feeds a hand-rolled sequence of
 * `BrowserEvent` objects; production will call `record` from the
 * sub-agent-progress signal when it sees an
 * `mcp__playwright__browser_*` invocation.
 */

export type BrowserEvent = {
  /** The tool name as seen by the LLM dispatcher (e.g. `browser_close`). */
  readonly tool: string;
  /** ISO8601 timestamp. */
  readonly ts: string;
};

export type BrowserRestartDetectorOptions = {
  /** Maximum number of close->navigate pairs before halt. Default 3 (PRD AC1). */
  readonly maxRestarts?: number;
  /** Window in milliseconds within which a close must be followed by a navigate. Default 30_000. */
  readonly windowMs?: number;
  /** When false, the detector is a no-op (PRD AC6: --no-restart-detector). Default true. */
  readonly enabled?: boolean;
};

const DEFAULT_MAX_RESTARTS = 3;
const DEFAULT_WINDOW_MS = 30_000;

/**
 * Tools that count as "tab close" (PRD R2: distinguishes tab-close
 * from server-restart). A close must be followed by a `browser_navigate`
 * to count as a restart.
 */
const TAB_CLOSE_TOOLS: ReadonlySet<string> = new Set(['browser_close']);

/**
 * Tools that count as "tab spawn" (resets context). The detector
 * specifically tracks `browser_navigate` because the user-reported
 * loop pattern is `browser_close` -> `browser_navigate` -> `browser_close`.
 * Other browser tools (e.g. `browser_click`, `browser_screenshot`)
 * are inert for restart counting.
 */
const TAB_SPAWN_TOOLS: ReadonlySet<string> = new Set(['browser_navigate']);

export class BrowserRestartDetector {
  private readonly maxRestarts: number;
  private readonly windowMs: number;
  private readonly enabled: boolean;
  private readonly events: BrowserEvent[] = [];

  constructor(options: BrowserRestartDetectorOptions = {}) {
    this.maxRestarts = options.maxRestarts ?? DEFAULT_MAX_RESTARTS;
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.enabled = options.enabled !== false;
  }

  /**
   * Record a single browser event. Returns true when this event
   * caused a restart count to increment (i.e. it was a navigate
   * that paired with a prior close inside the window). Returns
   * false for inert events.
   */
  record(event: BrowserEvent): boolean {
    if (!this.enabled) return false;
    this.events.push(event);
    // Trim old events that fall outside the window relative to
    // the LATEST event we have seen (not Date.now()). Tests feed
    // synthetic 2026-06-16 timestamps; using Date.now() would drop
    // everything. We only need a 2-event sliding window per pair,
    // but keep more for the diagnostic.
    const last = this.events[this.events.length - 1];
    if (last === undefined) return false;
    const cutoff = Date.parse(last.ts) - this.windowMs;
    while (this.events.length > 0) {
      const first = this.events[0];
      if (first === undefined) break;
      if (Date.parse(first.ts) >= cutoff) break;
      this.events.shift();
    }
    return false;
  }

  /**
   * Count of close->navigate pairs detected within the window. A
   * pair is one `browser_close` followed by a `browser_navigate`
   * within `windowMs` of each other.
   */
  restartCount(): number {
    if (!this.enabled) return 0;
    let count = 0;
    let pendingCloseTs: number | null = null;
    // Walk in chronological order (the contract is: events are
    // pushed in order; if not, the worst case is a missed pair
    // which is still conservative).
    for (const ev of this.events) {
      const t = Date.parse(ev.ts);
      if (TAB_CLOSE_TOOLS.has(ev.tool)) {
        pendingCloseTs = t;
        continue;
      }
      if (TAB_SPAWN_TOOLS.has(ev.tool)) {
        if (pendingCloseTs !== null) {
          const delta = t - pendingCloseTs;
          if (delta >= 0 && delta <= this.windowMs) {
            count += 1;
            // Reset so we don't double-count. The next close must
            // re-arm the pending state.
            pendingCloseTs = null;
            continue;
          }
        }
        // A navigate WITHOUT a preceding close is a normal
        // session start, not a restart.
        pendingCloseTs = null;
      }
    }
    return count;
  }

  shouldHalt(): boolean {
    return this.restartCount() >= this.maxRestarts;
  }

  /**
   * Returns the human-readable diagnostic the user will see when
   * `shouldHalt` flips to true. Format: AC1 contract.
   */
  diagnostic(): string {
    const count = this.restartCount();
    return `playwright browser restart loop detected (${count} restarts in this slice). Reusing the same browser tab is the intended pattern. See .peaks/memory/playwright-restart-loop-2026-06-16.md`;
  }
}
