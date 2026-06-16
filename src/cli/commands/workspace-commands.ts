import { Command } from 'commander';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { initWorkspace, InvalidSessionIdError, ConflictingSessionError } from '../../services/workspace/workspace-service.js';
import { reconcileWorkspace } from '../../services/workspace/reconcile-service.js';
import { migrateWorkspace } from '../../services/workspace/migrate-service.js';
import {
  executeRuntimeCleanup,
  executeSubAgentClean,
} from '../../services/workspace/workspace-clean-service.js';
import { archiveSession } from '../../services/workspace/workspace-archive-service.js';
import { registerMigrate1_4_1Command } from './migrate-1-4-1-command.js';
import { ensureSession, ensureSessionWithRotation } from '../../services/session/session-manager.js';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { applyHookInstall, readHookStatus } from '../../services/skills/hooks-settings-service.js';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import {
  hasStandardsCheckedMarker,
  markStandardsChecked
} from '../../services/standards/missing-standards-detector.js';

type WorkspaceInitOptions = {
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
   * Optional change-id to bind as the active unit of work (slice 2026-06-05-
   * change-id-as-unit-of-work). When set, the workspace also creates
   * `.peaks/<change-id>/<role>/` (tracked) and writes
   * `.peaks/_runtime/current-change` as a symlink pointing at the change-id
   * dir. RD/QA/PRD services read this binding to decide where to write
   * reviewable artifacts.
   */
  changeId?: string;
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

/** Sticky decision marker for the first-time "install hooks" prompt. */
const HOOKS_DECISION_REL_PATH = '.peaks/.peaks-init-hooks-decision.json';

type HooksDecision = 'installed' | 'skipped';
type HooksDecisionMarker = {
  version: 1;
  decision: HooksDecision;
  decidedAt: string;
  scope: 'project' | 'global';
};

function readDecisionMarker(projectRoot: string): HooksDecisionMarker | null {
  const path = join(projectRoot, HOOKS_DECISION_REL_PATH);
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as Partial<HooksDecisionMarker>;
    if (data.version !== 1) return null;
    if (data.decision !== 'installed' && data.decision !== 'skipped') return null;
    if (typeof data.decidedAt !== 'string') return null;
    if (data.scope !== 'project' && data.scope !== 'global') return null;
    return {
      version: 1,
      decision: data.decision,
      decidedAt: data.decidedAt,
      scope: data.scope
    };
  } catch {
    return null;
  }
}

function writeDecisionMarker(projectRoot: string, decision: HooksDecision): void {
  const path = join(projectRoot, HOOKS_DECISION_REL_PATH);
  const dir = join(projectRoot, '.peaks');
  mkdirSync(dir, { recursive: true });
  const marker: HooksDecisionMarker = {
    version: 1,
    decision,
    decidedAt: new Date().toISOString(),
    scope: 'project'
  };
  writeFileSync(path, JSON.stringify(marker, null, 2) + '\n', 'utf8');
}

/**
 * Read a yes/no answer from stdin. Returns `true` for empty / Y / y,
 * `false` for N / n, or `null` when stdin is not a TTY (the caller falls
 * back to the no-prompt path). Times out after 30s so a piped-but-blocked
 * stdin never hangs the CLI.
 */
function promptYesNo(question: string): Promise<boolean | null> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY !== true) {
      resolve(null);
      return;
    }
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    const timer = setTimeout(() => {
      rl.close();
      resolve(null);
    }, 30_000);
    rl.question(question, (answer) => {
      clearTimeout(timer);
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      if (trimmed === '' || trimmed === 'y' || trimmed === 'yes') {
        resolve(true);
        return;
      }
      if (trimmed === 'n' || trimmed === 'no') {
        resolve(false);
        return;
      }
      // Treat anything else as "no" — the user can re-run with --install-hooks
      // if they want a different answer. We never throw from this prompt.
      resolve(false);
    });
  });
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_RECONCILE_AGE_DAYS = 7;

type WorkspaceReconcileOptions = {
  project: string;
  json?: boolean;
  apply?: boolean;
  olderThan?: number;
};

export function registerWorkspaceCommands(program: Command, io: ProgramIO): void {
  const workspace = program.command('workspace').description('Manage the Peaks per-session artifact workspace (.peaks/<session-id>/)');

  addJsonOption(
    workspace
      .command('init')
      .description('Create the .peaks/_runtime/<session-id>/ directory with ONLY the session.json metadata file (slice 006: role subdirs prd/ui/rd/qa/sc/txt and the system/ subdir are created lazily by writers, not pre-created at init). When --change-id is given, also creates the .peaks/<change-id>/ dir. Pass --session-id to use a specific id, or omit it to auto-generate one (and adopt an existing binding if present). On the first call for a project, also handles the one-time "install peaks hooks" decision (sticky-marker stored in .peaks/.peaks-init-hooks-decision.json).')
      .requiredOption('--project <path>', 'target project root')
      .option('--session-id <id>', 'optional session id in YYYY-MM-DD-<kebab-slug> format. When omitted, the CLI is the single source of truth: an existing binding is reused, otherwise a fresh id is auto-generated.')
      .option('--allow-session-rebind', 'overwrite an existing session binding when the requested session id differs from the project current one', false)
      .option(
        '--no-rotate-on-outer-mismatch',
        'suppress the auto-rotation of the project session binding when the outer (Claude / harness) session id has changed. Default rotates on mismatch.'
      )
      .option(
        '--change-id <id>',
        'bind the change-id for reviewable artifacts (writes route to .peaks/<change-id>/<role>/, tracked in git). When omitted, the change-id binding is left unchanged.',
        (value: string) => {
          if (value.length === 0) {
            throw new Error('--change-id must not be empty');
          }
          return value;
        }
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
        ...(options.changeId !== undefined ? { changeId: options.changeId } : {}),
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
      printResult(
        io,
        fail('workspace.init', 'WORKSPACE_INIT_FAILED', getErrorMessage(error), { projectRoot: options.project, sessionId: options.sessionId }, ['Verify the project path exists and is writable']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    workspace
      .command('reconcile')
      .description(
        'Scan .peaks/2026-MM-DD-session-*/ directories and consolidate the runtime state. ' +
          'By default (no --apply) the command performs four actions:\n' +
          '  1. Migrates legacy runtime files into .peaks/_runtime/: ' +
          '.peaks/.session.json -> .peaks/_runtime/session.json, ' +
          '.peaks/.active-skill.json -> .peaks/_runtime/active-skill.json, ' +
          '.peaks/sop-state/ -> .peaks/_runtime/sop-state/ ' +
          '(idempotent; no-op if already on the new layout).\n' +
          '  2. Re-points .peaks/_runtime/session.json to the canonical session ' +
          'using a 4-tier heuristic: active-skill binding -> latest session.json mtime -> ' +
          'latest any-file mtime -> dir-name sort.\n' +
          '  3. (slice 006) Syncs the single change/<sid>/ live marker under ' +
          '.peaks/_runtime/change/. The marker is an empty directory; every other ' +
          'entry under change/ is removed. Also cleans up the F3-introduced ' +
          '.peaks/_runtime/<sid>/system/ subdir (no-op if already absent).\n' +
          '  4. REPORTS (but does not delete) session dirs older than --older-than <days> ' +
          `(default ${DEFAULT_RECONCILE_AGE_DAYS}) as deletion candidates; this is the only step that is dry-run by default.\n` +
          'Pass --apply to additionally REMOVE the listed candidate dirs (destructive). ' +
          'Migration (1), repoint (2), and marker sync (3) always run regardless of --apply.'
      )
      .requiredOption('--project <path>', 'target project root')
      .option('--apply', 'actually delete the deletion candidates (destructive); without it, dry-run only', false)
      .option('--older-than <days>', `age threshold in days for deletion candidates (default: ${DEFAULT_RECONCILE_AGE_DAYS})`, (value: string) => Number.parseFloat(value))
  ).action((options: WorkspaceReconcileOptions) => {
    try {
      const projectRoot = resolveCanonicalProjectRoot(options.project);
      const olderThanDays = options.olderThan ?? DEFAULT_RECONCILE_AGE_DAYS;
      if (typeof olderThanDays !== 'number' || !Number.isFinite(olderThanDays) || olderThanDays <= 0) {
        printResult(
          io,
          fail('workspace.reconcile', 'INVALID_AGE_THRESHOLD', `--older-than must be a positive number of days`, { provided: options.olderThan }, ['Use --older-than 7 (or omit it to accept the 7-day default)']),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      const olderThanMs = olderThanDays * MS_PER_DAY;
      const apply = options.apply === true;

      const result = reconcileWorkspace({
        projectRoot,
        apply,
        olderThanMs
      });

      const warnings: string[] = [];
      if (result.sessions.length === 0) {
        warnings.push('No session directories found under .peaks/. Run peaks workspace init first.');
      }
      if (apply && result.deleted.length > 0) {
        warnings.push(`Deleted ${result.deleted.length} session dir(s) older than ${olderThanDays} day(s).`);
      }

      const nextActions: string[] = [];
      if (result.migratedFiles.length > 0) {
        nextActions.push(`Migrated ${result.migratedFiles.length} legacy runtime file(s) into .peaks/_runtime/: ${result.migratedFiles.join(', ')}.`);
      }
      if (result.repointed) {
        nextActions.push(`Re-pointed .peaks/_runtime/session.json from ${result.repointedFrom ?? '<unbound>'} to ${result.repointedTo}.`);
      }
      if (!apply && result.wouldDelete.length > 0) {
        nextActions.push(`Re-run with --apply to delete ${result.wouldDelete.length} candidate dir(s).`);
      }
      if (result.changeMarker.created !== null) {
        nextActions.push(`Synced change/<${result.changeMarker.created}>/ live marker.`);
      } else if (result.canonicalSessionId !== null) {
        nextActions.push(`change/<${result.canonicalSessionId}>/ live marker already in place.`);
      }
      if (result.changeMarker.removed.length > 0) {
        nextActions.push(`Removed ${result.changeMarker.removed.length} stale change/<oldSid>/ marker(s).`);
      }
      if (result.systemCleaned.length > 0) {
        nextActions.push(`Removed ${result.systemCleaned.length} F3 system/ subdir(s).`);
      }
      if (result.subAgentStateMigrated > 0) {
        nextActions.push(`Migrated ${result.subAgentStateMigrated} legacy sub-agent state file(s) into .peaks/_sub_agents/.`);
      }

      printResult(io, ok('workspace.reconcile', result, warnings, nextActions), options.json);

      if (result.errors.length > 0) {
        process.exitCode = 1;
      }
    } catch (error) {
      printResult(
        io,
        fail('workspace.reconcile', 'WORKSPACE_RECONCILE_FAILED', getErrorMessage(error), { projectRoot: options.project }, ['Verify the project path exists and is writable']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    workspace
      .command('migrate')
      .description(
        'Migrate legacy `.peaks/<session-id>/<role>/<file>` content into the new layout: ' +
          '`.peaks/retrospective/<change-id>/<role>/<file>`. Each file is routed by a 4-tier ' +
          'change-id resolver (filename regex → content H1 → body frontmatter → per-session fallback ' +
          'to the most recent rd/requests entry). Cross-cutting files (project-scan, perf-baseline) ' +
          'and transient runtime files (session.json, system/) are skipped with reasons in the ' +
          'response. By default the command is a dry-run: it reports the planned moves + conflicts ' +
          'and the session dirs that WOULD be deleted. Pass --apply to actually `git mv` the files ' +
          'and `rm -rf` the emptied session dirs. Idempotent: re-running on an already-migrated tree ' +
          'is a no-op (all files report conflicts with identical content).' +
          '\n\nSlice 003 (--to-runtime): moves every top-level `.peaks/<sid>/` to `.peaks/_runtime/<sid>/` ' +
          'for projects still on the pre-runtime-layer layout. Idempotent: re-running on a tree ' +
          'that is already canonical is a no-op. F15 carve-out: top-level `rd/project-scan.md` is ' +
          'never overwritten when the runtime copy already exists with different content.'
      )
      .requiredOption('--project <path>', 'target project root')
      .option('--apply', 'actually `git mv` the files and delete the emptied session dirs (destructive); without it, dry-run only', false)
      .option(
        '--to-runtime',
        'slice 003: also consolidate every top-level .peaks/<sid>/ dir into .peaks/_runtime/<sid>/. Idempotent; conflicts are logged but never overwrite.',
        false
      )
  ).action(async (options: { project: string; apply?: boolean; toRuntime?: boolean; json?: boolean }) => {
    try {
      const projectRoot = resolveCanonicalProjectRoot(options.project);
      const apply = options.apply === true;
      const toRuntime = options.toRuntime === true;
      const result = await migrateWorkspace({ projectRoot, apply, toRuntime });

      const warnings: string[] = [];
      if (result.sessions.length === 0 && (result.toRuntimePlans?.length ?? 0) === 0) {
        warnings.push('No legacy session directories found under .peaks/. Nothing to migrate.');
      } else if (result.wouldMove.length === 0 && (result.toRuntimePlans?.length ?? 0) === 0) {
        warnings.push('Legacy session dirs found but no reviewable content to migrate (all files were cross-cutting or transient).');
      }

      const nextActions: string[] = [];
      if (!apply && result.wouldMove.length > 0) {
        nextActions.push(`Re-run with --apply to perform ${result.wouldMove.length} move(s) and delete ${result.wouldDeleteSessions.length} session dir(s).`);
      }
      if (result.conflicts.length > 0) {
        nextActions.push(`${result.conflicts.length} file(s) already exist at the target path; review before --apply (or re-run after a partial migrate).`);
      }
      if (toRuntime) {
        const plans = result.toRuntimePlans ?? [];
        if (apply) {
          if ((result.toRuntimeMoved?.length ?? 0) > 0) {
            nextActions.push(`Moved ${result.toRuntimeMoved?.length} top-level session dir(s) to .peaks/_runtime/ (slice 003 --to-runtime).`);
          }
          if ((result.toRuntimeConflicts?.length ?? 0) > 0) {
            nextActions.push(`${result.toRuntimeConflicts?.length} --to-runtime conflict(s) — see response. ${plans.filter((p) => p.action === 'f15-conflict-project-scan').length} are F15 carve-outs (deferred to a separate slice).`);
          }
        } else {
          const wouldMoveCount = plans.filter((p) => p.action === 'moved').length;
          const wouldSkipCount = plans.filter((p) => p.action === 'skipped-already-canonical').length;
          if (wouldMoveCount > 0) {
            nextActions.push(`Re-run with --apply to move ${wouldMoveCount} top-level session dir(s) to .peaks/_runtime/; ${wouldSkipCount} already canonical.`);
          } else if (wouldSkipCount > 0) {
            nextActions.push(`All ${wouldSkipCount} top-level session dir(s) are already canonical — no moves needed.`);
          }
          const f15Count = plans.filter((p) => p.action === 'f15-conflict-project-scan').length;
          if (f15Count > 0) {
            nextActions.push(`${f15Count} F15 carve-out conflict(s) (rd/project-scan.md differs from runtime copy) — see response.`);
          }
        }
      }
      if (apply) {
        if (result.moved.length > 0) {
          nextActions.push(`Migrated ${result.moved.length} file(s) into .peaks/retrospective/.`);
        }
        if (result.deletedSessions.length > 0) {
          nextActions.push(`Deleted ${result.deletedSessions.length} emptied session dir(s).`);
        }
      }

      printResult(io, ok('workspace.migrate', result, warnings, nextActions), options.json ?? false);
    } catch (error) {
      printResult(io, fail('workspace.migrate', 'WORKSPACE_MIGRATE_FAILED', getErrorMessage(error), { projectRoot: options.project }, ['Verify the project path exists and is writable']), options.json ?? false);
      process.exitCode = 1;
    }
  });

  // Slice 0.5 Task 9: wire the clean and archive subcommands to the
  // workspace-clean-service and workspace-archive-service that Tasks 6-8
  // introduced. Both subcommands follow the project-wide JSON-envelope
  // contract: `--json` writes `{ ok, data }` to stdout, otherwise the
  // envelope is suppressed. Both default to dry-run; pass `--apply` to
  // commit. The skill surfaces consume this JSON to gate downstream
  // decisions (see peaks-solo SKILL.md).
  workspace
    .command('clean')
    .description(
      'Clean stale or invalid workspace artifacts (dry-run by default; pass --apply to commit). ' +
        'Combines two cleanup axes: --runtime prunes _runtime/<sid>/ directories older than ' +
        '--older-than hours (with --grace-hours safety window); --sub-agents --invalid moves ' +
        'bare/invalid sids from _sub_agents/ to _archive/invalid-sids/.'
    )
    .option('--runtime', 'clean _runtime/ sessions older than --older-than')
    .option('--sub-agents', 'clean _sub_agents/ entries')
    .option('--invalid', 'with --sub-agents: only move bare/invalid sids to _archive/invalid-sids/')
    .option('--older-than <hours>', 'age threshold in hours (default 168 = 7d)', '168')
    .option('--grace-hours <hours>', 'safety grace period in hours added to --older-than (default 24)', '24')
    .option('--apply', 'actually write changes (default is dry-run)')
    .option('--project <path>', 'project root (defaults to current directory)', process.cwd())
    .option('--json', 'emit a JSON envelope { ok, data } to stdout')
    .action((opts: {
      runtime?: boolean;
      subAgents?: boolean;
      invalid?: boolean;
      olderThan: string;
      graceHours: string;
      apply?: boolean;
      project: string;
      json?: boolean;
    }) => {
      try {
        const projectRoot = resolveCanonicalProjectRoot(opts.project);
        const apply = opts.apply === true;
        const envelopes: unknown[] = [];
        if (opts.runtime === true) {
          const result = executeRuntimeCleanup(projectRoot, {
            olderThanHours: Number.parseInt(opts.olderThan, 10),
            graceHours: Number.parseInt(opts.graceHours, 10),
            apply
          });
          envelopes.push({ dryRun: !apply, deleted: result.deleted, skipped: result.skipped });
        }
        if (opts.subAgents === true && opts.invalid === true) {
          const result = executeSubAgentClean(projectRoot, { apply });
          envelopes.push({ dryRun: !apply, moved: result.moved, skipped: result.skipped });
        }
        if (opts.json === true) {
          process.stdout.write(JSON.stringify({ ok: true, data: envelopes }) + '\n');
        }
      } catch (error) {
        if (opts.json === true) {
          process.stdout.write(JSON.stringify({ ok: false, error: getErrorMessage(error) }) + '\n');
        } else {
          process.stderr.write(getErrorMessage(error) + '\n');
        }
        process.exitCode = 1;
      }
    });

  workspace
    .command('archive')
    .description(
      'Archive a session from _runtime/<sid>/ to _archive/<yyyy-mm>/<sid>/ ' +
        'where <yyyy-mm> is derived from the sid prefix. Dry-run by default; ' +
        'pass --apply to commit. The --session sid must match the canonical ' +
        'YYYY-MM-DD-... format enforced by the SID naming guard.'
    )
    .requiredOption('--session <sid>', 'session id in YYYY-MM-DD-<slug> form')
    .option('--apply', 'actually move the session (default is dry-run)')
    .option('--project <path>', 'project root (defaults to current directory)', process.cwd())
    .option('--json', 'emit a JSON envelope { ok, data } to stdout')
    .action((opts: { session: string; apply?: boolean; project: string; json?: boolean }) => {
      try {
        const projectRoot = resolveCanonicalProjectRoot(opts.project);
        const apply = opts.apply === true;
        const result = archiveSession(projectRoot, { sid: opts.session, apply });
        if (opts.json === true) {
          process.stdout.write(
            JSON.stringify({
              ok: true,
              data: { dryRun: !apply, moved: result.moved, skipped: result.skipped }
            }) + '\n'
          );
        }
      } catch (error) {
        if (opts.json === true) {
          process.stdout.write(JSON.stringify({ ok: false, error: getErrorMessage(error) }) + '\n');
        } else {
          process.stderr.write(getErrorMessage(error) + '\n');
        }
        process.exitCode = 1;
      }
    });

  // R004: subcommand to physically move per-session files from the legacy
  // `.peaks/<sid>/<role>/<file>.md` path to the canonical
  // `.peaks/_runtime/<sid>/<role>/<file>.md` path. The 2-tier fallback in
  // artifact-prerequisites.ts accepts either location, so this command is
  // purely a UX / filesystem-cleanup helper — the functional behavior is
  // already correct without it.
  registerMigrate1_4_1Command(workspace, io);
}

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
