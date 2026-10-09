// src/cli/commands/loop-import-command.ts
//
// `peaks loop import` (M7, spec §7A.2) — extract a `peaks.bundle/1` tarball and
// land it as `candidate` only; promotion needs an evolution_evaluation row.
// Extracted from `loop-commands.ts`; the registered name, description, options,
// refusal codes and envelope are unchanged.

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { fail, getErrorMessage, ok, type ResultEnvelope } from 'peaks-loop-shared/result';

import { openStateDb } from '../../services/skillhub/sqlite-store.js';
import {
  BundleImportToStableForbiddenError,
  BundleMajorVersionMismatchError,
  BundleMalformedError,
  BundleSchemaVersionsMismatchError,
  readBundle,
  type ReadBundleResult
} from '../../services/share/bundle-reader.js';
import { printResult, type ProgramIO } from '../cli-helpers.js';
import {
  LOOP_EXPORT_IMPORT_OPTS,
  resolveLoopProjectRoot,
  type LoopImportOptions
} from './loop-command-shared.js';

export function registerLoopImportCommand(loop: Command, io: ProgramIO): void {
  LOOP_EXPORT_IMPORT_OPTS(
    loop
      .command('import')
      .description(
        'M7: import a peaks.bundle/1 tarball. Lands as candidate only — promotion requires an evolution_evaluation row (spec §7A.2 / §10 RL-9 / AC-25 / AC-26).'
      )
      .requiredOption('--in <path>', 'input .tar.gz path')
      .option('--as <id>', 'optional rename for the loop id when landing')
  ).action((options: LoopImportOptions) => {
    const asJson = options.json === true;
    try {
      const result = importLoopBundle(options);
      printResult(
        io,
        ok(
          'loop.import',
          {
            assetId: result.assetId,
            kind: result.kind,
            importedAs: result.importedAs,
            warnings: result.warnings,
            evidenceBriefCount: result.evidenceBriefCount
          },
          result.warnings,
          [
            'Run an independent evaluation against this release before promoting; peaks loop promote refuses without an evolution_evaluation row.'
          ]
        ),
        asJson
      );
    } catch (error: unknown) {
      const refusal: ResultEnvelope<never> =
        importRefusal(error, options.in) ??
        fail(
          'loop.import',
          'LOOP_IMPORT_FAILED',
          getErrorMessage(error),
          { ok: false, inPath: options.in } as never,
          ['Verify the bundle path and integrity.']
        );
      printResult(io, refusal, asJson);
      process.exitCode = 1;
    }
  });
}

/** Open `<projectRoot>/.peaks/state.db` (creating `.peaks/`) and read the bundle in. */
function importLoopBundle(options: LoopImportOptions): ReadBundleResult {
  const projectRoot = resolveLoopProjectRoot(options.project);
  if (!existsSync(join(projectRoot, '.peaks'))) {
    mkdirSync(join(projectRoot, '.peaks'), { recursive: true });
  }
  const db = openStateDb(join(projectRoot, '.peaks', 'state.db'));
  try {
    return readBundle({
      db,
      blobsDir: join(projectRoot, '.peaks', 'blobs'),
      inPath: options.in,
      ...(options.as !== undefined ? { asName: options.as } : {})
    });
  } finally {
    db.close();
  }
}

/**
 * The four named bundle refusals, each with the action its reader earned, or
 * `null` for anything else. The `data` each carries differs (`receivedMajor` on
 * a version mismatch, `inPath` on a malformed bundle), so the branches are a
 * flat guard chain rather than a table with a `data` callback.
 */
function importRefusal(error: unknown, inPath: string): ResultEnvelope<never> | null {
  if (error instanceof BundleMajorVersionMismatchError) {
    return fail(
      'loop.import',
      error.code,
      error.message,
      { ok: false, receivedMajor: error.receivedMajor } as never,
      ['Use the matching peaks.bundle/<major> reader; this peaks build only supports major=1.']
    );
  }
  if (error instanceof BundleSchemaVersionsMismatchError) {
    return fail('loop.import', error.code, error.message, { ok: false } as never, [
      'Source bundle did not declare the canonical schema versions; refuse the bundle.'
    ]);
  }
  if (error instanceof BundleImportToStableForbiddenError) {
    return fail('loop.import', error.code, error.message, { ok: false } as never, [
      'Bundles always land as candidate; promotion to stable requires an evolution_evaluation row (AC-26).'
    ]);
  }
  if (error instanceof BundleMalformedError) {
    return fail('loop.import', error.code, error.message, { ok: false, inPath } as never, [
      'Re-export from the source via `peaks loop export`.'
    ]);
  }
  return null;
}
