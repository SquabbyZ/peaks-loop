/**
 * `src/services/code/compact-event-settle-types.ts`
 *
 * The declaration surface of the `PostCompact` settle path
 * (`compact-event-settle.ts`): the harness's trigger vocabulary, the pathway
 * label it files under, the post-compact reading, and the result shape the
 * hook returns. Extracted verbatim (wave 3, file-size cap campaign) so the
 * settle module stays under the 300 raw-line cap. Types and one label only —
 * no settlement behaviour lives here. `compact-event-settle.ts` imports and
 * re-exports every name below, so importers keep resolving them from
 * `compact-event-settle.js` unchanged.
 */

/** The harness's own report of what caused a compaction. */
export type CompactTrigger = 'manual' | 'auto';

/**
 * Which layer settled the run. `post-compact-hook` = the harness's event;
 * `post-compact-probe` (written by the orchestrator) = a later probe's
 * measurement. The two are deliberately distinct strings so a reader of
 * `compact-history.jsonl` can tell a NOTIFICATION from an INFERENCE — which is
 * the entire instrument this slice exists to build.
 */
export const COMPACT_EVENT_PATHWAY = 'post-compact-hook';

/**
 * One post-compact reading: the ratio, the window it was divided by, and the
 * adapter that produced it — all from a SINGLE probe call, so the three cannot
 * disagree with each other.
 */
export type PostCompactMeasurement = {
  /** `null` = nothing could be measured. Never `0`, which means "unknown". */
  readonly ratio: number | null;
  readonly ide: string;
  readonly windowTokens: number | null;
  readonly windowSource: string | null;
};

export type CompactSettleResult =
  | {
      readonly settled: true;
      readonly runId: string;
      readonly beforeRatio: number;
      /** The measured post-compact ratio, or `null` when none was trustworthy. */
      readonly afterRatio: number | null;
      /** Present only when the harness reported one. */
      readonly trigger?: CompactTrigger;
      /**
       * Whether the `observed` row for this event is on disk. `false` means
       * there is none, for one of two DIFFERENT reasons, told apart by
       * `lifecycleWritten`:
       *
       *   - `lifecycleWritten: true` — the append was attempted and threw.
       *   - `lifecycleWritten: false` — the append was deliberately not made,
       *     because the settle it would describe is one the store never
       *     recorded (see `lifecycleWritten`).
       */
      readonly historyWritten: boolean;
      /**
       * False when the lifecycle record could not be written. The run is then
       * still open, and this path does NOT append the `observed` row: the row
       * would assert a settled measurement for a run the store still holds at
       * `armed` / `compacting`, and each arrival would add another one. The
       * row is deferred rather than lost — the run stays open, so the retry
       * that does land owns the row and measures the ratio at that moment.
       * This is repair R6's answer on the probe path
       * (`auto-compact-orchestrator.ts`), applied here so the two settle
       * paths agree.
       *
       * The two halves are reported separately rather than collapsed: a caller
       * that sees only one of them cannot say which half of the settlement
       * landed.
       */
      readonly lifecycleWritten: boolean;
    }
  | {
      readonly settled: false;
      /**
       * `nothing-to-settle` — there was no open run. `different-session` — the
       * payload named a harness session that is not this project's, so the open
       * run was left alone. The second is a refusal of ATTRIBUTION, not an
       * absence of it, and a reader told "nothing was open" would be told
       * something false.
       */
      readonly reason: 'nothing-to-settle' | 'different-session';
    };
