/**
 * peaks loop * CLI (Slice #14 + M7 add).
 *
 * Slices:
 *   #14 sub-features (L4 Agent Loop integration): distill / preflight /
 *     detect-pattern / check-consistency / peaks goal compose.
 *
 *   M7 (2026-07-07 spec §7A.2):
 *     peaks loop export --loop <id> --out <path.tar.gz>
 *     peaks loop import --in <path.tar.gz> [--as <loop-id>]
 *
 * `peaks loop export` reads the source loop_release + relations +
 * related bees + evidence briefs and emits a `peaks.bundle/1`
 * tar.gz. Hard-blocks when the source has `shareable=false`.
 *
 * `peaks loop import` extracts a bundle, validates
 * format_version_major=1, and lands the release as `candidate`
 * (mandatory landing status per spec §7A.2). The receiver must run
 * an independent evaluation before promoting to `stable`.
 *
 * The existing 14.x commands are kept under the same `loop` parent;
 * M7 only ADDs export / import — it does not modify the existing
 * surface.
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

type LoopDistillOptions = {
  project: string;
  apply: boolean;
  json?: boolean;
};

type LoopPreflightOptions = {
  project: string;
  json?: boolean;
};

type LoopDetectPatternOptions = {
  project: string;
  json?: boolean;
};

type LoopCheckConsistencyOptions = {
  project: string;
  json?: boolean;
};

type GoalComposeOptions = {
  project: string;
  goal: string;
  json?: boolean;
};

export function registerLoopCommands(program: Command, io: ProgramIO): void {
  // 14.5 peaks goal compose — registered as a TOP-LEVEL command (not under
  // `peaks loop`) because IDE adapters expose it as `goalCommand`.
  // The sub-agent dispatch path consumes it; the slice 0.7 hermes +
  // openclaw adapters will thread it through.
  addJsonOption(
    program
      .command('goal')
      .description('14.5: compose an autonomous goal (returns the goal envelope that the LLM-side UX layer feeds to peaks sub-agent dispatch)')
      .requiredOption('--project <path>', 'target project root')
      .requiredOption('--goal <text>', 'the high-level goal to compose')
  ).action(async (options: GoalComposeOptions) => {
    try {
      printResult(io, ok('goal.compose', {
        project: options.project,
        goal: options.goal,
        status: 'placeholder',
        nextSteps: [
          'The composed goal is consumed by peaks sub-agent dispatch.',
          'The hermes + openclaw IDE adapters (Slice #0.7) surface this as a goalCommand.',
        ],
      }, [], [
        'goal.compose is a thin facade; the LLM-side UX layer decomposes the goal into sub-agent tasks.',
      ]), options.json);
    } catch (error) {
      printResult(
        io,
        fail('goal.compose', 'GOAL_COMPOSE_FAILED', getErrorMessage(error), { project: options.project, goal: options.goal }, ['Verify the project path and --goal value']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  // peaks loop *
  const loop = program.command('loop').description('Slice #14: L4 Agent Loop sub-features (distill / preflight / detect-pattern / check-consistency)');

  // 14.1 distill
  addJsonOption(
    loop.command('distill')
      .description('14.1: distill patterns from past sessions into .peaks/memory/ (delegates to peaks memory extract)')
      .requiredOption('--project <path>', 'target project root')
      .option('--apply', 'write extracted memories to .peaks/memory/ (default: dry-run preview)', false)
  ).action(async (options: LoopDistillOptions) => {
    try {
      const apply = options.apply === true;
      // Delegate to the existing peaks memory extract CLI via dynamic
      // import (avoids circular); the LLM-side UX layer composes the
      // two commands.
      const { execFileSync } = await import('node:child_process') as typeof import('node:child_process');
      const args = ['memory', 'extract', '--project', options.project];
      if (apply) args.push('--apply');
      const stdout = execFileSync('node', ['bin/peaks.js', ...args], {
        cwd: options.project,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).toString('utf-8');
      printResult(io, ok('loop.distill', {
        project: options.project,
        apply,
        delegateStdout: stdout.slice(0, 200),
      }, [], [
        apply ? 'peaks memory extract --apply was invoked' : 'peaks memory extract dry-run was invoked',
        'A future slice will inline the memory extract (not via execFileSync).',
      ]), options.json);
    } catch (error) {
      printResult(
        io,
        fail('loop.distill', 'LOOP_DISTILL_FAILED', getErrorMessage(error), { project: options.project }, ['Verify the project path']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  // 14.2 preflight
  addJsonOption(
    loop.command('preflight')
      .description('14.2: pre-run sanity checks (placeholder; future slice runs peaks doctor + peaks audit before each loop iter)')
      .requiredOption('--project <path>', 'target project root')
  ).action(async (options: LoopPreflightOptions) => {
    printResult(io, ok('loop.preflight', {
      project: options.project,
      status: 'placeholder',
      nextSteps: [
        'For each L4 loop iteration, call peaks doctor + peaks audit to surface regressions.',
        'A future slice will inline the preflight checks (not just placeholder).',
      ],
    }, [], [
      'loop.preflight is a thin facade; the LLM-side UX layer composes peaks doctor + peaks audit.',
    ]), options.json);
  });

  // 14.3 detect-pattern
  addJsonOption(
    loop.command('detect-pattern')
      .description('14.3: detect repeating patterns across past sessions (placeholder; future slice uses peaks retrospective search)')
      .requiredOption('--project <path>', 'target project root')
  ).action(async (options: LoopDetectPatternOptions) => {
    printResult(io, ok('loop.detect-pattern', {
      project: options.project,
      status: 'placeholder',
      nextSteps: [
        'Run peaks retrospective search --limit 50 to surface high-frequency patterns.',
        'A future slice will rank by frequency + LLM confidence.',
      ],
    }, [], [
      'loop.detect-pattern is a thin facade; the LLM-side UX layer composes peaks retrospective search.',
    ]), options.json);
  });

  // 14.4 check-consistency
  addJsonOption(
    loop.command('check-consistency')
      .description('14.4: verify state consistency (placeholder; future slice compares .peaks/_runtime across sessions)')
      .requiredOption('--project <path>', 'target project root')
  ).action(async (options: LoopCheckConsistencyOptions) => {
    printResult(io, ok('loop.check-consistency', {
      project: options.project,
      status: 'placeholder',
      nextSteps: [
        'Compare .peaks/_runtime/<sid>/session.json across recent sessions for drift.',
        'A future slice will report drift with severity (warn / fail).',
      ],
    }, [], [
      'loop.check-consistency is a thin facade; the LLM-side UX layer composes the drift scan.',
    ]), options.json);
  });

  // ---------- M7: peaks loop export / import (spec §7A.2) ----------
  const LOOP_EXPORT_IMPORT_OPTS = (cmd: Command): Command =>
    cmd
      .option('--project <path>', 'target project root (defaults to cwd)')
      .option('--json', 'print machine-readable JSON envelope');

  LOOP_EXPORT_IMPORT_OPTS(
    loop
      .command('export')
      .description(
        "M7: export a loop_release as a peaks.bundle/1 tarball (spec §7A.2 / §10 RL-9). Refuses to export when shareable=false."
      )
      .requiredOption('--loop <id>', 'loop_release id (kebab-case)')
      .requiredOption('--out <path>', 'output .tar.gz path')
  ).action((options: { loop: string; out: string; project?: string; json?: boolean }) => {
    const asJson = options.json === true;
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
          kind: 'loop',
          id: options.loop,
          outPath: options.out,
        });
        printResult(
          io,
          ok('loop.export', {
            outPath: result.outPath,
            kind: result.kind,
            assetId: result.assetId,
            importedAs: 'candidate' as const,
          }, [], [
            `Receiver must run \`peaks loop import --in ${result.outPath}\` to land this bundle, then run an independent evolution_evaluation before any promote.`,
          ]),
          asJson
        );
      } finally {
        db.close();
      }
    } catch (error: unknown) {
      if (error instanceof BundleNotShareableError) {
        printResult(io, fail('loop.export', error.code, error.message, { ok: false, loop: options.loop } as never, [
          'Set shareable=true on the loop_release row, or share via desktop_visible=false.',
        ]), asJson);
        process.exitCode = 1;
        return;
      }
      if (error instanceof BundleAssetNotFoundError) {
        printResult(io, fail('loop.export', error.code, error.message, { ok: false, loop: options.loop } as never, [
          'Verify the loop id with `peaks asset status --loop <id>`.',
        ]), asJson);
        process.exitCode = 1;
        return;
      }
      printResult(io, fail('loop.export', 'LOOP_EXPORT_FAILED', getErrorMessage(error), { ok: false, loop: options.loop } as never, ['Verify --loop id and --out path.']), asJson);
      process.exitCode = 1;
    }
  });

  LOOP_EXPORT_IMPORT_OPTS(
    loop
      .command('import')
      .description(
        "M7: import a peaks.bundle/1 tarball. Lands as candidate only — promotion requires an evolution_evaluation row (spec §7A.2 / §10 RL-9 / AC-25 / AC-26)."
      )
      .requiredOption('--in <path>', 'input .tar.gz path')
      .option('--as <id>', 'optional rename for the loop id when landing')
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
          ok('loop.import', {
            assetId: result.assetId,
            kind: result.kind,
            importedAs: result.importedAs,
            warnings: result.warnings,
            evidenceBriefCount: result.evidenceBriefCount,
          }, result.warnings, [
            `Run an independent evaluation against this release before promoting; peaks loop promote refuses without an evolution_evaluation row.`,
          ]),
          asJson
        );
      } finally {
        db.close();
      }
    } catch (error: unknown) {
      if (error instanceof BundleMajorVersionMismatchError) {
        printResult(io, fail('loop.import', error.code, error.message, { ok: false, receivedMajor: error.receivedMajor } as never, [
          'Use the matching peaks.bundle/<major> reader; this peaks build only supports major=1.',
        ]), asJson);
        process.exitCode = 1;
        return;
      }
      if (error instanceof BundleSchemaVersionsMismatchError) {
        printResult(io, fail('loop.import', error.code, error.message, { ok: false } as never, [
          'Source bundle did not declare the canonical schema versions; refuse the bundle.',
        ]), asJson);
        process.exitCode = 1;
        return;
      }
      if (error instanceof BundleImportToStableForbiddenError) {
        printResult(io, fail('loop.import', error.code, error.message, { ok: false } as never, [
          'Bundles always land as candidate; promotion to stable requires an evolution_evaluation row (AC-26).',
        ]), asJson);
        process.exitCode = 1;
        return;
      }
      if (error instanceof BundleMalformedError) {
        printResult(io, fail('loop.import', error.code, error.message, { ok: false, inPath: options.in } as never, [
          'Re-export from the source via `peaks loop export`.',
        ]), asJson);
        process.exitCode = 1;
        return;
      }
      printResult(io, fail('loop.import', 'LOOP_IMPORT_FAILED', getErrorMessage(error), { ok: false, inPath: options.in } as never, ['Verify the bundle path and integrity.']), asJson);
      process.exitCode = 1;
    }
  });
}
