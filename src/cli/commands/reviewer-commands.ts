/**
 * `peaks reviewer run` / `peaks reviewer status` — CLI surface for the
 * G4 third-party reviewer. v2.14.0.
 *
 *   peaks reviewer run   --rid <rid> [--json]
 *   peaks reviewer status [--json]
 *
 * The CLI never silently prompts for API keys. When `~/.peaks/config.json`
 * has no `reviewer` section, both commands emit a structured skip envelope
 * and exit 0 (consistent with A4.3 fallbackOnError=skip).
 */
import { Command } from 'commander';
import { runReviewer, REVIEWER_ID, type ReviewerEnvelope } from '../../services/reviewer/reviewer-service.js';
import { loadReviewerConfig } from '../../services/reviewer/reviewer-config.js';
import { deriveModelFamily } from '../../services/reviewer/model-family.js';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';

type RunOptions = { rid?: string; json?: boolean };
type StatusOptions = { json?: boolean };

export function registerReviewerCommands(program: Command, io: ProgramIO): void {
  const reviewer = program
    .command('reviewer')
    .description('Third-party reviewer (v2.14.0 G4 anti-fake-green) — runs an out-of-band model on the slice and emits a schema-validated ReviewerEnvelope.');

  addJsonOption(
    reviewer
      .command('run')
      .description('Run the configured third-party reviewer on a slice.')
      .option('--rid <rid>', 'request id (slice) to review')
  ).action(async (options: RunOptions) => {
    const rid = options.rid ?? '';
    if (rid.length === 0) {
      printResult(
        io,
        fail('reviewer.run', 'MISSING_RID', '--rid is required', null),
        options.json === true
      );
      process.exitCode = 2;
      return;
    }
    const status = loadReviewerConfig();
    if (!status.ok) {
      const envelope: ReviewerEnvelope = {
        reviewerId: REVIEWER_ID,
        modelId: 'skipped',
        modelFamily: 'skipped',
        passed: true,
        violations: [],
        gateAction: 'allow',
        reason: 'skipped: no-reviewer-config (fallbackOnError=skip)'
      };
      printResult(io, ok('reviewer.run', { envelope, reason: status.reason }), options.json === true);
      return;
    }
    const result = await runReviewer({ rid, context: `rid=${rid}` });
    if (result.ok) {
      printResult(io, ok('reviewer.run', { envelope: result.envelope }), options.json === true);
      return;
    }
    printResult(io, fail('reviewer.run', 'NO_REVIEWER_CONFIG', result.reason, null), options.json === true);
  });

  addJsonOption(
    reviewer
      .command('status')
      .description('Show whether the reviewer is configured and which selection mode + provider families are active.')
  ).action((options: StatusOptions) => {
    const status = loadReviewerConfig();
    if (!status.ok) {
      printResult(io, ok('reviewer.status', { configured: false, reason: status.reason }), options.json === true);
      return;
    }
    const families = status.config.providers.map((p) => ({
      name: p.name,
      model: p.model,
      modelFamily: deriveModelFamily(p.model).modelFamily
    }));
    printResult(
      io,
      ok('reviewer.status', {
        configured: true,
        selection: status.config.selection,
        requireDistinctModelFamily: status.config.requireDistinctModelFamily,
        fallbackOnError: status.config.fallbackOnError,
        schemaPath: status.config.schemaPath,
        rdProviderName: status.config.rdProviderName,
        providers: families
      }),
      options.json === true
    );
  });
}
