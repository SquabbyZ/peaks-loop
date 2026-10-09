// Split out of `workspace/init-command.ts`:
// project-root + session resolution, the `initWorkspace` call itself, and the
// optional `.peaks/project-scan/` bootstrap.
import { resolveWritableProjectRoot } from '../../../services/config/config-safety.js';
import {
  initWorkspace,
  type WorkspaceInitReport
} from '../../../services/workspace/workspace-service.js';
import { ensureSessionWithRotation } from '../../../services/session/session-manager.js';
import {
  bootstrapProjectScan,
  type BootstrapProjectScanEnvelope
} from '../../../services/prd/project-scan-bootstrap-service.js';
import { getErrorMessage } from '../../cli-helpers.js';
import type { WorkspaceInitOptions, WorkspaceInitRotation } from './init-options.js';

/** Everything one `peaks workspace init` run carries into its envelope phase. */
export type WorkspaceInitContext = {
  options: WorkspaceInitOptions;
  projectRoot: string;
  sessionId: string;
  rotation: WorkspaceInitRotation;
  report: WorkspaceInitReport;
  projectScanEnvelope: BootstrapProjectScanEnvelope | null;
  projectScanError: string | null;
};

type InitTarget = {
  projectRoot: string;
  sessionId: string;
  rotation: WorkspaceInitRotation;
};

/**
 * Resolve the project root and the session id. Two paths:
 *   - explicit --session-id: use it as the requested binding target
 *     (ConflictingSessionError fires if it conflicts with an in-flight
 *     session, unless --allow-session-rebind is set)
 *   - omitted: defer to ensureSession(), which reuses an existing
 *     binding or auto-generates a fresh one. The init then writes
 *     .peaks/_runtime/session.json so the binding sticks.
 *
 * Before that: canonicalise the project root. If the user (or the
 * LLM via "$(pwd)") passed a sub-directory of a real git repo
 * (e.g. prompt-project/prompt-project/ inside the outer
 * prompt-project/.git), promote the path to the git root. Without
 * this, peaks would build a parallel .peaks/ tree under the
 * nested sub-folder and silently break the project-binding model
 * (the same regression that produced prompt-project/.peaks/ in
 * the 5/27-5/29 sessions). When startPath is not inside any
 * git repo, the helper falls through to the cwd verbatim.
 * `resolveWritableProjectRoot` = `resolveCanonicalProjectRoot` plus the
 * home-directory refusal. It has to be this one, and it has to run here:
 * `ensureSessionWithRotation` below WRITES (it mints/binds a session), so
 * a guard placed after it would leave a `.peaks/_runtime/` tree in the
 * user's home even though the init was refused.
 */
export async function resolveInitTarget(options: WorkspaceInitOptions): Promise<InitTarget> {
  const projectRoot = resolveWritableProjectRoot(options.project);
  let sessionId: string;
  let rotation: WorkspaceInitRotation = {
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
  return { projectRoot, sessionId, rotation };
}

export async function runInitWorkspace(
  options: WorkspaceInitOptions,
  projectRoot: string,
  sessionId: string
): Promise<WorkspaceInitReport> {
  return initWorkspace({
    projectRoot,
    sessionId,
    allowSessionRebind: options.allowSessionRebind === true,
    // Commander translates `--no-claude-hooks` into
    // `options.claudeHooks = false`. The default (no flag) leaves
    // `options.claudeHooks` undefined, which is not equal to
    // `false`, so the default is "install hooks" (the bypass is
    // on). Pass `--no-claude-hooks` to opt out.
    noClaudeHooks: options.claudeHooks === false,
    // auto-apply for the missing-standards scaffold. Default false
    // — only the diagnostic is emitted. Pass --init-standards to
    // also run `executeProjectStandardsInit({ apply: true })`.
    initStandards: options.initStandards === true
  });
}

/**
 * After the workspace dir is initialized, also bootstrap the
 * `.peaks/project-scan/` artifact tree (project-scan.md + 4
 * bundled audit/business templates). Idempotent — when the user
 * re-runs `workspace init`, the existing files are kept (their
 * sediment is user-authored). Pass `--no-project-scan-bootstrap`
 * to skip, or `--force-project-scan-templates` to overwrite the
 * 4 bundled templates anyway.
 */
export async function bootstrapProjectScanForInit(
  options: WorkspaceInitOptions,
  projectRoot: string
): Promise<{ envelope: BootstrapProjectScanEnvelope | null; error: string | null }> {
  if (options.projectScanBootstrap === false) {
    // Explicit opt-out. The envelope stays null; the JSON
    // response carries `projectScan: { skipped: true, ... }` so
    // callers can distinguish "skipped by flag" from "skipped by
    // idempotency".
    return {
      envelope: {
        created: false,
        skipped: true,
        templatesBooted: 0,
        templatesSkipped: 0,
        projectScanPath: `${projectRoot}/.peaks/project-scan/project-scan.md`,
        durationMs: 0
      },
      error: null
    };
  }
  try {
    const envelope = await bootstrapProjectScan({
      projectRoot,
      ...(options.forceProjectScanTemplates === true ? { forceTemplates: true } : {})
    });
    return { envelope, error: null };
  } catch (error) {
    // Don't fail init over a project-scan issue — the workspace
    // is already initialized and the user has the JSON envelope.
    // Surface the failure as a warning so the LLM can decide.
    return { envelope: null, error: getErrorMessage(error) };
  }
}
