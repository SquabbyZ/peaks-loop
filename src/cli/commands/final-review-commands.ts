/**
 * `peaks prepare-final-review <rid>` CLI wrapper (W5 Fix M2; real provider
 * binding added by the S3 defect-remediation slice).
 *
 * Exposes the `prepareFinalReview()` service (W2 T9 on
 * `feature/slice-topology-multipass`) via the CLI surface. The service
 * depends on an injected `LlmRunner`; the binding lives in
 * `final-review-prepare-command.ts`:
 *   - `--llm-provider stub` (default) returns a structured "scaffold ready"
 *     envelope WITHOUT calling the service, so CI can verify the route
 *     offline. It performs no review, and says so in every hint it emits.
 *   - `--llm-provider anthropic` binds the real Messages-API runner
 *     (`resolveAnthropicConfig()` + `createAnthropicRunner()`) and runs the
 *     service for real, carrying the 4-dim result back in the envelope.
 *     An absent credential or model raises `LlmBindingError`, reported under
 *     its own error code — never degraded into a scaffold a caller could
 *     mistake for a review.
 * Unknown provider names still fail loudly with
 * `LLM_PROVIDER_NOT_IMPLEMENTED` rather than silently falling back to stub.
 *
 * Per the dev-preference "Default-no on new CLI commands" rule and the
 * W4 T14 spec, this is a NEW top-level command (`prepare-final-review`),
 * not a subcommand of `audit`. The two primitives are distinct:
 *   - `peaks audit goal`   — propose a 6-dim goal from a human need
 *   - `peaks prepare-final-review` — produce a 4-dim review evidence
 *                                  pack for human acceptance
 *
 * This file is the registration module only; the run body it dispatches to
 * lives in `final-review-prepare-command.ts` and the envelope vocabulary in
 * `final-review-command-shared.ts`.
 */

import type { Command } from 'commander';

import { addJsonOption, type ProgramIO } from '../cli-helpers.js';
import {
  DEFAULT_LLM_PROVIDER,
  SUPPORTED_LLM_PROVIDERS,
  type PrepareFinalReviewOptions
} from './final-review-command-shared.js';
import { runPrepareFinalReview } from './final-review-prepare-command.js';

export function registerFinalReviewCommands(program: Command, io: ProgramIO): void {
  addJsonOption(
    program
      .command('prepare-final-review <rid>')
      .description(
        'Prepare the 4-dimension business review (final-review primitive) for human acceptance (W2 T9 service; CLI surface in W5 M2)'
      )
      .requiredOption('--project <path>', 'target project root')
      .requiredOption(
        '--session-id <sid>',
        'session id whose .peaks/_runtime/<sid>/audit-goal/<rid>.json is the approved goal source'
      )
      .option(
        '--llm-provider <name>',
        `LLM provider name: ${SUPPORTED_LLM_PROVIDERS.join(' | ')} (default: ${DEFAULT_LLM_PROVIDER} — performs no review)`,
        DEFAULT_LLM_PROVIDER
      )
      .option(
        '--base <ref>',
        'base ref for the pre/post baseline diff (`existing-functionality-intact`); default: merge-base with origin/HEAD, then origin/main, then origin/master, then HEAD~1 — pass this explicitly when none of those resolve'
      )
  ).action((rid: string, options: PrepareFinalReviewOptions) =>
    runPrepareFinalReview(rid, options, io)
  );
}

// Re-export for tests / external consumers: the envelope vocabulary and the
// types this command's surface is documented with.
export {
  emptyFinalReviewData,
  isSupportedLlmProvider,
  type FinalReviewData,
  type FinalReviewProviderBinding,
  type FinalReviewStatus,
  type PrepareFinalReviewOptions
} from './final-review-command-shared.js';
