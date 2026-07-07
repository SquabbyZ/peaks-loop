/**
 * peaks bee * CLI — M7 (spec §7A.2 / §10 RL-9 / AC-24 / AC-25 / AC-26).
 *
 * Adds:
 *   peaks bee export --bee <id> --out <path.tar.gz>
 *   peaks bee import --in <path.tar.gz> [--as <bee-name>]
 *
 * The bee-side counterparts of the loop-side `peaks loop export /
 * import`. Same hard rules:
 *
 *   - source `shareable=false` blocks export at the CLI layer.
 *   - bundle lands as `candidate`; promotion to `stable` requires
 *     an `evolution_evaluation` row with an independent
 *     `evaluator_id` (see `peaks evolution evaluate`).
 *
 * The bee bundle captures the bee's inline manifest/segment/file/change
 * rows so the receiver can re-materialize the full bee + any
 * loop↔bee relations that referenced it + any evidence briefs that
 * touched it.
 *
 * The `peaks skill sediment export / import` alias lives in
 * `src/cli/commands/skill-sediment.ts` for one release cycle.
 */

import { Command } from 'commander';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from '../../shared/result.js';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { openStateDb } from '../../services/skillhub/sqlite-store.js';
import {
  writeBundle,
  BundleNotShareableError,
  BundleAssetNotFoundError,
} from '../../services/share/bundle-writer.js';
import {
  readBundle,
  BundleMajorVersionMismatchError,
  BundleSchemaVersionsMismatchError,
  BundleImportToStableForbiddenError,
  BundleMalformedError,
} from '../../services/share/bundle-reader.js';

export function registerBeeCommands(program: Command, io: ProgramIO): void {
  // Reuse the existing `bee` parent if one is registered; the
  // add-a-new-subcommand-check-for-existing-top-level-first rule.
  const existing = program.commands.find((c) => c.name() === 'bee');
  const bee = existing ?? program
    .command('bee')
    .description('M7: peaks bee export / import (spec §7A.2 / §10 RL-9)');

  // ---------- peaks bee export ----------
  addJsonOption(
    bee
      .command('export')
      .description(
        "M7: export a bee_release as a peaks.bundle/1 tarball (spec §7A.2). Refuses to export when shareable=false."
      )
      .requiredOption('--bee <id>', 'bee_release numeric id (use `peaks asset status --bee <name>` to find the id)')
      .requiredOption('--out <path>', 'output .tar.gz path')
      .option('--project <path>', 'target project root (defaults to cwd)')
  ).action((options: { bee: string; out: string; project?: string; json?: boolean }) => {
    const asJson = options.json === true;
    const beeId = Number(options.bee);
    if (!Number.isInteger(beeId) || beeId <= 0) {
      printResult(
        io,
        fail('bee.export', 'INVALID_BEE_ID', `--bee must be a positive integer (got '${options.bee}')`, { bee: options.bee }, [
          'Re-run with --bee <numeric-id>.',
        ]),
        asJson
      );
      process.exitCode = 1;
      return;
    }
    try {
      const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
      if (!existsSync(join(projectRoot, '.peaks'))) {
        mkdirSync(join(projectRoot, '.peaks'), { recursive: true });
      }
      const db = openStateDb(join(projectRoot, '.peaks', 'state.db'));
      try {
        const result = writeBundle({
          db,
          blobsDir: join(projectRoot, '.peaks', 'blobs'),
          kind: 'bee',
          id: beeId,
          outPath: options.out,
        });
        printResult(
          io,
          ok(
            'bee.export',
            {
              outPath: result.outPath,
              kind: result.kind,
              assetId: result.assetId,
              importedAs: 'candidate' as const,
            },
            [],
            [
              `Receiver must run \`peaks bee import --in ${result.outPath}\` to land this bundle, then run an independent evolution_evaluation before any promote.`,
            ]
          ),
          asJson
        );
      } finally {
        db.close();
      }
    } catch (error: unknown) {
      if (error instanceof BundleNotShareableError) {
        printResult(io, fail('bee.export', error.code, error.message, { bee: options.bee } as never, [
          'Set shareable=true on the bee_release row, or stop sharing.',
        ]), asJson);
        process.exitCode = 1;
        return;
      }
      if (error instanceof BundleAssetNotFoundError) {
        printResult(io, fail('bee.export', error.code, error.message, { bee: options.bee } as never, [
          'Verify the bee id with `peaks asset status --bee <name>`.',
        ]), asJson);
        process.exitCode = 1;
        return;
      }
      printResult(io, fail('bee.export', 'BEE_EXPORT_FAILED', getErrorMessage(error), { bee: options.bee } as never, ['Verify --bee id and --out path.']), asJson);
      process.exitCode = 1;
    }
  });

  // ---------- peaks bee import ----------
  addJsonOption(
    bee
      .command('import')
      .description(
        'M7: import a peaks.bundle/1 tarball. Lands as candidate only — promotion requires an evolution_evaluation row (spec §7A.2 / AC-25 / AC-26).'
      )
      .requiredOption('--in <path>', 'input .tar.gz path')
      .option('--as <name>', 'optional rename for the bee name when landing')
      .option('--project <path>', 'target project root (defaults to cwd)')
  ).action((options: { in: string; as?: string; project?: string; json?: boolean }) => {
    const asJson = options.json === true;
    try {
      const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
      if (!existsSync(join(projectRoot, '.peaks'))) {
        mkdirSync(join(projectRoot, '.peaks'), { recursive: true });
      }
      const db = openStateDb(join(projectRoot, '.peaks', 'state.db'));
      try {
        const result = readBundle({
          db,
          blobsDir: join(projectRoot, '.peaks', 'blobs'),
          inPath: options.in,
          ...(options.as !== undefined ? { asName: options.as } : {}),
        });
        printResult(
          io,
          ok(
            'bee.import',
            {
              assetId: result.assetId,
              kind: result.kind,
              importedAs: result.importedAs,
              warnings: result.warnings,
              evidenceBriefCount: result.evidenceBriefCount,
            },
            result.warnings,
            [
              `Run an independent evaluation against this release before promoting; peaks bee promote refuses without an evolution_evaluation row.`,
            ]
          ),
          asJson
        );
      } finally {
        db.close();
      }
    } catch (error: unknown) {
      if (error instanceof BundleMajorVersionMismatchError) {
        printResult(io, fail('bee.import', error.code, error.message, { receivedMajor: error.receivedMajor } as never, [
          'Use the matching peaks.bundle/<major> reader; this peaks build only supports major=1.',
        ]), asJson);
        process.exitCode = 1;
        return;
      }
      if (error instanceof BundleSchemaVersionsMismatchError) {
        printResult(io, fail('bee.import', error.code, error.message, {} as never, [
          'Source bundle did not declare the canonical schema versions; refuse the bundle.',
        ]), asJson);
        process.exitCode = 1;
        return;
      }
      if (error instanceof BundleImportToStableForbiddenError) {
        printResult(io, fail('bee.import', error.code, error.message, {} as never, [
          'Bundles always land as candidate; promotion to stable requires an evolution_evaluation row (AC-26).',
        ]), asJson);
        process.exitCode = 1;
        return;
      }
      if (error instanceof BundleMalformedError) {
        printResult(io, fail('bee.import', error.code, error.message, { inPath: options.in } as never, [
          'Re-export from the source via `peaks bee export`.',
        ]), asJson);
        process.exitCode = 1;
        return;
      }
      printResult(io, fail('bee.import', 'BEE_IMPORT_FAILED', getErrorMessage(error), { inPath: options.in } as never, ['Verify the bundle path and integrity.']), asJson);
      process.exitCode = 1;
    }
  });
}
