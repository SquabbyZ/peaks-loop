// Split out of `workspace/init-command.ts`: the
// `ok('workspace.init', …)` data object.
import type { WorkspaceInitContext } from './init-context.js';
import type { CodegraphAutoStakeOutcome, FirstTimeHooksInstallOutcome } from './init-options.js';
import type { HarnessCompactThresholdResult } from '../../../services/context/harness-compact-threshold-ensure.js';

export function buildInitEnvelopeData(
  ctx: WorkspaceInitContext,
  hooksOutcome: FirstTimeHooksInstallOutcome,
  codegraphAutoOutcome: CodegraphAutoStakeOutcome | null,
  harnessThresholdOutcome: HarnessCompactThresholdResult | null = null
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
    // The harness pair (window + percent) `init` just reconciled. Omitted, not
    // null, when the adapter declares no such knobs ("not applicable" and "tried
    // and failed" differ; the failure half rides `warnings`).
    //
    // Carried AS IS: the service layer bounds every settings-file value at its
    // source (MED-2), so each half already holds `previousRawNote`. No mapping
    // here — a result that never holds the plaintext cannot leak it, even to a
    // consumer that logs the returned object itself.
    ...(harnessThresholdOutcome !== null
      ? {
          harnessThreshold: {
            settingsPath: harnessThresholdOutcome.settingsPath,
            window: harnessThresholdOutcome.window,
            percent: harnessThresholdOutcome.percent
          }
        }
      : {}),
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
