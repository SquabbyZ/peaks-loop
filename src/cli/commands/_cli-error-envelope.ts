// Slice 015 — single source of truth for translating a thrown error from
// the service layer (createRdSwarmPlan, createTechPlan, etc.) into a CLI
// envelope code + user-facing nextActions.
//
// Lives under src/cli/commands/ (private to the CLI surface; underscore
// prefix marks it as not-an-exported-CLI-subcommand per the project
// convention). Used by every CLI handler that wraps a service call in a
// try/catch — currently the four catches in workflow-commands.ts.
//
// Pre-slice behavior: all four catches emitted a fixed `INVALID_GOAL`
// envelope code, regardless of the actual error class. Provider-config
// failures (`ProviderNotConfiguredError`) were silently re-labelled as
// "invalid goal", hiding real config issues behind a misleading hint.
//
// Post-slice behavior: the helper routes errors into one of three envelope
// codes based on the runtime error class/message. The CLI catch sites
// become data-only — they call the helper, then format the envelope.
import { ProviderNotConfiguredError } from '../../services/config/model-routing.js';

export type EnvelopeMapping =
  | { code: 'INVALID_GOAL'; nextActions: readonly string[] }
  | { code: 'INVALID_PROVIDERS'; nextActions: readonly string[] }
  | { code: 'INTERNAL_ERROR'; nextActions: readonly string[] };

// Slice 015 risk A: goal-validation uses a substring match on the error
// message thrown by `validatePlanningInput`. If validatePlanningInput's
// message wording changes in a future slice, this branch silently
// degrades into INTERNAL_ERROR. Mitigated by the helper's unit test
// pinning the literal substring.
// Slice 015 — match the goal-validation throw message. The current
// `validatePlanningInput` literal is `"Goal must be non-empty"` (capital
// G, "non-empty" with hyphen). The regex tolerates common wording
// variations (`must be non-empty`, `must not be empty`, case-insensitive)
// so a future message tweak still routes correctly; the unit test below
// pins the *current* literal substring so any wording change fails loudly.
const GOAL_VALIDATION_MESSAGE_RE = /goal.{0,4}(must be non-empty|must not be empty)/i;

/**
 * Map a thrown error into an envelope code + nextActions hint. Pure
 * function — no IO, no state. Safe to call from any CLI handler.
 *
 * @param error - any value that may have been thrown (we only inspect
 *                `.message` for goal-validation; everything else is
 *                routed by class).
 */
export function mapServiceError(error: unknown): EnvelopeMapping {
  if (error instanceof ProviderNotConfiguredError) {
    return {
      code: 'INVALID_PROVIDERS',
      nextActions: ['Configure provider model: peaks config provider <id> set --model <id>'],
    };
  }
  if (error instanceof Error && GOAL_VALIDATION_MESSAGE_RE.test(error.message)) {
    return { code: 'INVALID_GOAL', nextActions: ['Use a non-empty goal'] };
  }
  return { code: 'INTERNAL_ERROR', nextActions: ['See errorId for trace'] };
}
