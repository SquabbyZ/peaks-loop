/**
 * Slice 2026-07-29-dispatch-stall-governance / S5 — bounded stage
 * vocabulary.
 *
 * Why a bounded enum (not a free-form string):
 *   - a free-form `stage` recreates the `note` field, which already
 *     exists and did not solve visibility.
 *   - the watch surface renders a stage label inline (`role 30%
 *     (5s ago) [planning]`); an unbounded vocabulary would let typos
 *     and near-duplicates spread across the swarm.
 *   - the LLM-side runner can validate the stage at write time
 *     (`setStage` rejects unknown values with `INVALID_STAGE`).
 *
 * The enum is intentionally small and stable. Adding a new stage is a
 * deliberate code change (this file + the `setStage` validation) so a
 * future user cannot accidentally flood the watch with `awaiting-coffee`
 * or `idk`.
 *
 * `null` is NOT a stage — it is the absence of a stage. Records that
 * have not yet been promoted carry `stage: null`; the watch surface
 * renders no marker.
 */

export const STAGE_LABELS = [
  'intake',
  'planning',
  'gathering',
  'analyzing',
  'writing',
  'testing',
  'reviewing',
  'finalizing'
] as const;

export type StageLabel = (typeof STAGE_LABELS)[number];

export const DEFAULT_STAGE_LABELS: readonly StageLabel[] = STAGE_LABELS;

export function isStageLabel(value: unknown): value is StageLabel {
  return typeof value === 'string' && (STAGE_LABELS as readonly string[]).includes(value);
}

export function normalizeStage(value: string | null | undefined): StageLabel | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (isStageLabel(trimmed)) return trimmed;
  return null;
}