/**
 * `peaks sub-agent wave-plan` — slice 2026-09-10-dispatch-token-and-swarm §3.
 *
 * Nested under the existing `sub-agent` verb (no new top-level verb, per the
 * project-level rule that users never learn a new CLI surface; the LLM runs
 * this on their behalf).
 *
 * Input: slice descriptors `{ slices: [{ id, files: [...] }] }` from a JSON
 * file (`--slices <file>`) or inline (`--slices-json '<json>'`).
 *
 * Output: a machine-readable wave plan where every wave's slices have
 * pairwise-disjoint file sets, plus the per-slice deferral reason naming the
 * colliding file. The orchestrator uses this to fan out a level in parallel
 * WITHOUT serializing on a shared file — the deferred slices simply run in
 * the next wave.
 */
import type { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { getErrorMessage, ok, fail } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import {
  planFileOverlapWaves,
  type SliceFileDescriptor
} from '../../services/dispatch/file-overlap-wave-planner.js';

export interface WavePlanOptions {
  slices?: string;
  slicesJson?: string;
  json?: boolean;
}

export function registerWavePlanCommand(parent: Command, io: ProgramIO): void {
  addJsonOption(
    parent
      .command('wave-plan')
      .description(
        '§3 file-overlap-aware scheduling: read slice descriptors ' +
        '({slices:[{id,files:[]}]}) and emit a wave plan where every wave is ' +
        'pairwise file-disjoint. Overlapping slices are deferred to later ' +
        'waves with the colliding file named. Machine-readable envelope; the ' +
        'LLM runs this, users never type it.'
      )
      .option('--slices <file>', 'path to a JSON file: { "slices": [{ "id": "s1", "files": ["src/a.ts"] }] }')
      .option('--slices-json <json>', 'inline JSON with the same shape as --slices')
  ).action((options: WavePlanOptions) => {
    const asJson = options.json === true;
    const source: SlicesSource | null = typeof options.slicesJson === 'string' && options.slicesJson.length > 0
      ? { text: options.slicesJson }
      : typeof options.slices === 'string' && options.slices.length > 0
        ? readSlicesFile(options.slices)
        : null;
    if (source === null) {
      printResult(io, fail('sub-agent.wave-plan', 'MISSING_INPUT',
        'pass --slices <file> or --slices-json <json>',
        { ok: false, waves: [] } as never,
        ['Provide slice descriptors as { "slices": [{ "id": "s1", "files": ["src/a.ts"] }] }.']),
        asJson);
      process.exitCode = 1;
      return;
    }
    if (source.error !== undefined) {
      printResult(io, fail('sub-agent.wave-plan', 'INVALID_INPUT', source.error,
        { ok: false, waves: [] } as never,
        ['Check the JSON shape: { "slices": [{ "id": string, "files": string[] }] }.']),
        asJson);
      process.exitCode = 1;
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(source.text);
    } catch (err) {
      printResult(io, fail('sub-agent.wave-plan', 'INVALID_JSON', `input is not valid JSON: ${getErrorMessage(err)}`,
        { ok: false, waves: [] } as never,
        ['Fix the JSON syntax and re-run.']),
        asJson);
      process.exitCode = 1;
      return;
    }

    const descriptors = coerceDescriptors(parsed);
    if (descriptors === null) {
      printResult(io, fail('sub-agent.wave-plan', 'INVALID_SHAPE',
        'expected { "slices": [{ "id": string, "files": string[] }] }',
        { ok: false, waves: [] } as never,
        ['Each entry needs a non-empty string id and an array of file paths.']),
        asJson);
      process.exitCode = 1;
      return;
    }

    const plan = planFileOverlapWaves(descriptors);
    const warnings = plan.duplicateIds.length > 0
      ? [`DUPLICATE_SLICE_IDS: ${plan.duplicateIds.join(', ')} (first descriptor wins; the rest were not scheduled)`]
      : [];
    printResult(io, ok('sub-agent.wave-plan', {
      envelopeVersion: '2.1.0',
      ok: true,
      sliceCount: plan.sliceCount,
      waveCount: plan.waves.length,
      waves: plan.waves,
      duplicateIds: plan.duplicateIds,
      maxParallelism: plan.waves.reduce((max, w) => Math.max(max, w.slices.length), 0)
    }, warnings, [
      plan.waves.length <= 1
        ? 'All slices are file-disjoint: dispatch them in a single wave.'
        : `Dispatch wave 0 first, then each later wave after its predecessors finish; the deferred[] entries name the blocking file.`
    ]), asJson);
  });
}

interface SlicesSource {
  readonly text: string;
  readonly error?: string;
}

function readSlicesFile(path: string): SlicesSource {
  try {
    return { text: readFileSync(path, 'utf8') };
  } catch (err) {
    return { text: '', error: `cannot read --slices file ${path}: ${getErrorMessage(err)}` };
  }
}

function coerceDescriptors(parsed: unknown): readonly SliceFileDescriptor[] | null {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const raw = (parsed as { slices?: unknown }).slices;
  if (!Array.isArray(raw)) return null;
  const out: SliceFileDescriptor[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return null;
    const id = (item as { id?: unknown }).id;
    const files = (item as { files?: unknown }).files;
    if (typeof id !== 'string' || id.length === 0) return null;
    if (files !== undefined && (!Array.isArray(files) || files.some((f) => typeof f !== 'string'))) {
      return null;
    }
    out.push({ id, files: (files as string[] | undefined) ?? [] });
  }
  return out;
}
