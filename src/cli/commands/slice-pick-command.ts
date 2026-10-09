// Split out of `slice-commands.ts`:
// `peaks slice pick <rid>` — the interactive fzf multi-select.
import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { pickSlicesInteractive } from '../../services/slice/slice-pick-service.js';
import { readResult as readDecompositionResult } from '../../services/slice/schema-router.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';

const PICK_DESCRIPTION =
  'Interactively select which candidate slices to ship, via fzf. ' +
  'Reads .peaks/sc/slice-decomposition/<rid>.json, ' +
  'spawns fzf --multi, parses selection, writes -picked.json. ' +
  'Requires fzf >= 0.38. Algorithm is fzf-free; this is the only fzf dependency.';
const PICK_PROJECT_HELP = 'target project root';
const PICK_PREVIEW_HELP = 'render side-by-side preview window in fzf';
const PICK_FZF_BIN_HELP = 'override fzf binary path (default: fzf on PATH)';

type SlicePickOptions = {
  project: string;
  preview?: boolean;
  fzfBin?: string;
  json?: boolean;
};

async function runSlicePick(rid: string, options: SlicePickOptions, io: ProgramIO): Promise<void> {
  try {
    const projectRoot = resolveCanonicalProjectRoot(options.project);
    const decompPath = join(projectRoot, '.peaks', 'sc', 'slice-decomposition', `${rid}.json`);
    if (!existsSync(decompPath)) {
      throw new Error(
        `decomposition not found at ${decompPath}. ` + `Run \`peaks slice decompose ${rid}\` first.`
      );
    }
    const parsed = readDecompositionResult(decompPath);
    if ('schemaVersion' in parsed) {
      throw new Error(
        `decomposition at ${decompPath} is a v2 envelope (schemaVersion: 'v2'). ` +
          `peaks slice pick supports v1 only in peaks-loop 2.9.0. ` +
          `Re-run \`peaks slice decompose ${rid}\` without --granularity to get a v1 file, ` +
          `or upgrade peaks-loop when v2 pick lands.`
      );
    }
    const decomposition = parsed;
    const result = await pickSlicesInteractive(rid, decomposition, projectRoot, {
      ...(options.preview !== undefined ? { preview: options.preview } : {}),
      ...(options.fzfBin ? { fzfBin: options.fzfBin } : {})
    });
    const nextActions: string[] = [
      `Picked ${result.picked.length} slice(s); written to ${result.outputPath}`,
      `Next: peaks slice plan ${rid}  (--apply to call peaks request init for each chosen slice)`
    ];
    printResult(io, ok('slice.pick', result, [], nextActions), options.json ?? false);
  } catch (error) {
    const msg = getErrorMessage(error);
    if (/brew install fzf|apt-get install fzf|older than required/.test(msg)) {
      process.exitCode = 127;
    } else {
      process.exitCode = 1;
    }
    printResult(
      io,
      fail('slice.pick', 'SLICE_PICK_FAILED', msg, { rid, projectRoot: options.project }, [
        'Verify the decomposition file exists, fzf >= 0.38 is on PATH, and the rid is correct'
      ]),
      options.json ?? false
    );
  }
}

export function registerSlicePickCommand(slice: Command, io: ProgramIO): void {
  addJsonOption(
    slice
      .command('pick <rid>')
      .description(PICK_DESCRIPTION)
      .option('--project <path>', PICK_PROJECT_HELP, '.')
      .option('--preview', PICK_PREVIEW_HELP, false)
      .option('--fzf-bin <path>', PICK_FZF_BIN_HELP, 'fzf')
  ).action((rid: string, options: SlicePickOptions) => runSlicePick(rid, options, io));
}
