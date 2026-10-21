// src/cli/commands/batch-item-input.ts
//
// The batch's item list as the CALLER knows it, and the record row it
// becomes.
//
// Split out of `batch-diagnose-command.ts` to honor the repo's file-size
// cap. The two share no logic: this one is the INPUT vocabulary and how it
// is read and validated; that one is the action.
//
// WHY THE CALLER SUPPLIES THE ITEMS. They are facts about the user's
// request that only the caller holds — the labels, the symptoms, and which
// of them have already been diagnosed. The CLI reads them; it does not
// invent them.
//
// WHY THE STATUS IS EXPLICIT. `diagnosed` means the file set was MEASURED
// and `pending` means a diagnostician still has to produce one. Nothing is
// inferred from an absent field, because an item whose diagnosis found NO
// files is still diagnosed — an absent `files` array would read as
// "not measured" and send it round the diagnosis loop again.
//
// WHY THE SYMPTOM IS CARRIED ON THE RECORD. The symptom is the item's
// INPUT, not a measurement: the diagnosis prompt is built from it, and the
// report the diagnostician produces is an answer to it. Keeping it on the
// record is what lets a batch that resumes after a compaction still ask the
// question.

import { readFileSync } from 'node:fs';
import { z } from 'zod';

import type { BatchItem, BatchItemStatus } from '../../services/batch/batch-progress-types.js';
import { RISK_SURFACE_MAX } from '../../services/race/pilot-gate-store.js';

/**
 * One item as the caller knows it.
 *
 * `files` and `riskSurface` are the measured results and are carried
 * forward onto the record; the risk surface is bounded by the same number
 * the race lane's own gate uses.
 */
const batchItemInputSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  symptom: z.string().min(1),
  status: z.enum(['pending', 'diagnosed']),
  files: z.array(z.string()).optional(),
  riskSurface: z.number().int().min(1).max(RISK_SURFACE_MAX).optional()
});

const batchInputSchema = z.object({
  items: z.array(batchItemInputSchema).min(1)
});

export type BatchItemInput = z.infer<typeof batchItemInputSchema>;

/** The parsed item list, or the reason it could not be read. */
export type ParsedItems =
  | { readonly kind: 'ok'; readonly items: readonly BatchItemInput[] }
  | { readonly kind: 'invalid'; readonly message: string };

/** The options this command reads. */
export interface BatchDiagnoseOptions {
  readonly rid?: string;
  readonly project?: string;
  readonly items?: string;
  readonly itemsJson?: string;
  readonly json?: boolean;
}

/**
 * Read the caller's item list, from a file or from inline JSON.
 *
 * The two shapes are the same shape (`wave-plan` reads its slices the same
 * way), and a refusal here names WHICH shape was wrong rather than throwing
 * a parse error at the caller.
 */
export function readItems(options: BatchDiagnoseOptions): ParsedItems {
  const inline = options.itemsJson;
  const path = options.items;
  if (inline === undefined && path === undefined) {
    return { kind: 'invalid', message: 'no items supplied' };
  }
  let text: string;
  if (inline !== undefined) {
    text = inline;
  } else {
    try {
      text = readFileSync(path as string, 'utf8');
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { kind: 'invalid', message: `cannot read the items file: ${detail}` };
    }
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { kind: 'invalid', message: `the items are not valid JSON: ${detail}` };
  }
  const result = batchInputSchema.safeParse(parsed);
  if (!result.success) {
    return {
      kind: 'invalid',
      message: `the items do not match the expected shape: ${result.error.message}`
    };
  }
  return { kind: 'ok', items: result.data.items };
}

/**
 * Whether a recorded item still carries the question it has to be asked.
 *
 * An item without a symptom cannot be diagnosed: there is nothing to
 * diagnose. It is named rather than dispatched with a substitute, because a
 * prompt whose "Reported symptom" line holds the item's LABEL would ask the
 * diagnostician the wrong question and report a confident answer to it.
 */
export function hasSymptom(item: BatchItem): item is BatchItem & { readonly symptom: string } {
  return typeof item.symptom === 'string' && item.symptom.length > 0;
}

/** The record row for one item: what the caller measured, carried forward. */
export function toBatchItem(input: BatchItemInput): BatchItem {
  const base = {
    id: input.id,
    label: input.label,
    symptom: input.symptom,
    status: input.status as BatchItemStatus,
    files: input.files ?? []
  };
  if (input.riskSurface === undefined) return base;
  return { ...base, riskSurface: input.riskSurface };
}
