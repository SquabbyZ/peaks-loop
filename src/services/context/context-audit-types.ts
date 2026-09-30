/**
 * Public envelope types for `peaks code context-audit`, plus the two
 * module-internal shapes shared by the scan/fold machinery.
 *
 * Moved VERBATIM out of `./context-audit.ts` (wave 3, eslint-family sweep)
 * so that module stays under the 300 raw-line cap. Mechanical move only —
 * field order, optionality and doc comments are unchanged; the three public
 * interfaces are re-exported from `./context-audit.ts` unchanged.
 */

export interface ContextAuditEntry {
  /** Tool name (`Bash`, `Read`, `Grep`, …), or `unknown` when unmatched. */
  readonly tool: string;
  /** Short, stable summary of the tool input (command line / path tail / pattern). */
  readonly key: string;
  /** Total UTF-8 bytes of every tool result in this group. */
  readonly bytes: number;
  /**
   * Share of the session's tool-result bytes, as a PERCENTAGE in `[0, 100]`
   * with one decimal (e.g. `4.2` — not the `0.042` ratio). The name and the
   * value agree: `pct` means percent.
   */
  readonly pctOfTotal: number;
  /** How many tool results landed in this group. */
  readonly count: number;
}

export interface ContextAuditResult {
  /** False when the transcript could not be read; see `reason`. */
  readonly available: boolean;
  /** Machine-readable unavailability reason (`null` when available). */
  readonly reason: string | null;
  /** Absolute transcript path, or `null` when unresolved. */
  readonly transcriptPath: string | null;
  /** Total UTF-8 bytes of all tool results seen. */
  readonly totalBytes: number;
  /** Number of tool-result entries seen. */
  readonly entryCount: number;
  /** Distinct `(tool, key)` groups — always ≥ `entries.length`. */
  readonly groupCount: number;
  /** Number of top entries requested. */
  readonly topN: number;
  /** Top-N groups, sorted by bytes descending. */
  readonly entries: readonly ContextAuditEntry[];
}

export interface ContextAuditInput {
  /** Outer (harness) session id — the transcript is named by it. */
  readonly outerSessionId?: string | null;
  /** How many top entries to emit. Clamped to `[1, CONTEXT_AUDIT_MAX_TOP]`. */
  readonly topN?: number;
  /** Explicit transcript path override (test seam; skips the locator). */
  readonly transcriptPath?: string | null;
  /** Override the too-large threshold (test seam; default 256 MB). */
  readonly maxTranscriptBytes?: number;
  /** Env used to detect the active IDE (default `process.env`). */
  readonly env?: NodeJS.ProcessEnv;
}

export interface ToolUseRef {
  readonly name: string;
  readonly input: unknown;
}

export interface MutableGroup {
  readonly tool: string;
  readonly key: string;
  bytes: number;
  count: number;
}
