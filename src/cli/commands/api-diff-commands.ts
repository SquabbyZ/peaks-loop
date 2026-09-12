/**
 * S1 / rid=api-diff-report — `peaks scan api-diff <doc>`.
 *
 * Group choice: `scan`, not a new top-level `api` group. `scan` already hosts
 * `api-surface` — a read-only, `--project`-scoped API analysis that writes no
 * artifact — so `api-diff` is a sibling of an existing command with identical
 * semantics and an identical option shape. A new `peaks api` group would be a
 * brand-new verb family whose cost the design (docs/superpowers/specs/
 * 2026-09-12-frontend-acl-contract-design.md §3/§5) records as medium and
 * acknowledged; nothing about this slice needs it.
 *
 * The command is read-only: it creates no contract artifact and writes no file.
 */

import type { Command } from 'commander';
import { ApiDiffInputError, diffApiDocument, formatApiDiffText } from '../../services/scan/api-diff-service.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';

export function registerApiDiffCommands(program: Command, io: ProgramIO): void {
  // Reuse the existing `scan` parent — the add-a-new-subcommand-check-for-
  // existing-top-level-first rule (same guard as bee-commands / asset-commands).
  const scan = program.commands.find((c) => c.name() === 'scan') ?? program
    .command('scan')
    .description('Read-only project scans for tech-doc and RD handoffs');

  addJsonOption(
    scan
      .command('api-diff')
      .description(
        'Diff an OpenAPI 3.x document (.json/.yaml/.yml) against what this project already recorded — ' +
          'the mock-plan, the recorded *-api.types.ts interfaces, and the TXT handoff endpoint list. ' +
          'Read-only: creates no contract artifact. Output separates an Exact section (both sides parsed) ' +
          'from a Candidate mentions section (name-grep, may over- and under-report), and always prints ' +
          'what this command cannot detect.'
      )
      .argument('<doc>', 'path to the OpenAPI 3.x document (relative to --project, or absolute)')
      .option('--project <path>', 'consumer project root (default: cwd)')
  ).action((doc: string, options: { project?: string; json?: boolean }) => {
    const projectRoot = options.project ?? process.cwd();
    const asJson = options.json ?? false;
    try {
      const report = diffApiDocument({ projectRoot, docPath: doc });
      const nextActions = report.notes.length > 0
        ? ['Read the notes: at least one recorded source was missing, so the Exact section is partial by construction.']
        : [];
      if (asJson) {
        printResult(io, ok('scan.api-diff', report, [], nextActions), true);
        return;
      }
      io.stdout(`${formatApiDiffText(report)}\n`);
    } catch (error) {
      // A non-OpenAPI input must exit non-zero AND produce no diff output — a
      // silent empty report is the exact failure this command exists to prevent.
      const code = error instanceof ApiDiffInputError ? error.code : 'API_DIFF_FAILED';
      printResult(
        io,
        fail('scan.api-diff', code, (error as Error).message, { document: doc }, [
          'Pass a path to an OpenAPI 3.x document: a top-level `openapi: 3.x` string plus a non-empty `paths` object.'
        ]),
        asJson
      );
      process.exitCode = 1;
    }
  });
}
