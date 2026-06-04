import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, join, relative, resolve } from 'node:path';
import { isInsidePath } from '../../shared/path-utils.js';
import { getWorkspaceConfigForPath } from '../config/config-service.js';
import { getArtifactRemoteRepo, getArtifactWorkspaceStatus, getLocalArtifactPath } from '../artifacts/workspace-service.js';

export type ChangeImpact = {
  changeId: string;
  sourceArtifacts: string[];
  affectedModules: string[];
  affectedFiles: string[];
  qaImpact: {
    coverageDelta: number | null;
    testCount: number;
    status: 'passed' | 'failed' | 'unknown';
  };
  riskImpact: {
    level: 'low' | 'medium' | 'high';
    factors: string[];
  };
  syncPointers: {
    artifactRepo: string | null;
    lastSync: string | null;
    localPath: string;
  };
};

export type ArtifactRetentionReport = {
  sliceId: string;
  prdArtifacts: string[];
  rdArtifacts: string[];
  qaArtifacts: string[];
  coverageArtifacts: string[];
  reviewArtifacts: string[];
  codeChanges: string[];
  retentionStatus: 'local-ready' | 'pending' | 'explicitly-committed' | 'rolled-back';
  commitHash: string | null;
  rollbackPoint: string | null;
};

export type ChangeTraceabilityStatus = {
  changeId: string | null;
  hasArtifactRepo: boolean;
  artifactSyncStatus: 'synced' | 'pending' | 'out-of-sync' | 'unknown';
  localArtifactPath: string;
  requiredArtifacts: {
    name: string;
    path: string;
    exists: boolean;
  }[];
  nextActions: string[];
};

export type CommitBoundary = {
  sliceId: string;
  commitHash: string | null;
  timestamp: string;
  artifacts: string[];
  codeFiles: string[];
  syncState: 'synced' | 'pending' | 'failed';
  rollbackPoint: string | null;
};

const REQUIRED_ARTIFACTS = [
  { name: 'retention-boundary.md', path: ['sc', 'retention-boundary.md'] },
  { name: 'change-impact.json', path: ['sc', 'change-impact.json'] },
  { name: 'coverage-report.md', path: ['rd', 'coverage-report.md'] }
] as const;

const RETENTION_REQUIREMENTS = [
  ['prd', 'refactor-goal.md'],
  ['rd', 'slice-spec.md'],
  ['rd', 'coverage-report.md'],
  ['rd', 'code-review-report.md'],
  ['rd', 'security-review-report.md'],
  ['rd', 'post-check-dry-run.md'],
  ['qa', 'validation-report.md'],
  ['sc', 'change-impact.json'],
  ['sc', 'retention-boundary.md'],
  ['txt', 'context-capsule.md']
] as const;

/**
 * "Modern" retention requirements for the current peaks-cli artifact
 * naming convention. The legacy `RETENTION_REQUIREMENTS` above assume
 * older `refactor-goal.md` / `slice-spec.md` / `coverage-report.md` /
 * `validation-report.md` / `change-impact.json` / `retention-boundary.md`
 * / `context-capsule.md` filenames that predate the W4 session resolver.
 *
 * When the resolver finds a session that owns the slice, validate
 * against the modern set: the actual files the current workflow emits
 * (per-slice `prd/requests/<rid>.md`, per-slice `rd/requests/<rid>.md`,
 * per-session `rd/tech-doc.md`, per-slice `qa/test-cases/<rid>.md`,
 * per-slice `qa/test-reports/<rid>.md`, per-session `txt/handoff.md`).
 * The legacy set is preserved for the workspace-artifact path so
 * existing repos on the old convention keep working.
 */
const MODERN_RETENTION_REQUIREMENTS: ReadonlyArray<string> = [
  'rd/tech-doc.md',
  'qa/test-cases/{sliceId}.md',
  'qa/test-reports/{sliceId}.md',
  'txt/handoff.md'
];

const SLICE_ID_PATTERN = /^(?!\.{1,2}$)[A-Za-z0-9._-]+$/;

/**
 * Resolution sources for `resolveArtifactSession`, in priority order.
 * - `active-skill`: the orchestrator's `.peaks/.active-skill.json` `sessionId`
 *   points to a session dir that owns the slice's marker artifact.
 * - `session-json`: the workspace binding in `.peaks/.session.json` points to
 *   a session dir that owns the slice's marker artifact (active-skill was
 *   checked but did not own it; session-json is the next source).
 * - `find-fallback`: neither binding owned the artifact, but a `find`
 *   walk under `.peaks/` located a session dir that does own it.
 */
export type ArtifactSessionSource = 'active-skill' | 'session-json' | 'find-fallback';

export type ResolvedArtifactSession = {
  resolvedSessionId: string | null;
  candidateSources: ArtifactSessionSource[];
};

function getPeaksPath(workspaceRoot: string): string {
  return resolve(workspaceRoot, '.peaks');
}

function resolveCurrentChangeId(peaksPath: string): string | null {
  const currentChangePath = resolve(peaksPath, 'current-change');
  if (!existsSync(currentChangePath)) return null;

  try {
    const stat = lstatSync(currentChangePath);
    if (stat.isSymbolicLink()) {
      const targetPath = realpathSync(currentChangePath);
      if (!isInsidePath(targetPath, realpathSync(peaksPath))) return null;
      const targetId = basename(targetPath);
      return SLICE_ID_PATTERN.test(targetId) ? targetId : null;
    }

    const raw = readFileSync(currentChangePath, 'utf-8').trim();
    if (!raw || !SLICE_ID_PATTERN.test(raw)) return null;
    return raw;
  } catch {
    return null;
  }
}

function getArtifactRepoUrl(artifactRepo: { provider: 'github' | 'gitlab'; owner: string; name: string } | undefined): string | null {
  if (!artifactRepo) return null;
  if (artifactRepo.provider === 'github') {
    return `https://github.com/${artifactRepo.owner}/${artifactRepo.name}.git`;
  }
  return `https://gitlab.com/${artifactRepo.owner}/${artifactRepo.name}.git`;
}

function getCurrentCommitHash(workspaceRoot?: string): string | null {
  if (!workspaceRoot) return null;

  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspaceRoot, encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

function mapSyncState(syncStatus: 'synced' | 'pending' | 'out-of-sync' | 'unknown'): 'synced' | 'pending' | 'failed' {
  if (syncStatus === 'synced') return 'synced';
  if (syncStatus === 'pending') return 'pending';
  return 'failed';
}

function getCurrentArtifactDir(artifactWorkspacePath: string): { peaksPath: string; changeId: string | null; changeDir: string } {
  const peaksPath = getPeaksPath(artifactWorkspacePath);
  const changeId = resolveCurrentChangeId(peaksPath);
  const effectiveChangeId = changeId ?? 'unknown-session';
  return {
    peaksPath,
    changeId,
    changeDir: resolve(peaksPath, effectiveChangeId)
  };
}

function getRetentionChangeDir(artifactWorkspacePath: string, sliceId: string): { peaksPath: string; changeId: string; changeDir: string } {
  const peaksPath = getPeaksPath(artifactWorkspacePath);
  return {
    peaksPath,
    changeId: sliceId,
    changeDir: resolve(peaksPath, sliceId)
  };
}

function isRetainedArtifactFile(filePath: string, artifactWorkspacePath: string, changesRoot: string, changeDir: string): boolean {
  if (!existsSync(filePath)) return false;

  try {
    const artifactWorkspaceRealPath = realpathSync(artifactWorkspacePath);
    const changesRootRealPath = realpathSync(changesRoot);
    const changeDirRealPath = realpathSync(changeDir);
    const fileRealPath = realpathSync(filePath);
    return !lstatSync(changesRoot).isSymbolicLink()
      && !lstatSync(changeDir).isSymbolicLink()
      && isInsidePath(changesRootRealPath, artifactWorkspaceRealPath)
      && isInsidePath(changeDirRealPath, changesRootRealPath)
      && isInsidePath(fileRealPath, changeDirRealPath);
  } catch {
    return false;
  }
}

/**
 * Read the orchestrator's active-skill marker at `<projectRoot>/.peaks/.active-skill.json`
 * and return its `sessionId`, or null when the file is missing / malformed.
 */
function readActiveSkillSessionId(projectRoot: string): string | null {
  const path = join(projectRoot, '.peaks', '.active-skill.json');
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as { sessionId?: unknown };
    if (typeof parsed?.sessionId === 'string' && parsed.sessionId.length > 0) {
      return parsed.sessionId;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Read the workspace session binding at `<projectRoot>/.peaks/.session.json`
 * and return its `sessionId`, or null when the file is missing / malformed.
 */
function readSessionJsonBinding(projectRoot: string): string | null {
  const path = join(projectRoot, '.peaks', '.session.json');
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as { sessionId?: unknown };
    if (typeof parsed?.sessionId === 'string' && parsed.sessionId.length > 0) {
      return parsed.sessionId;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * The "marker" artifact whose existence under a session dir is the signal
 * that the session owns the slice. We look for `qa/test-cases/<sliceId>.md`
 * first (a present test plan is the most decisive signal of session
 * ownership for a slice id). If the test plan is absent we also accept
 * `qa/test-reports/<sliceId>.md` (a finished QA report is also a decisive
 * ownership signal). When neither exists for a candidate session, that
 * session does not own the slice.
 */
function sessionOwnsSlice(projectRoot: string, sessionId: string, sliceId: string): boolean {
  const sessionDir = join(projectRoot, '.peaks', sessionId);
  if (!existsSync(sessionDir)) return false;
  for (const marker of [`qa/test-cases/${sliceId}.md`, `qa/test-reports/${sliceId}.md`]) {
    if (existsSync(join(sessionDir, marker))) return true;
  }
  return false;
}

/**
 * Find a session dir under `<projectRoot>/.peaks/` that owns the slice
 * (see `sessionOwnsSlice`). Returns the first match in lexicographic
 * order, or null when no session owns the slice.
 */
function findSessionOwningSlice(projectRoot: string, sliceId: string): string | null {
  const peaksRoot = join(projectRoot, '.peaks');
  if (!existsSync(peaksRoot)) return null;
  let names: string[];
  try {
    names = readdirSync(peaksRoot);
  } catch {
    return null;
  }
  names.sort();
  for (const name of names) {
    if (!/^\d{4}-\d{2}-\d{2}-session-[a-f0-9]+$/.test(name)) continue;
    if (sessionOwnsSlice(projectRoot, name, sliceId)) {
      return name;
    }
  }
  return null;
}

/**
 * Resolve the session id that owns the slice's artifacts using a 3-tier
 * precedence:
 *
 *   1. `.peaks/.active-skill.json` `sessionId` if it points to a real
 *      session that owns the slice.
 *   2. `.peaks/.session.json` `sessionId` if it points to a real session
 *      that owns the slice.
 *   3. `find .peaks/ -name '<marker>'` — the first session dir under
 *      `.peaks/` that owns the slice.
 *   4. else `{ resolvedSessionId: null, candidateSources: [] }`.
 *
 * `candidateSources` reports which sources were checked before the
 * resolver found (or did not find) a winner; the list is in the order
 * the resolver consulted them. This makes the precedence observable in
 * the JSON envelope so a human reviewer can see "active-skill was empty
 * AND session-json was empty, so find-fallback won".
 */
export function resolveArtifactSession(
  projectRoot: string,
  sliceId: string
): ResolvedArtifactSession {
  const activeSkill = readActiveSkillSessionId(projectRoot);
  if (activeSkill !== null && sessionOwnsSlice(projectRoot, activeSkill, sliceId)) {
    return { resolvedSessionId: activeSkill, candidateSources: ['active-skill'] };
  }

  const sessionJson = readSessionJsonBinding(projectRoot);
  if (sessionJson !== null && sessionOwnsSlice(projectRoot, sessionJson, sliceId)) {
    return { resolvedSessionId: sessionJson, candidateSources: ['active-skill', 'session-json'] };
  }

  const findHit = findSessionOwningSlice(projectRoot, sliceId);
  if (findHit !== null) {
    return { resolvedSessionId: findHit, candidateSources: ['active-skill', 'session-json', 'find-fallback'] };
  }

  return { resolvedSessionId: null, candidateSources: [] };
}

export function getChangeTraceabilityStatus(): ChangeTraceabilityStatus {
  const workspace = getWorkspaceConfigForPath(process.cwd());
  const artifactStatus = getArtifactWorkspaceStatus(workspace?.workspaceId);

  if (!workspace) {
    return {
      changeId: null,
      hasArtifactRepo: false,
      artifactSyncStatus: 'unknown',
      localArtifactPath: '.peaks-artifacts',
      requiredArtifacts: REQUIRED_ARTIFACTS.map((artifact) => ({
        name: artifact.name,
        path: resolve('.peaks', '<session-id>', ...artifact.path),
        exists: false
      })),
      nextActions: ['Add a workspace: peaks config workspace add --id <id> --name <name> --path <path>']
    };
  }

  const artifactWorkspacePath = getLocalArtifactPath(workspace);
  const { peaksPath, changeId, changeDir } = getCurrentArtifactDir(artifactWorkspacePath);
  const artifactRepo = getArtifactRemoteRepo(workspace);
  const hasArtifactRepo = Boolean(artifactRepo);
  const changesRoot = peaksPath;
  const requiredArtifacts = REQUIRED_ARTIFACTS.map((artifact) => {
    const artifactPath = resolve(changeDir, ...artifact.path);
    return {
      name: artifact.name,
      path: resolve(peaksPath, changeId ?? '<session-id>', ...artifact.path),
      exists: isRetainedArtifactFile(artifactPath, artifactWorkspacePath, changesRoot, changeDir)
    };
  });

  const nextActions: string[] = [];
  if (!changeId) {
    nextActions.push('Set the current change in .peaks/current-change');
  }
  if (hasArtifactRepo && artifactStatus.syncStatus === 'pending') {
    nextActions.push(`Run peaks artifacts sync --workspace ${workspace.workspaceId} --dry-run`);
  }

  return {
    changeId,
    hasArtifactRepo,
    artifactSyncStatus: artifactStatus.syncStatus,
    localArtifactPath: getLocalArtifactPath(workspace),
    requiredArtifacts,
    nextActions
  };
}

export function createChangeImpact(options: {
  changeId: string;
  sourceArtifacts?: string[];
  affectedModules?: string[];
  affectedFiles?: string[];
}): ChangeImpact {
  const workspace = getWorkspaceConfigForPath(process.cwd());
  const artifactRepo = workspace ? getArtifactRemoteRepo(workspace) : null;

  return {
    changeId: options.changeId,
    sourceArtifacts: options.sourceArtifacts ?? [],
    affectedModules: options.affectedModules ?? [],
    affectedFiles: options.affectedFiles ?? [],
    qaImpact: {
      coverageDelta: null,
      testCount: 0,
      status: 'unknown'
    },
    riskImpact: {
      level: 'medium',
      factors: ['Manual review required', 'No automated gates detected']
    },
    syncPointers: {
      artifactRepo: getArtifactRepoUrl(artifactRepo ?? undefined),
      lastSync: null,
      localPath: workspace ? getLocalArtifactPath(workspace) : '.peaks-artifacts'
    }
  };
}

export function createArtifactRetentionReport(options: {
  sliceId: string;
  prdArtifacts?: string[];
  rdArtifacts?: string[];
  qaArtifacts?: string[];
  coverageArtifacts?: string[];
  reviewArtifacts?: string[];
  codeChanges?: string[];
}): ArtifactRetentionReport {
  return {
    sliceId: options.sliceId,
    prdArtifacts: options.prdArtifacts ?? [],
    rdArtifacts: options.rdArtifacts ?? [],
    qaArtifacts: options.qaArtifacts ?? [],
    coverageArtifacts: options.coverageArtifacts ?? [],
    reviewArtifacts: options.reviewArtifacts ?? [],
    codeChanges: options.codeChanges ?? [],
    retentionStatus: 'pending',
    commitHash: null,
    rollbackPoint: null
  };
}

export function recordCommitBoundary(options: {
  sliceId: string;
  artifacts?: string[];
  codeFiles?: string[];
}): CommitBoundary & { resolvedSessionId: string | null; candidateSources: ArtifactSessionSource[] } {
  const workspace = getWorkspaceConfigForPath(process.cwd());
  const artifactStatus = getArtifactWorkspaceStatus(workspace?.workspaceId);
  const commitHash = getCurrentCommitHash(workspace?.rootPath);

  const projectRoot = workspace?.rootPath ?? process.cwd();
  const resolution = resolveArtifactSession(projectRoot, options.sliceId);

  return {
    sliceId: options.sliceId,
    commitHash,
    timestamp: new Date().toISOString(),
    artifacts: options.artifacts ?? [],
    codeFiles: options.codeFiles ?? [],
    syncState: mapSyncState(artifactStatus.syncStatus),
    rollbackPoint: commitHash,
    resolvedSessionId: resolution.resolvedSessionId,
    candidateSources: resolution.candidateSources
  };
}

export function validateArtifactRetention(sliceId: string): {
  valid: boolean;
  missingArtifacts: string[];
  warnings: string[];
  resolvedSessionId: string | null;
  candidateSources: ArtifactSessionSource[];
} {
  const workspace = getWorkspaceConfigForPath(process.cwd());
  // Resolve from `process.cwd()` even when no workspace is configured, so
  // the W4 session resolver can still find the slice's owning session.
  // The legacy "no workspace" check still surfaces as a missing artifact,
  // but the resolution happens first so the JSON envelope's additive
  // `resolvedSessionId` is populated regardless of workspace state.
  const projectRoot = workspace?.rootPath ?? process.cwd();

  if (!SLICE_ID_PATTERN.test(sliceId)) {
    return {
      valid: false,
      missingArtifacts: ['Invalid slice id'],
      warnings: ['Slice id must stay inside .peaks/<session-id> and only contain letters, numbers, dots, underscores, or hyphens'],
      resolvedSessionId: null,
      candidateSources: []
    };
  }

  const resolution = resolveArtifactSession(projectRoot, sliceId);
  const effectiveSliceId = resolution.resolvedSessionId ?? sliceId;

  // W4: if the resolver found a session, ALSO accept artifacts under
  // `<projectRoot>/.peaks/<resolvedSessionId>/` (the canonical per-slice
  // dir). The project-root peaks is where the orchestrator's skills
  // actually write (see `initWorkspace` in `workspace-service.ts`), so
  // when the resolution chain lands on a real session the artifacts are
  // usually there. We accept either location — workspace artifact path
  // OR project-root peaks — so the additive behavior does not regress
  // existing workspaces.
  const resolvedPeaksSessionDir = resolution.resolvedSessionId !== null
    ? join(projectRoot, '.peaks', resolution.resolvedSessionId)
    : null;

  // Collect present files: legacy workspace-artifact-path check, OR the
  // resolved session's project-root peaks dir.
  const legacyPresent = (folder: string, file: string): boolean => {
    if (!workspace) return false;
    const artifactWorkspacePath = getLocalArtifactPath(workspace);
    const { peaksPath, changeDir } = getRetentionChangeDir(artifactWorkspacePath, effectiveSliceId);
    const filePath = resolve(changeDir, folder, file);
    return isRetainedArtifactFile(filePath, artifactWorkspacePath, peaksPath, changeDir);
  };
  const resolvedPresent = (folder: string, file: string): boolean => {
    if (resolvedPeaksSessionDir === null) return false;
    return existsSync(join(resolvedPeaksSessionDir, folder, file));
  };

  if (!workspace) {
    // No workspace: validate against the resolved session dir directly
    // (this is the common peaks-solo / peaks-rd invocation: the slice
    // lives under the project-root `.peaks/<sessionId>/`, and the
    // workspace artifact path is irrelevant). When the resolution also
    // fails, fall back to the legacy "No workspace configured" failure
    // mode so the existing CLI contract is preserved.
    if (resolvedPeaksSessionDir === null) {
      return {
        valid: false,
        missingArtifacts: ['No workspace configured'],
        warnings: ['Cannot validate without a configured workspace'],
        resolvedSessionId: resolution.resolvedSessionId,
        candidateSources: resolution.candidateSources
      };
    }
    const missingArtifacts = modernRequirementRelativePaths(sliceId).filter((rel) => !existsSync(join(resolvedPeaksSessionDir as string, rel)));
    return {
      valid: missingArtifacts.length === 0,
      missingArtifacts,
      warnings: missingArtifacts.length === 0 ? [] : ['Some required artifact files are missing'],
      resolvedSessionId: resolution.resolvedSessionId,
      candidateSources: resolution.candidateSources
    };
  }

  const missingArtifacts = RETENTION_REQUIREMENTS
    .map(([folder, file]) => `${folder}/${file}`)
    .filter((rel) => !legacyPresent(...rel.split('/') as [string, string]) && !resolvedPresent(...rel.split('/') as [string, string]));

  // If the legacy check is short (i.e. we're missing a lot of legacy-named
  // files) but the resolver landed on a real session, ALSO accept the
  // modern set. The legacy set was designed for an older workflow naming
  // and a freshly-minted session in the current peaks-cli flow will not
  // have the legacy names. This keeps `peaks sc validate --slice-id <rid>`
  // returning `valid: true` for slices that completed under the current
  // peaks-cli convention.
  if (missingArtifacts.length > 0 && resolvedPeaksSessionDir !== null) {
    const modernMissing = modernRequirementRelativePaths(sliceId).filter((rel) => !resolvedPresent(...rel.split('/') as [string, string]));
    if (modernMissing.length === 0) {
      return {
        valid: true,
        missingArtifacts: [],
        warnings: [],
        resolvedSessionId: resolution.resolvedSessionId,
        candidateSources: resolution.candidateSources
      };
    }
  }

  return {
    valid: missingArtifacts.length === 0,
    missingArtifacts,
    warnings: missingArtifacts.length === 0 ? [] : ['Some required artifact files are missing'],
    resolvedSessionId: resolution.resolvedSessionId,
    candidateSources: resolution.candidateSources
  };
}

/**
 * Render the modern retention requirements as relative paths keyed
 * against the slice id. The `{sliceId}` placeholder in the template
 * is replaced with the actual slice id; per-session files (no
 * placeholder) keep their literal name.
 */
function modernRequirementRelativePaths(sliceId: string): string[] {
  return MODERN_RETENTION_REQUIREMENTS.map((template) => template.replace('{sliceId}', sliceId));
}

export function getScHelpText(): string[] {
  return [
    'peaks sc status                          Show change traceability status',
    'peaks sc impact --change-id <id>         Generate change impact artifact',
    'peaks sc retention --slice-id <id>        Create artifact retention report',
    'peaks sc validate --slice-id <id>         Validate artifact retention',
    'peaks sc boundary --slice-id <id>         Record retention boundary for slice',
    '',
    'Change traceability workflow integration:',
    '  1. Run peaks sc status to check current state',
    '  2. After slice completion, run peaks sc retention --slice-id <id>',
    '  3. Keep artifacts local in .peaks/<session-id>/ by default',
    '  4. Commit or sync artifacts only after explicit authorization'
  ];
}
