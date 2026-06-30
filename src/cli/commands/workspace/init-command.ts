/**
 * `peaks workspace init` — slice 006 + 007 + 014 + 018 + 2026-06-16-peaks-solo-auto-scaffold.
 *
 * Extracted from `src/cli/commands/workspace-commands.ts` (slice
 * 2026-06-16-workspace-commands-split) to keep that entry file under the
 * 800-line Karpathy cap. Owns:
 *   - commander option wiring (`--project`, `--session-id`, `--change-id`, etc.)
 *   - canonical project-root resolution
 *   - session id resolution (with slice-018 rotation)
 *   - first-time hooks install prompt + sticky marker
 *   - missing-standards diagnostic surface (AC1-AC7) and `--init-standards` apply
 *
 * Imports the shared hooks-decision marker helpers from `./helpers.ts`.
 */

import type { Command } from 'commander';
import {
  initWorkspace,
  InvalidSessionIdError,
  ConflictingSessionError,
  LegacyChangeIdSiblingError
} from '../../../services/workspace/workspace-service.js';
// Slice 2026-06-29-change-id-root-removal: `LegacyChangeIdBindingError`
// was removed with the change-id axis. The legacy symlink-detection
// branch below no longer fires — the binding file at
// `.peaks/_runtime/current-change` is no longer written by init
// either. The sibling-dir guard (`LegacyChangeIdSiblingError`) is
// preserved because the 2.8.3 hard-ban still applies to date-stamped
// session-id-shaped directories at the `.peaks/_runtime/` sibling
// level.
import { ensureSessionWithRotation } from '../../../services/session/session-manager.js';
import { resolveCanonicalProjectRoot } from '../../../services/config/config-service.js';
import { applyHookInstall, readHookStatus } from '../../../services/skills/hooks-settings-service.js';
import { clearStalePresenceOnRotation } from '../../../services/skills/skill-presence-service.js';
import { fail, ok } from '../../../shared/result.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../../cli-helpers.js';
import {
  hasStandardsCheckedMarker,
  markStandardsChecked
} from '../../../services/standards/missing-standards-detector.js';
import {
  readDecisionMarker,
  writeDecisionMarker,
  promptYesNo,
  type HooksDecision
} from './helpers.js';

export type WorkspaceInitOptions = {
  project: string;
  sessionId?: string;
  json?: boolean;
  allowSessionRebind?: boolean;
  /**
   * Slice 018 opt-out, commander-convention form. The user-facing
   * flag is `--no-rotate-on-outer-mismatch`; commander strips the
   * `--no-` prefix and assigns the boolean to this property (default
   * `true`, set to `false` when the flag is passed). The wrapper
   * reads this as `=== false` to opt out. The presence file still
   * records `outerSessionMismatch` regardless of the flag's value.
   */
  rotateOnOuterMismatch?: boolean;
  /**
   * How to handle the first-time "install peaks hooks" prompt.
   *   - ask  (default in TTY): prompt the user once, sticky-marker the answer
   *   - auto (default in --json / non-TTY): install silently, sticky-marker installed
   *   - skip: write sticky-marker skipped, do not install
   * After the first decision the sticky marker wins, regardless of --install-hooks
   * (re-runs respect the recorded decision; only re-install when the marker says
   * installed but the hooks have been removed out from under us).
   */
  installHooks?: 'ask' | 'auto' | 'skip';
  /**
   * Slice 2.0.1-bug3-fact-forcing-bypass: opt out of writing the
   * consumer-project `.claude/settings.local.json` file. Default
   * (commander `--no-` prefix) is `true`; pass `--no-claude-hooks` to
   * set this to `false`. The wrapper reads this as `=== false` to
   * skip the materialization. The bypass is documented in
   * `peaks-solo/references/anchoring-and-session-info.md`.
   */
  claudeHooks?: boolean;
  /**
   * Slice 2026-06-16-peaks-solo-auto-scaffold (RD#7): opt-in flag to
   * auto-scaffold `.claude/rules/{common,<language>}/` when missing.
   * Default `false` — the diagnostic fires but no write happens.
   * Set to `true` (via `--init-standards`) to also run
   * `executeProjectStandardsInit({ projectRoot, apply: true })`.
   */
  initStandards?: boolean;
};

/**
 * Outcome of the first-time "install peaks hooks" decision attached to
 * `peaks workspace init`. Reported in the response data so the LLM and
 * the human both see what happened.
 */
export type FirstTimeHooksInstallOutcome = {
  /** The decision recorded (or already on file) in the sticky marker. */
  decision: HooksDecision;
  /**
   * What the install path actually did this call.
   *   - first-decision: we recorded a brand-new sticky marker (and may have installed)
   *   - reinstalled:    the marker said installed but the hooks were missing — we re-applied
   *   - marker-honored: the marker already existed; we did not touch the hooks
   *   - already-installed: the hooks were already present and the marker does not exist yet
   *                          (we write a fresh marker to lock in the answer for next time)
   */
  action: 'first-decision' | 'reinstalled' | 'marker-honored' | 'already-installed';
  scope: 'project' | 'global';
  /**
   * Why the action was the way it was (e.g. "stdin-not-tty", "user-answered-no",
   * "marker-installed-hooks-missing"). Surfaced for forensics.
   */
  reason?: string;
};

export type ResolveFirstTimeHooksInstallOptions = {
  projectRoot: string;
  /**
   * Explicit mode from the --install-hooks flag. When omitted, the default
   * is "ask" in TTY mode and "auto" otherwise (see `defaultMode` logic).
   */
  explicitMode?: 'ask' | 'auto' | 'skip' | undefined;
  /**
   * Whether the caller is in --json mode. In --json mode we never prompt
   * (the LLM cannot answer an interactive question) — we silently treat
   * "ask" as "auto" and proceed.
   */
  jsonMode: boolean;
};

export function registerWorkspaceInitCommand(workspace: Command, io: ProgramIO): void {
  addJsonOption(
    workspace
      .command('init')
      .description('Create the .peaks/_runtime/<session-id>/ directory with ONLY the session.json metadata file (slice 006: role subdirs prd/ui/rd/qa/sc/txt and the system/ subdir are created lazily by writers, not pre-created at init). Pass --session-id to use a specific id, or omit it to auto-generate one (and adopt an existing binding if present). On the first call for a project, also handles the one-time "install peaks hooks" decision (sticky-marker stored in .peaks/.peaks-init-hooks-decision.json).')
      .requiredOption('--project <path>', 'target project root')
      .option('--session-id <id>', 'optional session id in YYYY-MM-DD-<kebab-slug> format. When omitted, the CLI is the single source of truth: an existing binding is reused, otherwise a fresh id is auto-generated.')
      .option('--allow-session-rebind', 'overwrite an existing session binding when the requested session id differs from the project current one', false)
      .option(
        '--no-rotate-on-outer-mismatch',
        'suppress the auto-rotation of the project session binding when the outer (Claude / harness) session id has changed. Default rotates on mismatch.'
      )
      .option(
        '--install-hooks <mode>',
        'first-time hooks install behaviour: ask (default in TTY, prompt once + sticky-marker), auto (default in --json / non-TTY, install silently + sticky-marker), skip (sticky-marker skipped, do not install)',
        (value: string) => {
          if (value !== 'ask' && value !== 'auto' && value !== 'skip') {
            throw new Error(`--install-hooks must be one of: ask, auto, skip (got "${value}")`);
          }
          return value;
        }
      )
      .option(
        '--no-claude-hooks',
        'do NOT materialize .claude/settings.local.json (slice 2.0.1-bug3 fact-forcing bypass). Default: hooks installed so tool calls inside .peaks/** are not blocked by the [Fact-Forcing Gate].'
      )
      .option(
        '--init-standards',
        'slice 2026-06-16-peaks-solo-auto-scaffold: when the consumer project\'s .claude/rules/ is missing or empty, auto-apply `peaks standards init --project <path> --apply` after emitting the diagnostic. Default: diagnostic only (no write).'
      )
  ).action(async (options: WorkspaceInitOptions) => {
    try {
      // Resolve the session id. Two paths:
      //   - explicit --session-id: use it as the requested binding target
      //     (ConflictingSessionError fires if it conflicts with an in-flight
      //     session, unless --allow-session-rebind is set)
      //   - omitted: defer to ensureSession(), which reuses an existing
      //     binding or auto-generates a fresh one. The init then writes
      //     .peaks/_runtime/session.json so the binding sticks.
      //
      // Before that: canonicalise the project root. If the user (or the
      // LLM via "$(pwd)") passed a sub-directory of a real git repo
      // (e.g. prompt-project/prompt-project/ inside the outer
      // prompt-project/.git), promote the path to the git root. Without
      // this, peaks would build a parallel .peaks/ tree under the
      // nested sub-folder and silently break the project-binding model
      // (the same regression that produced prompt-project/.peaks/ in
      // the 5/27-5/29 sessions). When startPath is not inside any
      // git repo, the helper falls through to the cwd verbatim.
      const projectRoot = resolveCanonicalProjectRoot(options.project);

      // Slice 018: outer-session-mismatch auto-rotation. When the
      // user did NOT pass --session-id explicitly, run
      // `ensureSessionWithRotation` so the binding is rotated on
      // outer-mismatch before `initWorkspace` is called. The
      // rotation result is surfaced in the JSON envelope via
      // `data.rotation`. When --session-id IS passed, the user has
      // explicitly told us which session to bind — we honor that
      // verbatim and do NOT rotate (rotation only fires for the
      // auto-detect path).
      let sessionId: string;
      let rotation: { previousSessionId: string | null; reason: 'outer-session-mismatch' | null } = {
        previousSessionId: null,
        reason: null
      };
      if (options.sessionId !== undefined && options.sessionId.length > 0) {
        sessionId = options.sessionId;
      } else {
        const result = await ensureSessionWithRotation(projectRoot, {
          // Commander translates `--no-rotate-on-outer-mismatch` into
          // `options.rotateOnOuterMismatch = false` (the `--no-` prefix
          // is consumed and the remainder becomes the JS property name,
          // with the boolean value flipped). The pre-slice-014 anti-
          // pattern (reading `options.<flag-with-no-prefix> === true`)
          // is NOT used here. The default (no flag) leaves
          // `options.rotateOnOuterMismatch` undefined, which is not
          // equal to `false`, so the default is "rotate on mismatch"
          // (the new auto-roll).
          skipRotateOnOuterMismatch: options.rotateOnOuterMismatch === false
        });
        sessionId = result.sessionId;
        rotation = {
          previousSessionId: result.previousSessionId,
          reason: result.rotationReason
        };
      }

      const report = await initWorkspace({
        projectRoot,
        sessionId,
        allowSessionRebind: options.allowSessionRebind === true,
        // Commander translates `--no-claude-hooks` into
        // `options.claudeHooks = false`. The default (no flag) leaves
        // `options.claudeHooks` undefined, which is not equal to
        // `false`, so the default is "install hooks" (the bypass is
        // on). Pass `--no-claude-hooks` to opt out.
        noClaudeHooks: options.claudeHooks === false,
        // Slice 2026-06-16-peaks-solo-auto-scaffold (RD#7): opt-in
        // auto-apply for the missing-standards scaffold. Default false
        // — only the diagnostic is emitted. Pass --init-standards to
        // also run `executeProjectStandardsInit({ apply: true })`.
        initStandards: options.initStandards === true
      });
      const nextActions: string[] = [];
      if (report.previousSessionId !== null && report.bound) {
        nextActions.push(`Replaced prior session binding "${report.previousSessionId}" with "${report.sessionId}".`);
      }
      if (rotation.previousSessionId !== null && rotation.reason === 'outer-session-mismatch') {
        // Outer-session-mismatch rotation: the previous Claude / harness
        // session is no longer the LLM driver. The new binding is fresh,
        // the old session dir is preserved on disk.
        nextActions.push(
          `Auto-rotated session binding: outer session id changed (was "${rotation.previousSessionId}"). ` +
            `New binding is "${sessionId}". The previous session dir is preserved at .peaks/_runtime/${rotation.previousSessionId}/. ` +
            `Re-run with --no-rotate-on-outer-mismatch to suppress this rotation.`
        );
        // Slice 002 (v2.15.0) AC-1: a presence marker stamped by the
        // OLD outer session is now stale (defect A from the PRD).
        // peaks-solo Step 1 would otherwise pick up the old `mode`
        // field and silently lock the new session into a mode the
        // user never explicitly chose. Clear it here so Step 1's
        // presence:check-stale reports `reason: 'no-presence'` and
        // the re-ask fires.
        const presenceClearOutcome = clearStalePresenceOnRotation({
          projectRootOverride: projectRoot,
          currentOuterSessionId: process.env.PEAKS_OUTER_SESSION_ID
            ?? process.env.CLAUDE_CODE_SESSION_ID,
          rotatedOutSessionId: rotation.previousSessionId
        });
        if (presenceClearOutcome.cleared) {
          nextActions.push(
            `Auto-cleared stale skill presence (recorded outer id "${presenceClearOutcome.recordedOuter ?? '?'}" did not match the new outer session). ` +
              'peaks-solo Step 1 will now AskUserQuestion to confirm the mode.'
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
      if (report.created.length === 0) {
        nextActions.push('Workspace already initialized — proceed to project scan.');
      } else {
        nextActions.push('Run `peaks scan archetype --project <path> --json` next to populate rd/project-scan.md.');
      }

      // Slice 2.0.1-bug3-fact-forcing-bypass: surface the consumer-
      // project .claude/settings.local.json materialization outcome.
      // When the bypass is in effect, the LLM knows subsequent Writes
      // and Bash calls targeting .peaks/** will not be blocked by the
      // [Fact-Forcing Gate]. When the user opted out, we surface a
      // nextAction so the manual recovery is documented.
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

      // Slice 2026-06-13-selfheal-claude-settings-template: surface
      // the self-heal outcome for the offline
      // `.peaks/.claude-settings-template.json` copy. When the offline
      // file was refreshed (i.e. the previous peaks-cli release left
      // a stale version without the `node -e "..."` wrapper), the user
      // benefits from seeing that the manual-recovery anchor now
      // points at the corrected template. We surface `written` and
      // `refreshed` as the actionable events; `already-current` is
      // silent (same rationale as the consumer-project no-op above).
      //
      // The `refreshed` nextAction also carries a loud warning that any
      // MANUAL EDITS the user made to the offline template have been
      // overwritten — drift detection cannot tell stale-from-prior-release
      // apart from user-customised, so we surface the warning unconditionally
      // to make sure anyone who customised sees the prompt.
      if (report.claudeSettings.offlineTemplate.action === 'refreshed') {
        nextActions.push(
          `Self-healed .peaks/.claude-settings-template.json (action: refreshed) — ` +
            'the offline recovery anchor now matches the current peaks-cli template. ' +
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

      // First-time hooks install decision. Sticky-marker at
      // .peaks/.peaks-init-hooks-decision.json records the user's answer
      // (or the auto-decision) so subsequent inits for new sessions in the
      // same project do not re-prompt. The marker is the only state that
      // survives across sessions — without it, every new session would
      // re-trigger the question.
      const hooksOutcome = await resolveFirstTimeHooksInstall({
        projectRoot,
        ...(options.installHooks !== undefined ? { explicitMode: options.installHooks } : {}),
        jsonMode: options.json === true
      });
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

      // Slice 2026-06-16-peaks-solo-auto-scaffold (RD#7):
      //   - When the consumer project's `.claude/rules/` is missing or
      //     empty, emit the copy-pasteable diagnostic to stderr (via
      //     the JSON envelope `warnings` array) AND surface the
      //     structured descriptor in `data.standardsMissing`.
      //   - AC7: skip the diagnostic banner on subsequent invocations
      //     within the same session — the once-per-session marker
      //     `.peaks/_runtime/<sid>/.standards-checked` is written after
      //     the FIRST diagnostic emit.
      //   - AC3: when --init-standards was passed and the detector
      //     reported missing, `report.standardsApplied` already lists the
      //     freshly-written files. Surface that as a nextAction so the
      //     human sees what was written.
      const warningsForEnvelope: string[] = [];
      if (report.standardsMissing.missing && !hasStandardsCheckedMarker(projectRoot, sessionId)) {
        warningsForEnvelope.push(report.standardsMissing.remediation);
        nextActions.push(
          `Run \`peaks workspace init --init-standards --project ${projectRoot}\` to auto-apply the scaffold, or \`peaks standards init --project ${projectRoot} --apply\` manually.`
        );
      }
      if (report.standardsApplied !== undefined) {
        nextActions.push(
          `Auto-applied .claude/rules/${report.standardsApplied.language}/ scaffold (slice 2026-06-16-peaks-solo-auto-scaffold): ` +
            `wrote ${report.standardsApplied.writtenFiles.length} file(s), ` +
            `kept ${report.standardsApplied.skippedFiles.length} existing file(s).`
        );
      }
      // Write the once-per-session marker AFTER the envelope is built
      // (so subsequent inits skip the warning even on rapid back-to-back
      // calls).
      if (report.standardsMissing.missing) {
        markStandardsChecked(projectRoot, sessionId);
      }

      printResult(
        io,
        ok(
          'workspace.init',
          {
            ...report,
            // Slice 018: surface outer-session-mismatch rotation in the
            // JSON envelope so the LLM and the human both see the swap.
            // Field is omitted (not null) when no rotation fired.
            ...(rotation.previousSessionId !== null && rotation.reason !== null
              ? { rotation: { previousSessionId: rotation.previousSessionId, reason: rotation.reason } }
              : {}),
            hooksInstall: {
              decision: hooksOutcome.decision,
              action: hooksOutcome.action,
              scope: hooksOutcome.scope,
              ...(hooksOutcome.reason !== undefined ? { reason: hooksOutcome.reason } : {})
            }
          },
          warningsForEnvelope,
          nextActions
        ),
        options.json
      );
    } catch (error) {
      if (error instanceof InvalidSessionIdError) {
        printResult(
          io,
          fail('workspace.init', error.code, error.message, { sessionId: options.sessionId }, ['Use a date-prefixed kebab slug like 2026-05-25-add-user-auth']),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      if (error instanceof ConflictingSessionError) {
        printResult(
          io,
          fail('workspace.init', error.code, error.message, {
            existingSessionId: error.existingSessionId,
            requestedSessionId: error.requestedSessionId
          }, [
            `Finish or abandon session "${error.existingSessionId}" first, then re-run workspace init.`,
            'Or pass --allow-session-rebind to override the binding (overwrites the prior binding).'
          ]),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      if (error instanceof LegacyChangeIdSiblingError) {
        // Slice 2.8.3: a 2.8.0-era orphan `.peaks/_runtime/<change-id>/` was
        // found at top level. The CLI surfaces the migration steps
        // verbatim from the error message plus three concrete
        // nextActions so the user (or LLM driver) has an unambiguous
        // recovery path. We do NOT auto-migrate because the legacy
        // sibling dir may contain user-authored content.
        printResult(
          io,
          fail('workspace.init', error.code, error.message, {
            sessionId: error.sessionId,
            legacyPath: error.legacyPath
          }, [
            `Inspect ${error.legacyPath} for any user-authored content you want to keep.`,
            `Move any desired files into .peaks/_runtime/<sessionId>/<role>/ (gitignored), then delete ${error.legacyPath}.`,
            `Re-run \`peaks workspace init --project <path>\` to bind a fresh session.`
          ]),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      // Slice 2026-06-29-change-id-root-removal: the
      // `LegacyChangeIdBindingError` catch branch is gone — the change-id
      // binding file at `.peaks/_runtime/current-change` is no longer
      // written by init, so there is no legacy binding to detect.
      printResult(
        io,
        fail('workspace.init', 'WORKSPACE_INIT_FAILED', getErrorMessage(error), { projectRoot: options.project, sessionId: options.sessionId }, ['Verify the project path exists and is writable']),
        options.json
      );
      process.exitCode = 1;
    }
  });
}

/**
 * Resolve the first-time "install peaks hooks" decision for this project.
 * Decision tree:
 *
 *   1. Read the sticky marker.
 *      - Marker present:
 *        - marker.decision === 'installed' AND hooks are present → action: marker-honored, no side effects
 *        - marker.decision === 'installed' AND hooks are MISSING   → re-install, action: reinstalled
 *        - marker.decision === 'skipped'                            → action: marker-honored, no install
 *      - Marker absent:
 *        - hooks already present → write a fresh 'installed' marker, action: already-installed
 *        - otherwise:
 *          - explicit --install-hooks=auto  → install + marker, action: first-decision
 *          - explicit --install-hooks=skip  → marker only, action: first-decision
 *          - explicit --install-hooks=ask OR default in TTY:
 *              - jsonMode → silently auto-install (LLM cannot answer), action: first-decision
 *              - TTY      → prompt; on yes install + marker, on no marker-only
 *          - default in non-TTY → auto-install, action: first-decision
 *
 * Project scope is the only supported scope here; global scope is reserved
 * for explicit `peaks hooks install --global` invocations.
 */
export async function resolveFirstTimeHooksInstall(
  options: ResolveFirstTimeHooksInstallOptions
): Promise<FirstTimeHooksInstallOutcome> {
  const { projectRoot, jsonMode } = options;
  const existingMarker = readDecisionMarker(projectRoot);
  // readHookStatus can throw (e.g. .claude is a symlink → safety check rejects).
  // Treat any throw as "hooks status unknown → treat as not-installed" so the
  // function still reaches the install path; the install will surface the same
  // error in a more specific reason field.
  let hookStatus: { installed: boolean };
  try {
    hookStatus = readHookStatus('project', projectRoot);
  } catch (error) {
    hookStatus = { installed: false };
    // Fall through to the install path; the failure will be captured below.
    void error;
  }

  if (existingMarker !== null) {
    if (existingMarker.decision === 'installed' && !hookStatus.installed) {
      try {
        applyHookInstall('project', projectRoot);
        return { decision: 'installed', action: 'reinstalled', scope: 'project', reason: 'marker-said-installed-hooks-missing' };
      } catch (error) {
        return { decision: existingMarker.decision, action: 'marker-honored', scope: 'project', reason: `reinstall-failed: ${getErrorMessage(error)}` };
      }
    }
    return { decision: existingMarker.decision, action: 'marker-honored', scope: existingMarker.scope };
  }

  // No marker yet — first decision.
  if (hookStatus.installed) {
    writeDecisionMarker(projectRoot, 'installed');
    return { decision: 'installed', action: 'already-installed', scope: 'project' };
  }

  // Determine effective mode (explicit flag wins; default depends on TTY + jsonMode).
  const explicitMode = options.explicitMode;
  const effectiveMode: 'ask' | 'auto' | 'skip' =
    explicitMode ??
    (jsonMode ? 'auto' : (process.stdin.isTTY === true ? 'ask' : 'auto'));

  if (effectiveMode === 'skip') {
    writeDecisionMarker(projectRoot, 'skipped');
    return { decision: 'skipped', action: 'first-decision', scope: 'project', reason: 'explicit-skip' };
  }

  if (effectiveMode === 'auto' || jsonMode) {
    // The reason code distinguishes the path the user took to reach auto-install:
    //   - explicit-auto:  user passed --install-hooks=auto
    //   - json-mode:      no --install-hooks flag, but --json was set
    //   - non-tty-default: no flag, no --json, stdin is not a TTY
    let autoReason: string;
    if (explicitMode === 'auto') {
      autoReason = 'explicit-auto';
    } else if (jsonMode) {
      autoReason = 'json-mode';
    } else {
      autoReason = 'non-tty-default';
    }
    try {
      applyHookInstall('project', projectRoot);
      writeDecisionMarker(projectRoot, 'installed');
      return { decision: 'installed', action: 'first-decision', scope: 'project', reason: autoReason };
    } catch (error) {
      // Auto-install failed: still record the decision so we do not keep retrying
      // every workspace init. The user can fix the underlying problem and run
      // `peaks hooks install` manually.
      writeDecisionMarker(projectRoot, 'installed');
      return { decision: 'installed', action: 'first-decision', scope: 'project', reason: `install-failed: ${getErrorMessage(error)}` };
    }
  }

  // effectiveMode === 'ask' AND TTY: prompt once.
  process.stderr.write(
    '\nPeaks-Cli: install the PreToolUse hooks for this project now?\n' +
      '  → Bash matcher: `peaks gate enforce` (SOP gate enforcement)\n' +
 'The gate-enforce hook runs on every Claude Code tool call without further prompting. The decision is sticky\n' +
      '(recorded in .peaks/.peaks-init-hooks-decision.json) and re-runs of `workspace init` will\n' +
      'honour it. Re-run with --install-hooks=skip or --install-hooks=auto to override.\n\n' +
      'Install now? [Y/n]: '
  );
  const answer = await promptYesNo('');
  if (answer === null) {
    // TTY disappeared mid-prompt (rare): treat as skip + write marker.
    writeDecisionMarker(projectRoot, 'skipped');
    return { decision: 'skipped', action: 'first-decision', scope: 'project', reason: 'tty-prompt-aborted' };
  }
  if (!answer) {
    writeDecisionMarker(projectRoot, 'skipped');
    return { decision: 'skipped', action: 'first-decision', scope: 'project', reason: 'user-answered-no' };
  }
  try {
    applyHookInstall('project', projectRoot);
    writeDecisionMarker(projectRoot, 'installed');
    return { decision: 'installed', action: 'first-decision', scope: 'project', reason: 'user-answered-yes' };
  } catch (error) {
    writeDecisionMarker(projectRoot, 'installed');
    return { decision: 'installed', action: 'first-decision', scope: 'project', reason: `install-failed: ${getErrorMessage(error)}` };
  }
}