// Split out of `workspace/init-command.ts`: the
// `ok('workspace.init', …)` data object.
import type { WorkspaceInitContext } from './init-context.js';
import type { CodegraphAutoStakeOutcome, FirstTimeHooksInstallOutcome } from './init-options.js';

export function buildInitEnvelopeData(
  ctx: WorkspaceInitContext,
  hooksOutcome: FirstTimeHooksInstallOutcome,
  codegraphAutoOutcome: CodegraphAutoStakeOutcome | null
): Record<string, unknown> {
  const { report, rotation, projectScanEnvelope, projectScanError } = ctx;
  return {
    ...report,
    // JSON envelope so the LLM and the human both see the swap.
    // Field is omitted (not null) when no rotation fired.
    ...(rotation.previousSessionId !== null && rotation.reason !== null
      ? {
          rotation: {
            previousSessionId: rotation.previousSessionId,
            reason: rotation.reason
          }
        }
      : {}),
    hooksInstall: {
      decision: hooksOutcome.decision,
      action: hooksOutcome.action,
      scope: hooksOutcome.scope,
      ...(hooksOutcome.reason !== undefined ? { reason: hooksOutcome.reason } : {})
    },
    ...(codegraphAutoOutcome !== null ? { codegraphAutoStake: codegraphAutoOutcome } : {}),
    // for the .peaks/project-scan/ bootstrap. Always present
    // (even when skipped / errored) so downstream readers can
    // rely on the shape.
    ...(projectScanEnvelope !== null
      ? {
          projectScan: {
            ...projectScanEnvelope,
            ...(projectScanError !== null ? { error: projectScanError } : {})
          }
        }
      : {})
  };
}
