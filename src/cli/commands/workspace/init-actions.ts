// Split out of `workspace/init-command.ts`: the
// `nextActions` and `warnings` a successful `peaks workspace init` accumulates.
// Order is load-bearing — the envelope prints both arrays verbatim — so the
// collectors are invoked in exactly the sequence the original action used.
import type { WorkspaceInitReport } from '../../../services/workspace/workspace-service.js';
import { clearStalePresenceOnRotation } from '../../../services/skills/skill-presence-service.js';
import { gcStalePresenceLeases } from '../../../services/skills/presence-lease-service.js';
import {
  hasStandardsCheckedMarker,
  markStandardsChecked
} from '../../../services/standards/missing-standards-detector.js';
import { getErrorMessage } from '../../cli-helpers.js';
import { stakeCodegraphForInit } from './init-codegraph-stake.js';
import { resolveFirstTimeHooksInstall } from './init-hooks-decision.js';
import type { WorkspaceInitContext } from './init-context.js';
import type {
  CodegraphAutoStakeOutcome,
  FirstTimeHooksInstallOutcome,
  WorkspaceInitRotation
} from './init-options.js';

export type InitEnvelopeParts = {
  nextActions: string[];
  warnings: string[];
  hooksOutcome: FirstTimeHooksInstallOutcome;
  codegraphAutoOutcome: CodegraphAutoStakeOutcome | null;
};

function pushBindingReplacedAction(nextActions: string[], report: WorkspaceInitReport): void {
  if (report.previousSessionId !== null && report.bound) {
    nextActions.push(
      `Replaced prior session binding "${report.previousSessionId}" with "${report.sessionId}".`
    );
  }
}

/**
 * Outer-session-mismatch rotation: the previous Claude / harness
 * session is no longer the LLM driver. The new binding is fresh,
 * the old session dir is preserved on disk.
 *
 * The OLD outer session is now stale (defect A from the PRD). peaks-code
 * Step 1 would otherwise pick up the old `mode` field and silently lock the
 * new session into a mode the user never explicitly chose. Clear it here so
 * Step 1's presence:check-stale reports `reason: 'no-presence'` and the re-ask
 * fires.
 */
function pushRotationActions(
  nextActions: string[],
  rotation: WorkspaceInitRotation,
  projectRoot: string,
  sessionId: string
): void {
  if (rotation.previousSessionId === null || rotation.reason !== 'outer-session-mismatch') return;
  nextActions.push(
    `Auto-rotated session binding: outer session id changed (was "${rotation.previousSessionId}"). ` +
      `New binding is "${sessionId}". The previous session dir is preserved at .peaks/_runtime/${rotation.previousSessionId}/. ` +
      `Re-run with --no-rotate-on-outer-mismatch to suppress this rotation.`
  );
  const presenceClearOutcome = clearStalePresenceOnRotation({
    projectRootOverride: projectRoot,
    currentOuterSessionId: process.env.PEAKS_OUTER_SESSION_ID ?? process.env.CLAUDE_CODE_SESSION_ID,
    rotatedOutSessionId: rotation.previousSessionId
  });
  if (presenceClearOutcome.cleared) {
    nextActions.push(
      `Auto-cleared stale skill presence (recorded outer id "${presenceClearOutcome.recordedOuter ?? '?'}" did not match the new outer session). ` +
        'peaks-code Step 1 will now AskUserQuestion to confirm the mode.'
    );
  } else if (presenceClearOutcome.reason === 'recorded-by-different-outer') {
    nextActions.push(
      `Kept skill presence: it was recorded by a different live outer session (id "${presenceClearOutcome.recordedOuter ?? '?'}"). ` +
        'The new outer session will not auto-clear it.'
    );
  } else if (presenceClearOutcome.reason === 'not-stale') {
    nextActions.push(
      'Kept skill presence: it was re-stamped by the new outer session during the rotation window (not stale).'
    );
  }
}

function pushCreatedAction(nextActions: string[], report: WorkspaceInitReport): void {
  if (report.created.length === 0) {
    nextActions.push('Workspace already initialized — proceed to project scan.');
    return;
  }
  nextActions.push(
    'Run `peaks scan archetype --project <path> --json` next to populate rd/project-scan.md.'
  );
}

/**
 * Slice 2.0.1-bug3-fact-forcing-bypass: surface the consumer-project
 * .claude/settings.local.json materialization outcome. When the bypass is in
 * effect, the LLM knows subsequent Writes and Bash calls targeting .peaks/**
 * will not be blocked by the [Fact-Forcing Gate]. When the user opted out, we
 * surface a nextAction so the manual recovery is documented.
 *
 * The `refreshed` offline-template nextAction also carries a loud warning that
 * any MANUAL EDITS the user made to the offline template have been overwritten
 * — drift detection cannot tell stale-from-prior-release apart from
 * user-customised, so we surface the warning unconditionally to make sure
 * anyone who customised sees the prompt.
 */
function pushSettingsActions(nextActions: string[], report: WorkspaceInitReport): void {
  if (report.claudeSettings.action === 'written' || report.claudeSettings.action === 'refreshed') {
    nextActions.push(
      `Materialized .claude/settings.local.json (action: ${report.claudeSettings.action}) — ` +
        `the [Fact-Forcing Gate] is bypassed for tool calls inside .peaks/**. ` +
        'Restart Claude Code so the hooks take effect.'
    );
  } else if (report.claudeSettings.action === 'already-current') {
    // No-op: the bypass is already in effect and matches the
    // current release. Do not spam the nextAction list on every
    // init.
  } else if (report.claudeSettings.action === 'skipped') {
    nextActions.push(
      'Skipped .claude/settings.local.json materialization (--no-claude-hooks). ' +
        'If the [Fact-Forcing Gate] blocks subsequent Writes, run `peaks workspace init` ' +
        'again without --no-claude-hooks, or drop the contents of ' +
        '`.peaks/.claude-settings-template.json` into `.claude/settings.local.json` manually.'
    );
  }

  if (report.claudeSettings.offlineTemplate.action === 'refreshed') {
    nextActions.push(
      `Self-healed .peaks/.claude-settings-template.json (action: refreshed) — ` +
        'the offline recovery anchor now matches the current peaks-loop template. ' +
        'No action required; future manual recoveries will copy the corrected wrapper.'
    );
    nextActions.push(
      '⚠️  If you had manually edited .peaks/.claude-settings-template.json, ' +
        'those edits have been overwritten by the self-heal. ' +
        'Re-apply your custom matchers / commands on top of the freshly-written template, ' +
        'or open an issue if your customisation is a recurring need (the team may promote it to the canonical template).'
    );
  } else if (report.claudeSettings.offlineTemplate.action === 'written') {
    nextActions.push(
      `Wrote .peaks/.claude-settings-template.json (action: written) — ` +
        'the offline recovery anchor is now in place for future manual recoveries.'
    );
  }
}

function pushHooksActions(nextActions: string[], hooksOutcome: FirstTimeHooksInstallOutcome): void {
  if (hooksOutcome.decision === 'installed') {
    nextActions.push(
      hooksOutcome.action === 'reinstalled'
        ? 'Re-installed the peaks-managed PreToolUse hooks (Bash→gate enforce, Task→progress start) — the marker said installed but the hooks were missing.'
        : 'Installed the peaks-managed PreToolUse hooks (Bash→gate enforce, Task→progress start). Restart Claude Code so the hooks take effect.'
    );
  } else if (hooksOutcome.action === 'first-decision' && hooksOutcome.decision === 'skipped') {
    nextActions.push(
      'Skipped peaks-managed hook install for this project. Re-run with --install-hooks=auto (or peaks hooks install) to install later.'
    );
  }
}

/**
 * Slice 4.0.8 (D3): after session binding, run the same canonical GC sweep
 * `peaks skill presence:set` would perform. A `peaks workspace init` is a
 * natural sweep trigger (the session id was just minted, all prior leases for
 * the project are by definition same-project). Failures surface as warnings;
 * the GC never blocks init.
 */
async function collectLeaseSweepWarning(warnings: string[], projectRoot: string): Promise<void> {
  try {
    const gcResult = await gcStalePresenceLeases({
      projectRoot,
      trigger: 'workspace-init'
    });
    if (gcResult.removed > 0) {
      warnings.push(
        `Stale lease sweep removed ${gcResult.removed} lease(s) for the canonical project (retained ${gcResult.retained}).`
      );
    }
  } catch (err) {
    warnings.push(`lease sweep failed: ${getErrorMessage(err)}`);
  }
}

/**
 * When the consumer project's `.claude/rules/` is missing or empty, emit the
 * copy-pasteable diagnostic into the JSON envelope's `warnings` array AND
 * surface the structured descriptor. AC7: the diagnostic banner is skipped on
 * subsequent invocations within the same session — the once-per-session marker
 * `.peaks/_runtime/<sid>/.standards-checked` is written after the FIRST emit.
 * AC3: when --init-standards was passed, `report.standardsApplied` lists the
 * freshly-written files, surfaced as a nextAction.
 */
function pushStandardsActions(
  nextActions: string[],
  warnings: string[],
  ctx: WorkspaceInitContext
): void {
  const { report, projectRoot, sessionId } = ctx;
  if (report.standardsMissing.missing && !hasStandardsCheckedMarker(projectRoot, sessionId)) {
    warnings.push(report.standardsMissing.remediation);
    nextActions.push(
      `Run \`peaks workspace init --init-standards --project ${projectRoot}\` to auto-apply the scaffold, or \`peaks standards init --project ${projectRoot} --apply\` manually.`
    );
  }
  if (report.standardsApplied !== undefined) {
    nextActions.push(
      `Auto-applied .claude/rules/${report.standardsApplied.language}/ scaffold (slice 2026-06-16-peaks-code-auto-scaffold): ` +
        `wrote ${report.standardsApplied.writtenFiles.length} file(s), ` +
        `kept ${report.standardsApplied.skippedFiles.length} existing file(s).`
    );
  }
}

/**
 * The project-scan bootstrap outcome. The envelope carries the write counts and
 * duration so the LLM (and the human) see what landed. The nextAction only
 * fires when the project-scan tree is fresh — idempotent re-runs are silent to
 * keep the nextAction list scannable.
 */
function pushProjectScanActions(
  nextActions: string[],
  warnings: string[],
  ctx: WorkspaceInitContext
): void {
  const { projectScanError, projectScanEnvelope, projectRoot } = ctx;
  if (projectScanError !== null) {
    warnings.push(`project-scan bootstrap failed: ${projectScanError}`);
  } else if (projectScanEnvelope !== null && projectScanEnvelope.created) {
    nextActions.push(
      `Bootstrapped .peaks/project-scan/ (project-scan.md + 4 audit/business templates) — ` +
        `${projectScanEnvelope.templatesBooted} file(s) written, ${projectScanEnvelope.templatesSkipped} preserved. ` +
        `Run \`peaks scan archetype --project ${projectRoot}\` and \`peaks scan libraries --project ${projectRoot}\` next to refresh the scan.`
    );
  }
}

/** Write the once-per-session marker AFTER the envelope is built (so subsequent
 * inits skip the warning even on rapid back-to-back calls). */
function markStandardsCheckedIfMissing(ctx: WorkspaceInitContext): void {
  if (!ctx.report.standardsMissing.missing) return;
  markStandardsChecked(ctx.projectRoot, ctx.sessionId);
}

/** Collect the envelope's nextActions + warnings in the original push order. */
export async function collectInitEnvelope(ctx: WorkspaceInitContext): Promise<InitEnvelopeParts> {
  const nextActions: string[] = [];
  const warnings: string[] = [];
  pushBindingReplacedAction(nextActions, ctx.report);
  pushRotationActions(nextActions, ctx.rotation, ctx.projectRoot, ctx.sessionId);
  pushCreatedAction(nextActions, ctx.report);
  pushSettingsActions(nextActions, ctx.report);
  // First-time hooks install decision. Sticky-marker at
  // .peaks/.peaks-init-hooks-decision.json records the user's answer
  // (or the auto-decision) so subsequent inits for new sessions in the
  // same project do not re-prompt. The marker is the only state that
  // survives across sessions — without it, every new session would
  // re-trigger the question.
  const hooksOutcome = await resolveFirstTimeHooksInstall({
    projectRoot: ctx.projectRoot,
    ...(ctx.options.installHooks !== undefined ? { explicitMode: ctx.options.installHooks } : {}),
    jsonMode: ctx.options.json === true
  });
  pushHooksActions(nextActions, hooksOutcome);
  await collectLeaseSweepWarning(warnings, ctx.projectRoot);
  pushStandardsActions(nextActions, warnings, ctx);
  pushProjectScanActions(nextActions, warnings, ctx);
  markStandardsCheckedIfMissing(ctx);
  const codegraphAutoOutcome = await stakeCodegraphForInit(nextActions, warnings, ctx.projectRoot);
  return { nextActions, warnings, hooksOutcome, codegraphAutoOutcome };
}
