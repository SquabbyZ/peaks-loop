/**
 * v2.15.0 slice 002 — AC-3: feedback promotion CLI.
 *
 *   - `peaks feedback promote <memory-file> [--layer A|B|C] [--dry-run]`
 *   - `peaks feedback check-unpromoted --project <path> [--strict]`
 *
 * Companion to `sops/feedback-promotion-sop.md`. The promote command
 * generates a stub for the chosen enforcement layer (A: peaks-sop
 * gate, B: peaks-hooks PreToolUse, C: mode-gate hardFloorCategory)
 * and writes the promotion marker + sidecar + RD envelope. The
 * check-unpromoted command scans `.peaks/memory/*.md` for feedback
 * memories without a promotion marker and emits a structured list.
 * `--strict` flips exit code to non-zero when any unpromoted feedback
 * is found — used by `peaks workflow verify-pipeline` Gate H.
 */

import type { Command } from 'commander';
import { resolve as resolvePath } from 'node:path';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { getCurrentSessionId } from '../../services/skills/skill-presence-service.js';
import {
  generatePromotionStub,
  isPromotionLayer,
  listUnpromotedFeedback,
  parseFeedbackMemory,
  PROMOTION_LAYER_DETAILS,
  PROMOTION_LAYERS,
  promoteFeedback,
  type PromotionLayer
} from '../../services/feedback/feedback-promotion-service.js';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';

export function registerFeedbackCommands(program: Command, io: ProgramIO): void {
  const feedback = program
    .command('feedback')
    .description('v2.15.0 slice 002 AC-3: promote user-given feedback memories to peaks-cli enforcement layers (A: sop, B: hooks, C: hard-floor).');

  addJsonOption(
    feedback
      .command('promote <memory-file>')
      .description(
        'Promote a feedback memory to one of the 3 enforcement layers (A=peaks-sop gate, B=peaks-hooks PreToolUse, C=mode-gate hardFloorCategory). ' +
          'Reads `.peaks/memory/<file>.md`, generates a code stub for the chosen layer, and writes ' +
          'the promotion marker (HTML comment + sidecar .promotion.json) + an RD envelope at ' +
          '`.peaks/_runtime/<sid>/rd/feedback-promote-<name>.json`. ' +
          'Without --layer, the CLI lists the 3 layer options as nextActions and exits with code 0 ' +
          '(use --layer <A|B|C> to actually promote, or pass --dry-run to preview the stub).'
      )
      .option('--layer <A|B|C>', `enforcement layer (${PROMOTION_LAYERS.join(' | ')})`)
      .option('--project <path>', 'project root (default: cwd)')
      .option('--promoted-by <id>', 'identity string for the audit envelope (default: peaks-rd fork agent)')
      .option('--dry-run', 'preview the stub without writing the marker / sidecar / envelope')
  ).action(
    (memoryFile: string, opts: { layer?: string; project?: string; promotedBy?: string; dryRun?: boolean; json?: boolean }) => {
      try {
        const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
        const memoryPath = memoryFile.endsWith('.md')
          ? (memoryFile.startsWith('/') || memoryFile.includes(':'))
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
              [
                'No --layer passed. Choose one of A / B / C and re-run.',
                'A: append to sops/*.md (procedural rules)',
                'B: append a matcher to .peaks/.claude-settings-template.json (tool-call interception)',
                'C: extend HardFloorCategory in mode-gate.ts (always pauses regardless of mode)',
                'Or pass --dry-run to preview all three stubs first.'
              ]
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
        const layer = opts.layer as PromotionLayer;
        const sessionId = getCurrentSessionId(projectRoot) ?? 'unknown-sid';
        const promotedBy = opts.promotedBy ?? 'peaks-rd fork agent';
        const envelope = promoteFeedback({
          feedbackPath: memoryPath,
          layer,
          promotedBy,
          sessionId,
          projectRoot,
          dryRun: false
        });
        printResult(
          io,
          ok(
            'feedback.promote',
            envelope,
            [],
            [
              `Promoted feedback "${envelope.name}" to layer ${envelope.layer} (${envelope.layerDetail}).`,
              `Generated files: ${envelope.generatedFiles.join(', ')}`,
              `Envelope written to .peaks/_runtime/${sessionId}/rd/feedback-promote-${envelope.name}.json`
            ]
          ),
          opts.json
        );
      } catch (err) {
        printResult(
          io,
          fail('feedback.promote', 'PROMOTE_FAILED', getErrorMessage(err), { memoryFile }, ['Verify the file is a feedback memory and re-run']),
          opts.json
        );
        process.exitCode = 1;
      }
    }
  );

  addJsonOption(
    feedback
      .command('check-unpromoted')
      .description(
        'Scan `.peaks/memory/*.md` and list feedback memories without a promotion marker. ' +
          'Default: dry-run (exit 0, just warn). Pass --strict to fail with exit code 1 when any ' +
          'unpromoted feedback is found — this is what `peaks workflow verify-pipeline` Gate H uses.'
      )
      .requiredOption('--project <path>', 'project root')
      .option('--strict', 'exit non-zero when any unpromoted feedback is found (used by verify-pipeline Gate H)')
  ).action(
    (opts: { project: string; strict?: boolean; json?: boolean }) => {
      try {
        const unpromoted = listUnpromotedFeedback({ projectRoot: opts.project });
        const count = unpromoted.length;
        if (count === 0) {
          printResult(
            io,
            ok(
              'feedback.check-unpromoted',
              { count: 0, unpromoted: [] },
              [],
              [`No unpromoted feedback found in .peaks/memory/.`]
            ),
            opts.json
          );
          return;
        }
        const message = `${count} feedback memor${count === 1 ? 'y is' : 'ies are'} not yet promoted to an enforcement layer.`;
        const nextActions = [
          `Run \`peaks feedback promote <memory-file> --layer <A|B|C>\` for each entry above.`,
          'A = peaks-sop gate, B = peaks-hooks PreToolUse, C = mode-gate hardFloorCategory.',
          'See sops/feedback-promotion-sop.md for the SOP and the layer-choice rubric.'
        ];
        if (opts.strict === true) {
          printResult(
            io,
            fail(
              'feedback.check-unpromoted',
              'UNPROMOTED_FEEDBACK_FOUND',
              message,
              { count, unpromoted },
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
            { count, unpromoted },
            [message],
            nextActions
          ),
          opts.json
        );
      } catch (err) {
        printResult(
          io,
          fail('feedback.check-unpromoted', 'CHECK_FAILED', getErrorMessage(err), { project: opts.project }, ['Verify --project path and re-run']),
          opts.json
        );
        process.exitCode = 1;
      }
    }
  );
}
