/**
 *
 *   - `peaks feedback promote <memory-file> [--layer A|B|C] [--dry-run]`
 *   - `peaks feedback check-unpromoted --project <path> [--strict]`
 *
 * Companion to `sops/feedback-promotion-sop.md`. The promote command
 * writes the promotion marker + sidecar + RD envelope, and — for the
 * layers whose artifact it can produce (A: a registered SOP manifest)
 * — the enforcement artifact itself. Layers B and C live in shared
 * files it does not own, so there it records the requirement and
 * reports `effective: false` instead of claiming success.
 *
 * The check-unpromoted command scans `.peaks/memory/*.md` for feedback
 * memories whose promotion is missing OR not backed by its layer's
 * artifact, and emits a structured list. `--strict` flips exit code to
 * non-zero when any is found — used by `peaks workflow verify-pipeline`
 * Gate H.
 */

import type { Command } from 'commander';
import { resolve as resolvePath } from 'node:path';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { getCurrentSessionId } from '../../services/skills/skill-presence-service.js';
import {
  generatePromotionStub,
  isPromotionLayer,
  listPromotionExempt,
  listUnpromotedFeedback,
  missingArtifacts,
  parseFeedbackMemory,
  PROMOTION_LAYER_DETAILS,
  PROMOTION_LAYERS,
  promoteFeedback,
  promotionArtifactChecks
} from '../../services/feedback/feedback-promotion-service.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';

import {
  CHECK_UNPROMOTED_DESCRIPTION,
  FEEDBACK_PARENT_DESCRIPTION,
  formatExemptHint,
  NO_LAYER_NEXT_ACTIONS,
  PROMOTE_DESCRIPTION,
  type FeedbackPromoteOpts,
  UNPROMOTED_NEXT_ACTIONS
} from './feedback-commands-helpers.js';

export function registerFeedbackCommands(program: Command, io: ProgramIO): void {
  const feedback = program.command('feedback').description(FEEDBACK_PARENT_DESCRIPTION);

  addJsonOption(
    feedback
      .command('promote <memory-file>')
      .description(PROMOTE_DESCRIPTION)
      .option('--layer <A|B|C>', `enforcement layer (${PROMOTION_LAYERS.join(' | ')})`)
      .option('--project <path>', 'project root (default: cwd)')
      .option(
        '--promoted-by <id>',
        'identity string for the audit envelope (default: peaks-rd fork agent)'
      )
      .option('--dry-run', 'preview the stub without writing the marker / sidecar / envelope')
  ).action(async (memoryFile: string, opts: FeedbackPromoteOpts) => {
    try {
      const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
      const memoryPath = memoryFile.endsWith('.md')
        ? memoryFile.startsWith('/') || memoryFile.includes(':')
          ? memoryFile
          : resolvePath(projectRoot, memoryFile)
        : resolvePath(projectRoot, '.peaks', 'memory', `${memoryFile}.md`);
      const parsed = parseFeedbackMemory(memoryPath);
      if (parsed === null) {
        printResult(
          io,
          fail(
            'feedback.promote',
            'NOT_A_FEEDBACK_MEMORY',
            `${memoryFile} is not a feedback memory (frontmatter metadata.type must equal "feedback")`,
            { memoryFile, memoryPath },
            [
              'Verify the file is at .peaks/memory/<name>.md and its frontmatter has `metadata: { type: feedback }` or `type: feedback`',
              'Run `peaks memory list --project <path> --json` to see all known memories and their kinds'
            ]
          ),
          opts.json
        );
        process.exitCode = 1;
        return;
      }
      if (opts.dryRun === true) {
        // Preview without choosing a layer: show all three stubs.
        const previews = PROMOTION_LAYERS.map((layer) => {
          const stub = generatePromotionStub({
            layer,
            feedbackName: parsed.name,
            feedbackBody: parsed.body
          });
          return { layer, ...stub };
        });
        printResult(
          io,
          ok(
            'feedback.promote',
            { dryRun: true, name: parsed.name, previews },
            [],
            [
              `Preview generated for feedback "${parsed.name}" — 3 layer options shown above.`,
              'Re-run with --layer <A|B|C> to apply, or --layer <A|B|C> --dry-run to preview a single layer.'
            ]
          ),
          opts.json
        );
        return;
      }
      if (opts.layer === undefined) {
        // No --layer: surface the 3 options as nextActions so the
        // LLM / human can decide. No marker written.
        printResult(
          io,
          ok(
            'feedback.promote',
            {
              name: parsed.name,
              layer: null,
              options: PROMOTION_LAYER_DETAILS
            },
            [],
            NO_LAYER_NEXT_ACTIONS
          ),
          opts.json
        );
        return;
      }
      if (!isPromotionLayer(opts.layer)) {
        printResult(
          io,
          fail(
            'feedback.promote',
            'INVALID_LAYER',
            `--layer must be one of ${PROMOTION_LAYERS.join(' | ')} (got "${opts.layer}")`,
            { provided: opts.layer },
            [`Pass --layer ${PROMOTION_LAYERS.join(' | ')}`]
          ),
          opts.json
        );
        process.exitCode = 1;
        return;
      }
      const layer = opts.layer;
      const sessionId = getCurrentSessionId(projectRoot) ?? 'unknown-sid';
      const promotedBy = opts.promotedBy ?? 'peaks-rd fork agent';
      const envelope = await promoteFeedback({
        feedbackPath: memoryPath,
        layer,
        promotedBy,
        sessionId,
        projectRoot,
        dryRun: false
      });
      // the stub wished for. A promotion whose layer artifact is absent is
      // recorded but NOT effective, and says so with a non-zero exit.
      const notes = [
        `Promoted feedback "${envelope.name}" to layer ${envelope.layer} (${envelope.layerDetail}).`,
        `Generated files: ${envelope.generatedFiles.join(', ')}`,
        `Envelope written to .peaks/_runtime/${sessionId}/rd/feedback-promote-${envelope.name}.json`
      ];
      if (envelope.effective) {
        printResult(io, ok('feedback.promote', envelope, [], notes), opts.json);
        return;
      }
      const missing = missingArtifacts(
        promotionArtifactChecks(envelope.name, envelope.layer),
        projectRoot
      );
      printResult(
        io,
        fail(
          'feedback.promote',
          'PROMOTION_NOT_EFFECTIVE',
          `Promotion recorded but not effective — layer ${envelope.layer} is not backed by its artifact: ${missing.join('; ')}`,
          envelope,
          [
            ...notes,
            ...(envelope.layer === 'C'
              ? [
                  'Layer C lives in source code: register the hard-floor category in src/services/code/mode-gate.ts, then re-run promote to record it.'
                ]
              : ['Apply the snippet to the file(s) named above, then re-run promote to record it.'])
          ]
        ),
        opts.json
      );
      process.exitCode = 1;
    } catch (err) {
      printResult(
        io,
        fail('feedback.promote', 'PROMOTE_FAILED', getErrorMessage(err), { memoryFile }, [
          'Verify the file is a feedback memory and re-run'
        ]),
        opts.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    feedback
      .command('check-unpromoted')
      .description(CHECK_UNPROMOTED_DESCRIPTION)
      .requiredOption('--project <path>', 'project root')
      .option(
        '--strict',
        'exit non-zero when any unpromoted feedback is found (used by verify-pipeline Gate H)'
      )
  ).action((opts: { project: string; strict?: boolean; json?: boolean }) => {
    try {
      const unpromoted = listUnpromotedFeedback({ projectRoot: opts.project });
      const exempt = listPromotionExempt({ projectRoot: opts.project });
      const count = unpromoted.length;
      if (count === 0) {
        printResult(
          io,
          ok(
            'feedback.check-unpromoted',
            { count: 0, unpromoted: [], exempt },
            [],
            [
              `No unpromoted feedback found in .peaks/memory/.`,
              ...(exempt.length === 0 ? [] : [formatExemptHint(exempt)])
            ]
          ),
          opts.json
        );
        return;
      }
      const message = `${count} feedback memor${count === 1 ? 'y is' : 'ies are'} not yet promoted to an enforcement layer.`;
      const nextActions = UNPROMOTED_NEXT_ACTIONS;
      if (opts.strict === true) {
        printResult(
          io,
          fail(
            'feedback.check-unpromoted',
            'UNPROMOTED_FEEDBACK_FOUND',
            message,
            { count, unpromoted, exempt },
            nextActions
          ),
          opts.json
        );
        process.exitCode = 1;
        return;
      }
      printResult(
        io,
        ok(
          'feedback.check-unpromoted',
          { count, unpromoted, exempt },
          [message, ...(exempt.length === 0 ? [] : [formatExemptHint(exempt)])],
          nextActions
        ),
        opts.json
      );
    } catch (err) {
      printResult(
        io,
        fail(
          'feedback.check-unpromoted',
          'CHECK_FAILED',
          getErrorMessage(err),
          { project: opts.project },
          ['Verify --project path and re-run']
        ),
        opts.json
      );
      process.exitCode = 1;
    }
  });
}
