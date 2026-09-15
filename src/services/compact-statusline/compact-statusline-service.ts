// src/services/compact-statusline/compact-statusline-service.ts
//
// Slice 2026-08-01-compact-lifecycle (Task 3/5). Pure semantic
// decision + render helper for the 'peaks statusline compact'
// indicator. Reads .peaks/_runtime/<sessionId>/compact-lifecycle.json
// first (the canonical source of truth) and falls back to the legacy
// auto-compact-pending.json + compact-history.jsonl only when the
// lifecycle record is missing.
//
// Decision priority (explicit, no implicit fall-through):
//   1. lifecycle missing  → fall back to legacy (pending → queued,
//      a recent `observed` history row → completed WITHOUT an invented
//      after-ratio, else none)
//   2. lifecycle invalid  → 'invalid' (NEVER fall back to legacy
//      — a corrupted lifecycle is not a green progress bar)
//   3. lifecycle valid    → map stage to filledCells via the
//      documented cell table
//   4. lifecycle stalled  → 'stalled' kind, retains the cell that
//      the active stage was holding
//
// Cell mapping (frozen first-version contract):
//   queued     → 0 cells
//   preparing  → 2 cells
//   compacting → 4 cells
//   verifying  → 6 cells
//   completed  → 8 cells
//   failed     → keep the failedAt cell (default to compacting = 4)
//   none       → 0 cells
//   invalid    → 0 cells (no false reassurance)
//   stalled    → keep the active stage's cell
//   armed      → NO bar at all (slice 2026-09-12-compact-band-policy):
//                a registered-but-idle trigger has no progress to
//                report, and a bar would imply one.
//
// Render contract: the rendered label is a fixed-width 8-cell bar
// (`[████░░░░]` filled from the left). NO `?` characters. NO guessed
// ratios. After-ratio is only rendered when the lifecycle record
// carries a real one; otherwise the bar shows a stable "no
// measurement" hint.

import { existsSync, readFileSync } from 'node:fs';
import { getSessionDir } from '../session/getSessionDir.js';
import { AUTO_COMPACT_RED_LINE_RATIO } from '../context/auto-compact-types.js';
import { readCompactHistory } from '../compact-history/compact-history-service.js';
import {
  readCompactLifecycle,
  type CompactLifecycleRecord,
  type CompactLifecycleStage,
} from './compact-lifecycle-store.js';

export type CompactDisplayKind =
  | 'none'
  | 'queued'
  | 'preparing'
  | 'compacting'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'stalled'
  | 'invalid'
  | 'armed';

export interface CompactStatuslineState {
  readonly kind: CompactDisplayKind;
  // eslint-disable-next-line no-magic-numbers -- type-position literal union for the cell-table contract
  readonly filledCells: 0 | 2 | 4 | 6 | 8;
  readonly triggerRatio?: number;
  readonly afterRatio?: number;
  readonly redLine?: boolean;
  readonly failedAt?: CompactLifecycleStage;
  readonly detail?: string;
}

/**
 * Concrete first-version stale timeout. Adjustable after real timing
 * evidence from the auto-compact orchestrator (it currently writes a
 * heartbeat on every state transition; 120 s is the longest realistic
 * gap between a heartbeat and an actual stall).
 */
const DEFAULT_STALE_AFTER_MS = 120_000;

/**
 * 10-second completed-window expiry. The brief (Task 6 design requirement)
 * calls out: once a compact lifecycle reaches `completed`, the primary
 * statusline should surface the success indicator for at most 10 seconds,
 * then fall back to the C1 baseline so the consumer (the IDE) does not
 * keep a green ✓ pinned on the status bar indefinitely. The narrow window
 * is sufficient for the human to see "we just compacted" and long enough
 * to not flap on subsequent reads. Adjustable after real timing feedback.
 */
export const COMPLETED_EXPIRY_MS = 10_000;

/**
 * How recently the last history row must itself have been written for the
 * legacy path to report it as "just compacted". Measured against the row's own
 * `ts` — the fact — rather than the file's mtime, which is only a proxy for it
 * and is also moved by rows that record no compaction (repair R9).
 */
const LEGACY_JUST_COMPACTED_WINDOW_MS = 30_000;

// PRD-002b slice 2 — extract cell-table magic numbers (4/6/8) into named
// consts so the no-magic-numbers lint rule stops flagging the typed
// literal-union cell-table values. Values match the documented contract.
const STAGE_CELL_COMPACTING = 4;
const STAGE_CELL_VERIFYING = 6;
const STAGE_CELL_COMPLETED = 8;

/* eslint-disable no-magic-numbers -- cell-table contract uses literal-type unions (`0 | 2 | 4 | 6 | 8`); these are type-position discriminators, not runtime values. Magic-number extraction is done at the runtime call sites via STAGE_CELL_* constants above. */
const CELL_BY_STAGE: ReadonlyMap<CompactLifecycleStage, 0 | 2 | 4 | 6 | 8> = new Map<
  CompactLifecycleStage,
  0 | 2 | 4 | 6 | 8
>([
  ['queued', 0],
  ['preparing', 2],
  ['compacting', STAGE_CELL_COMPACTING],
  ['verifying', STAGE_CELL_VERIFYING],
  ['completed', STAGE_CELL_COMPLETED],
  ['failed', STAGE_CELL_COMPACTING],
  // `armed` is not in the cell table: it renders WITHOUT a bar (see
  // renderCompactStatusline). Lookups therefore miss and fall back to 0.
]);

const FILLED = '█';
const EMPTY = '░';
const BAR_WIDTH = STAGE_CELL_COMPLETED;
const NO_AFTER_RATIO_HINT = 'after-ratio not recorded';

function renderBar(filledCells: 0 | 2 | 4 | 6 | 8): string {
  return `[${FILLED.repeat(filledCells)}${EMPTY.repeat(BAR_WIDTH - filledCells)}]`;
}

function renderLegacyBar(filledCells: 0 | 2 | 4 | 6 | 8): string {
  return renderBar(filledCells);
}
/* eslint-enable no-magic-numbers */

export function decideCompactStatusline(input: {
  readonly projectRoot: string;
  readonly sessionId: string | null;
  readonly now: number;
  readonly staleAfterMs?: number;
  readonly completedExpiryMs?: number;
}): CompactStatuslineState {
  const staleAfterMs = input.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const completedExpiryMs = input.completedExpiryMs ?? COMPLETED_EXPIRY_MS;

  if (input.sessionId === null) {
    return { kind: 'none', filledCells: 0 };
  }

  const sessionDir = getSessionDir(input.projectRoot, input.sessionId);

  // Priority 1: lifecycle reads. Lifecycle is the canonical source of
  // truth; invalid is non-recoverable in this decision layer.
  const lifecycle = readCompactLifecycle({
    projectRoot: input.projectRoot,
    sessionId: input.sessionId,
    nowMs: input.now,
    staleAfterMs,
  });

  if (lifecycle.kind === 'valid') {
    // 10-second completed-expiry: once a compact lifecycle reaches
    // `completed`, the primary statusline should surface the success
    // indicator for at most COMPLETED_EXPIRY_MS (10s), then fall back to
    // the C1 baseline so the IDE does not keep a green ✓ pinned on the
    // status bar indefinitely. The narrow window is sufficient for the
    // human to see "we just compacted" and long enough to not flap on
    // subsequent reads. The narrow read of `updatedAt` is intentional: we
    // surface the truth ("the run completed") and immediately expire
    // rather than carrying forward a stale green check.
    //
    // Note: the expiry applies ONLY to `kind: 'completed'`. The `failed`
    // stage is deliberately PERSISTENT — the orchestrator writes a single
    // terminal `failed` record and the user (or the next slice's QA gate)
    // needs to see it on the statusline until the next lifecycle write
    // clears it. Expiring a failed record would silently hide a real
    // failure from the human and is a NO-GO. The `stalled` failure mode
    // is distinct and is computed by the lifecycle store (not here).
    if (lifecycle.record.stage === 'completed') {
      const updatedAtMs = Date.parse(lifecycle.record.updatedAt);
      if (!Number.isNaN(updatedAtMs) && input.now - updatedAtMs > completedExpiryMs) {
        return { kind: 'none', filledCells: 0 };
      }
    }
    return stateFromLifecycle(lifecycle.record);
  }

  if (lifecycle.kind === 'stalled') {
    return stateFromStalled(lifecycle.record);
  }

  if (lifecycle.kind === 'invalid') {
    return {
      kind: 'invalid',
      filledCells: 0,
      detail: lifecycle.reason,
    };
  }

  // lifecycle.kind === 'missing' → fall back to legacy files.
  return decideLegacyFallback({
    projectRoot: input.projectRoot,
    sessionId: input.sessionId,
    sessionDir,
    now: input.now,
  });
}

function stateFromLifecycle(record: CompactLifecycleRecord): CompactStatuslineState {
  if (record.stage === 'failed') {
    const failedAt = record.failedAt ?? 'compacting';
    const state: CompactStatuslineState = {
      kind: 'failed',
      filledCells: CELL_BY_STAGE.get(failedAt) ?? STAGE_CELL_COMPACTING,
      triggerRatio: record.triggerRatio,
      redLine: record.redLine,
      failedAt,
    };
    if (record.errorSummary !== undefined) {
      return { ...state, detail: record.errorSummary };
    }
    return state;
  }
  const filledCells = CELL_BY_STAGE.get(record.stage) ?? 0;
  const base: CompactStatuslineState = {
    kind: record.stage,
    filledCells,
    triggerRatio: record.triggerRatio,
    redLine: record.redLine,
  };
  if (record.stage === 'completed' && typeof record.afterRatio === 'number') {
    return { ...base, afterRatio: record.afterRatio };
  }
  return base;
}

function stateFromStalled(record: CompactLifecycleRecord): CompactStatuslineState {
  const filledCells = CELL_BY_STAGE.get(record.stage) ?? STAGE_CELL_COMPACTING;
  const detailText = record.stage === 'failed'
    ? record.errorSummary
    : `no heartbeat for ${record.stage} stage`;
  const state: CompactStatuslineState = {
    kind: 'stalled',
    filledCells,
    triggerRatio: record.triggerRatio,
    redLine: record.redLine,
  };
  if (detailText !== undefined) {
    return { ...state, detail: detailText };
  }
  return state;
}

function decideLegacyFallback(input: {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly sessionDir: string;
  readonly now: number;
}): CompactStatuslineState {
  const { sessionDir, now } = input;
  const pendingPath = `${sessionDir}/txt/auto-compact-pending.json`;
  const historyPath = `${sessionDir}/compact-history.jsonl`;

  // Priority 1 within legacy: a pending intent.
  if (existsSync(pendingPath)) {
    try {
      const raw = readFileSync(pendingPath, 'utf8');
      const parsed = JSON.parse(raw) as { pending?: boolean; ratio?: number; redLine?: boolean };
      if (parsed.pending === true) {
        return {
          kind: 'queued',
          filledCells: 0,
          ...(typeof parsed.ratio === 'number' ? { triggerRatio: parsed.ratio } : {}),
          ...(parsed.redLine === true ? { redLine: true } : {}),
          detail: pendingPath,
        };
      }
    } catch {
      // fall through to history check
    }
  }

  // Priority 2 within legacy: a history row TESTIFIES that a compaction was
  // witnessed, recently enough to still be the one being reported.
  //
  // Repair R9 (AC4). This used to read the file's mtime — freshness taken as
  // evidence that "a compact just landed". Freshness is evidence of neither:
  // the same file takes a `dispatch` row every time peaks-loop ASKS for a
  // compact, and an ask is an intent, not an outcome. One real session
  // (2026-09-13, ~15.5 h) holds 1075 dispatch rows and ZERO compactions
  // (`auto-compact-orchestrator.ts`), so a fresh file was the NORMAL state of a
  // session in which nothing had compacted at all — and each of those asks
  // painted this 8-cell "completed" bar.
  //
  // So the row's own testimony is read instead, through the same reader the CLI
  // uses. Only `kind: 'observed'` means a compaction was witnessed (a row with
  // no `kind` is a dispatch — every pre-`kind` row is one), and the row's `ts`
  // is the moment compared, not the filesystem's.
  //
  // Repair R11. The testimony is looked for in EVERY row inside the window, not
  // only in the last one. Reading the last row alone made the indicator depend
  // on the ASK: a `dispatch` row lands on every probe, so an `observed` row
  // stopped counting the moment peaks-loop asked again — `[observed, dispatch]`
  // one second apart answered `none` for a compaction that had just been
  // witnessed — i.e. it deleted the very indicator the mtime read had shown,
  // the one the replacement was meant to keep honest. A `dispatch` row alone
  // still testifies
  // to nothing (the direction R9 closed): what is required is an `observed` row
  // inside the window, wherever in the file it sits.
  try {
    // The reader answers `file-missing` / `empty` itself; the `catch` is for the
    // read itself, which it does not guard.
    const read = readCompactHistory({ projectRoot: input.projectRoot, sessionId: input.sessionId });
    const witnessed =
      read.kind === 'ok' &&
      read.events.some(
        (row) => row.kind === 'observed' && now - Date.parse(row.ts) <= LEGACY_JUST_COMPACTED_WINDOW_MS
      );
    if (witnessed) {
      // CRITICAL: no invented after-ratio. The row may carry a measured
      // afterRatio, but this is the legacy path and we honour the
      // "no measurement" default.
      return {
        kind: 'completed',
        filledCells: 8,
        detail: historyPath,
      };
    }
  } catch {
    // fall through to idle
  }

  return { kind: 'none', filledCells: 0 };
}

/**
 * Plain-text render: the cell bar + a small annotation. The bar is
 * always the fixed-width 8-cell shape `[████░░░░]`. After-ratio is
 * only rendered when the lifecycle record carries a real one.
 *
 * The output never contains `?` characters — we never guess a ratio.
 */
export function renderCompactStatusline(state: CompactStatuslineState): string {
  switch (state.kind) {
    case 'none':
      return `compact ${renderLegacyBar(0)}`;
    case 'queued':
      return `compact ${renderLegacyBar(0)}${state.redLine === true ? ' (redLine)' : ''}`;
    case 'preparing':
      return `compact ${renderBar(2)}`;
    case 'compacting':
      return `compact ${renderBar(STAGE_CELL_COMPACTING)}`;
    // Slice 2026-09-12-compact-band-policy: a registered trigger that has
    // not fired is NOT progress. Rendering a bar would imply movement
    // that is not happening, so `armed` deliberately renders no bar at
    // all — the label states what is true and what would change it.
    case 'armed':
      return `compact armed${formatArmedRatio(state)} — fires in-band at ${arRedLinePct()}`;
    case 'verifying':
      return `compact ${renderBar(STAGE_CELL_VERIFYING)}`;
    case 'completed':
      return formatCompleted(state);
    case 'failed':
      return formatFailed(state);
    case 'stalled':
      return formatStalled(state);
    case 'invalid':
      return formatInvalid(state);
  }
}

/** The red-line ratio the armed trigger waits for, as a display percentage. */
function arRedLinePct(): string {
  return `${Math.round(AUTO_COMPACT_RED_LINE_RATIO * 100)}%`;
}

/** ` (88% now)` when the opening trigger ratio is known; empty otherwise. */
function formatArmedRatio(state: CompactStatuslineState): string {
  return typeof state.triggerRatio === 'number'
    ? ` (${Math.round(state.triggerRatio * 100)}% now)`
    : '';
}

function formatCompleted(state: CompactStatuslineState): string {
  const bar = renderBar(STAGE_CELL_COMPLETED);
  if (typeof state.afterRatio === 'number') {
    return `compact ${bar} → ${state.afterRatio.toFixed(2)}`;
  }
  return `compact ${bar} (${NO_AFTER_RATIO_HINT})`;
}

function formatFailed(state: CompactStatuslineState): string {
  const filledAt = state.failedAt ?? 'compacting';
  const cells = CELL_BY_STAGE.get(filledAt) ?? STAGE_CELL_COMPACTING;
  const bar = renderBar(cells);
  const detail = state.detail ? ` — ${state.detail}` : '';
  return `compact ${bar} failed at ${filledAt}${detail}`;
}

function formatStalled(state: CompactStatuslineState): string {
  const bar = renderBar(state.filledCells);
  const detail = state.detail ? ` — ${state.detail}` : '';
  return `compact ${bar} stalled${detail}`;
}

function formatInvalid(state: CompactStatuslineState): string {
  return `compact status unreadable: ${state.detail ?? 'lifecycle record malformed'}`;
}
