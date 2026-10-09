// The planning helpers `peaks refactor | tech | workflow | swarm` share: the workspace
// context readers, the injected-input parsers, and the pre-step that builds
// peaks-context before peaks-rd runs. No command is registered here.
import { printResult, type ProgramIO } from '../cli-helpers.js';
import { fail } from 'peaks-loop-shared/result';
import { isCodeMode, type CodeMode } from '../../services/workflow/workflow-router-service.js';
import { getWorkspaceConfigForPath } from '../../services/config/config-service.js';
import type { WorkspaceConfig } from '../../services/config/config-types.js';
import { getLocalArtifactPath } from '../../services/artifacts/workspace-service.js';
import { getSessionId } from '../../services/session/session-manager.js';
import { getSessionDir } from '../../services/session/getSessionDir.js';
import { findProjectRoot } from '../../services/config/config-safety.js';
// Plan 1 / Task 9 — auto-build peaks-context before peaks-rd runs.
import { buildContext } from '../../services/context/context-builder.js';
// Plan 1 / Task 10 — production fetcher (replaces mockFetcher).
import { createDocCacheFetcher } from '../../services/context/doc-cache-fetcher.js';

export function buildDocFetcher(
  sid: string
): import('../../services/context/doc-retriever.js').DocFetcher {
  return createDocCacheFetcher({
    cacheDir: `.peaks/_runtime/${sid}/doc-cache`
    // remoteFetcher wired in a future slice.
  });
}

export async function ensureContextForRd(
  goal: string,
  project: string,
  sid: string
): Promise<void> {
  const out = `.peaks/_runtime/${sid}/context.json`;
  try {
    await buildContext({
      goal,
      project,
      audience: 'peaks-rd',
      depsMode: 'locked',
      docBudgetTokens: 8000,
      out,
      fetcher: buildDocFetcher(sid)
    });
  } catch (error) {
    // Plan 1 / Task 9 — context is a pre-step, not a precondition.
    // If the Collector (e.g. missing package.json) or DocRetriever
    // fails, we still want the rd slice to proceed. Task 11
    // upgrades this to a hard precondition once the rd slice
    // actually consumes context.json.
    const message = error instanceof Error ? error.message : 'unknown context build failure';
    process.stderr.write(`[peaks-context] rd pre-step skipped: ${message}\n`);
  }
}

export interface WorkspaceContext {
  workspace?: WorkspaceConfig;
  artifactWorkspacePath?: string;
  sessionId?: string;
  sessionDir?: string;
  // thread `projectRoot` so CLI callers surface standards overlays (EPEAKS_NO_STANDARDS).
  projectRoot?: string;
}

export interface TechPlanOptions {
  // a CLI option; the planner derives scope from the active session.
  goal: string;
  swarm?: boolean;
  dryRun?: boolean;
  json?: boolean;
}

export interface TechStatusOptions {
  json?: boolean;
}

export interface WorkflowRouteOptions {
  mode: string;
  goal: string;
  codeMode?: string;
  maxWorkers: string;
  dryRun?: boolean;
  json?: boolean;
}

export interface SwarmPlanOptions {
  skill?: string;
  goal: string;
  maxWorkers: string;
  dryRun?: boolean;
  json?: boolean;
  strictStandards?: boolean;
}

export interface AutonomousResumeInitOptions {
  goal: string;
  project: string;
  apply?: boolean;
  json?: boolean;
}

export function getCurrentWorkspaceContext(): WorkspaceContext {
  try {
    const projectRoot = findProjectRoot(process.cwd()) ?? process.cwd();
    const sessionId = getSessionId(projectRoot);
    return sessionId ? { sessionId, sessionDir: getSessionDir(projectRoot, sessionId) } : {};
  } catch {
    return {};
  }
}

export function getWorkflowWorkspaceContext(): WorkspaceContext {
  try {
    const projectRoot = findProjectRoot(process.cwd()) ?? process.cwd();
    const workspace = getWorkspaceConfigForPath(projectRoot);
    if (!workspace) return { projectRoot };
    return { projectRoot, workspace, artifactWorkspacePath: getLocalArtifactPath(workspace) };
  } catch {
    return {};
  }
}

export function parseMaxWorkers(
  io: ProgramIO,
  command: string,
  value: string,
  asJson?: boolean
): number | null {
  const maxWorkers = Number(value);
  if (!Number.isInteger(maxWorkers) || maxWorkers < 1) {
    printResult(
      io,
      fail(command, 'INVALID_MAX_WORKERS', 'max-workers must be a positive integer', {}, [
        'Use --max-workers with a positive integer value'
      ]),
      asJson
    );
    process.exitCode = 1;
    return null;
  }
  return maxWorkers;
}

export function validatePlanningInput(goal: string): void {
  // v2.17.0: change-id axis removed. The planning input is now keyed
  // by the session id (already bound via `peaks workspace init`),
  // not by a user-supplied change-id. Only the goal is validated.
  if (!goal.trim()) {
    throw new Error('Goal must be non-empty');
  }
}

export function parseCodeMode(
  io: ProgramIO,
  command: string,
  mode: string,
  codeMode: string | undefined,
  asJson?: boolean
): CodeMode | undefined | null {
  if (mode !== 'code' && codeMode) {
    printResult(
      io,
      fail(
        command,
        'CODE_MODE_REQUIRES_CODE_WORKFLOW',
        '--code-mode can only be used with --mode code',
        {},
        ['Remove --code-mode or use --mode code']
      ),
      asJson
    );
    process.exitCode = 1;
    return null;
  }

  if (mode !== 'code' || !codeMode) {
    return undefined;
  }

  if (!isCodeMode(codeMode)) {
    printResult(
      io,
      fail(command, 'UNSUPPORTED_CODE_MODE', `Unsupported code mode ${codeMode}`, {}, [
        'Use --code-mode full-auto, guided, or rnd'
      ]),
      asJson
    );
    process.exitCode = 1;
    return null;
  }
  return codeMode;
}
