// Split out of `slice-commands.ts`:
// `peaks slice plan <rid>` plus the `-picked.json` envelope router it reads.
// The action was 59 code lines; the plan builders and the two failure arms are
// their own functions so each stays inside the 50-code-line cap.
import type { Command } from 'commander';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';

const PLAN_DESCRIPTION =
  'Apply a picked batch: read -picked.json, call `peaks request init` for each chosen slice ' +
  'with --depends-on edges from the decomposition. Dry-run by default; pass --apply to ' +
  'actually create rids.';
const PLAN_PROJECT_HELP = 'target project root';
const PLAN_APPLY_HELP = 'actually call peaks request init (default: dry-run only)';
const PLAN_PICKED_MISSING_HINT =
  'Verify the picked file exists, the rid is correct, and peaks request init is available';
const PLAN_PICKED_ENVELOPE_TOO_LONG =
  'Verify the -picked.json envelope matches the schema: { rid: string, picked: Array<{ rid, files: string[], label }> }';

type SlicePlanOptions = { project: string; apply?: boolean; json?: boolean };

type PlanEntry = {
  newRid: string;
  type: 'feat';
  dependsOn: string[];
  files: readonly string[];
  label: string;
  applied: boolean;
};

type PlanTarget = { rid: string; projectRoot: string; pickedPath: string };

// ---------- picked envelope router (W6 fix) ----------

interface PickedEnvelope {
  readonly rid: string;
  readonly picked: readonly {
    readonly rid: string;
    readonly files: readonly string[];
    readonly label: string;
  }[];
}

/**
 * Validate a -picked.json envelope. Throws a CLI-friendly Error on any
 * shape violation; the catch in the slice.plan action converts it to
 * a fail() envelope with `code: 'PICKED_ENVELOPE_INVALID'`.
 *
 * Schema:
 *   { rid: string; picked: Array<{ rid, files: string[], label }> }
 *
 * Rejects: missing rid, missing/invalid picked array, picked[i] missing
 * rid / files / label, picked[i].files empty.
 */
export function parsePickedFile(pickedPath: string): PickedEnvelope {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(pickedPath, 'utf8'));
  } catch (err) {
    // JSON.parse errors are always Error-shaped (SyntaxError extends Error),
    // so the cast is safe; we only need `.message`.
    throw new Error(
      `picked envelope at ${pickedPath} is not valid JSON: ${(err as Error).message}`
    );
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`picked envelope at ${pickedPath} must be a JSON object, got ${typeof raw}`);
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.rid !== 'string' || obj.rid.length === 0) {
    throw new Error(`picked envelope at ${pickedPath} is missing required string field 'rid'`);
  }
  if (!Array.isArray(obj.picked)) {
    throw new Error(`picked envelope at ${pickedPath} is missing required array field 'picked'`);
  }
  const picked = obj.picked.map((item, idx) => {
    if (typeof item !== 'object' || item === null) {
      throw new Error(`picked[${idx}] must be an object, got ${typeof item}`);
    }
    const it = item as Record<string, unknown>;
    if (typeof it.rid !== 'string' || it.rid.length === 0) {
      throw new Error(`picked[${idx}] is missing required string field 'rid'`);
    }
    if (!Array.isArray(it.files) || it.files.length === 0) {
      throw new Error(`picked[${idx}] is missing or has empty required array field 'files'`);
    }
    if (!it.files.every((f) => typeof f === 'string')) {
      throw new Error(`picked[${idx}].files must contain only strings`);
    }
    if (typeof it.label !== 'string' || it.label.length === 0) {
      throw new Error(`picked[${idx}] is missing required string field 'label'`);
    }
    return { rid: it.rid, files: it.files, label: it.label };
  });
  return { rid: obj.rid, picked };
}

function buildPlanEntries(rid: string, picked: PickedEnvelope): PlanEntry[] {
  return picked.picked.map((slice, idx) => ({
    newRid: `${rid}-${idx + 1}-${slice.rid}`,
    type: 'feat' as const,
    dependsOn: idx === 0 ? [] : [picked.picked[idx - 1]!.rid],
    files: slice.files,
    label: slice.label,
    applied: false
  }));
}

function slicePlanNextActions(picked: PickedEnvelope, options: SlicePlanOptions): string[] {
  return [
    `Planned ${picked.picked.length} new rids from ${picked.picked.length} picked slices`,
    options.apply
      ? 'Apply mode: would call peaks request init for each (v1.1: wire to spawn child)'
      : 'Dry-run: pass --apply to actually create the rids (v1.1: wire to peaks request init spawn)'
  ];
}

function printSlicePlanFailure(
  io: ProgramIO,
  options: SlicePlanOptions,
  target: PlanTarget,
  error: unknown
): void {
  const msg = getErrorMessage(error);
  const isEnvelopeError = msg.startsWith('picked envelope at');
  printResult(
    io,
    fail(
      'slice.plan',
      isEnvelopeError ? 'PICKED_ENVELOPE_INVALID' : 'SLICE_PLAN_FAILED',
      msg,
      { rid: target.rid, projectRoot: options.project, pickedPath: target.pickedPath },
      isEnvelopeError ? [PLAN_PICKED_ENVELOPE_TOO_LONG] : [PLAN_PICKED_MISSING_HINT]
    ),
    options.json ?? false
  );
  process.exitCode = 1;
}

function runSlicePlan(rid: string, options: SlicePlanOptions, io: ProgramIO): void {
  const projectRoot = resolveCanonicalProjectRoot(options.project);
  const pickedPath = join(projectRoot, '.peaks', 'sc', 'slice-decomposition', `${rid}-picked.json`);
  try {
    if (!existsSync(pickedPath)) {
      throw new Error(
        `picked file not found at ${pickedPath}. ` +
          `Run \`peaks slice pick ${rid}\` first, or manually craft the file.`
      );
    }
    const picked = parsePickedFile(pickedPath);
    const plan = buildPlanEntries(rid, picked);
    printResult(
      io,
      ok(
        'slice.plan',
        { parentRid: rid, plan, apply: options.apply ?? false },
        [],
        slicePlanNextActions(picked, options)
      ),
      options.json ?? false
    );
  } catch (error) {
    printSlicePlanFailure(io, options, { rid, projectRoot, pickedPath }, error);
  }
}

export function registerSlicePlanCommand(slice: Command, io: ProgramIO): void {
  addJsonOption(
    slice
      .command('plan <rid>')
      .description(PLAN_DESCRIPTION)
      .option('--project <path>', PLAN_PROJECT_HELP, '.')
      .option('--apply', PLAN_APPLY_HELP, false)
  ).action((rid: string, options: SlicePlanOptions) => runSlicePlan(rid, options, io));
}
