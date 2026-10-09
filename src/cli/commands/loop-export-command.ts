// src/cli/commands/loop-export-command.ts
//
// `peaks loop export` (M7, spec §7A.2) — export a loop_release as a
// `peaks.bundle/1` tarball, hard-blocked when the source has `shareable=false`.
// Extracted from `loop-commands.ts`; the registered name, description, options,
// refusal codes and envelope are unchanged.

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { fail, getErrorMessage, ok, type ResultEnvelope } from 'peaks-loop-shared/result';

import { openStateDb } from '../../services/skillhub/sqlite-store.js';
import {
  BundleAssetNotFoundError,
  BundleNotShareableError,
  writeBundle
} from '../../services/share/bundle-writer.js';
import { printResult, type ProgramIO } from '../cli-helpers.js';
import {
  LOOP_EXPORT_IMPORT_OPTS,
  resolveLoopProjectRoot,
  type LoopExportOptions
} from './loop-command-shared.js';

export function registerLoopExportCommand(loop: Command, io: ProgramIO): void {
  LOOP_EXPORT_IMPORT_OPTS(
    loop
      .command('export')
      .description(
        'M7: export a loop_release as a peaks.bundle/1 tarball (spec §7A.2 / §10 RL-9). Refuses to export when shareable=false.'
      )
      .requiredOption('--loop <id>', 'loop_release id (kebab-case)')
      .requiredOption('--out <path>', 'output .tar.gz path')
  ).action((options: LoopExportOptions) => {
    const asJson = options.json === true;
    try {
      const result = exportLoopBundle(options);
      printResult(
        io,
        ok(
          'loop.export',
          {
            outPath: result.outPath,
            kind: result.kind,
            assetId: result.assetId,
            importedAs: 'candidate' as const
          },
          [],
          [
            `Receiver must run \`peaks loop import --in ${result.outPath}\` to land this bundle, then run an independent evolution_evaluation before any promote.`
          ]
        ),
        asJson
      );
    } catch (error: unknown) {
      const refusal: ResultEnvelope<never> =
        exportRefusal(error, options.loop) ??
        fail(
          'loop.export',
          'LOOP_EXPORT_FAILED',
          getErrorMessage(error),
          { ok: false, loop: options.loop } as never,
          ['Verify --loop id and --out path.']
        );
      printResult(io, refusal, asJson);
      process.exitCode = 1;
    }
  });
}

/** Open `<projectRoot>/.peaks/state.db` (creating `.peaks/`) and write the bundle. */
function exportLoopBundle(options: LoopExportOptions): ReturnType<typeof writeBundle> {
  const projectRoot = resolveLoopProjectRoot(options.project);
  if (!existsSync(join(projectRoot, '.peaks'))) {
    mkdirSync(join(projectRoot, '.peaks'), { recursive: true });
  }
  const db = openStateDb(join(projectRoot, '.peaks', 'state.db'));
  try {
    return writeBundle({
      db,
      blobsDir: join(projectRoot, '.peaks', 'blobs'),
      kind: 'loop',
      id: options.loop,
      outPath: options.out
    });
  } finally {
    db.close();
  }
}

/** The two named refusals `writeBundle` raises, or `null` for anything else. */
function exportRefusal(error: unknown, loop: string): ResultEnvelope<never> | null {
  if (error instanceof BundleNotShareableError) {
    return fail('loop.export', error.code, error.message, { ok: false, loop } as never, [
      'Set shareable=true on the loop_release row, or share via desktop_visible=false.'
    ]);
  }
  if (error instanceof BundleAssetNotFoundError) {
    return fail('loop.export', error.code, error.message, { ok: false, loop } as never, [
      'Verify the loop id with `peaks asset status --loop <id>`.'
    ]);
  }
  return null;
}
