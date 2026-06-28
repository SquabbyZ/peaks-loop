import { closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { buildArtifactRelativePath, validateChangeIdOrThrow } from '../../shared/change-id.js';
import { WORKSPACE_UNAVAILABLE_NEXT_ACTIONS } from '../../shared/planner-response.js';
import { getLocalArtifactPath, hasValidArtifactWorkspace } from '../artifacts/workspace-service.js';
import { getChangeScopeDirAbs } from '../artifacts/change-scope-service.js';
import { createCapabilityMapPlan } from '../recommendations/capability-map-service.js';
import type { CapabilityAvailabilityStatus, CapabilityItemType } from '../recommendations/recommendation-types.js';
import type { ModelProviderConfig, WorkspaceConfig } from '../config/config-types.js';
import { createRdSwarmPlan, type RdPlanResult } from '../rd/rd-service.js';
import { createWorkflowRouterPlan, type SoloMode, type WorkflowMode, type WorkflowRouterPlan } from './workflow-router-service.js';

export type CapabilitySurface = 'skill' | 'mcp' | 'plugin' | 'expert';
export type CapabilityPurpose =
  | 'code-review'
  | 'security-review'
  | 'coding-standards'
  | 'docs-lookup'
  | 'browser-validation'
  | 'browser-debug'
  | 'design-context'
  | 'design-source'
  | 'code-search'
  | 'database-inspection'
  | 'browser-agent'
  | 'worker-guidance'
  | 'memory'
  | 'context-management'
  | 'ui-components'
  | 'spec-workflow'
  | 'repo-intelligence'
  | 'openspec'
  | 'workflow-methodology'
  | 'workflow-reference'
  | 'workflow-guidance'
  | 'product-guidance'
  | 'design-reference'
  | 'ui-reference'
  | 'engineering-guidance'
  | 'typescript-guidance'
  | 'quality-guidance'
  | 'skill-pack'
  | 'external-skill'
  | 'design-critique'
  | 'design-guidance'
  | 'cloud-skill-pack';

export type CapabilityActivation = 'available' | 'needs-install' | 'needs-credentials' | 'not-active';
export type CapabilityTrustLevel = 'local' | 'user-curated' | 'third-party';

export type CapabilityCandidate = {
  readonly id: string;
  readonly source: string;
  readonly purpose: CapabilityPurpose;
  readonly surface: CapabilitySurface;
  readonly kind: CapabilitySurface;
  readonly sourceType: CapabilityItemType;
  readonly trustLevel: CapabilityTrustLevel;
  readonly activation: CapabilityActivation;
  readonly risk: readonly string[];
};

export type AutonomousWorkflowRequest = {
  readonly mode: WorkflowMode;
  readonly soloMode?: SoloMode;
  readonly changeId: string;
  readonly goal: string;
  readonly maxWorkers?: number;
  readonly dryRun: true;
  readonly artifactWorkspacePath?: string;
  readonly workspace?: WorkspaceConfig;
  readonly config?: {
    readonly economyMode?: boolean;
    readonly swarmMode?: boolean;
    readonly providers?: ModelProviderConfig;
  };
};

export type AutonomousGoalPackage = {
  readonly changeId: string;
  readonly goal: string;
  readonly nonGoals: readonly string[];
  readonly preservedBehavior: readonly string[];
  readonly acceptanceCriteria: readonly string[];
  readonly doneCondition: string;
  readonly resumeCondition: string;
  readonly riskNotes: readonly string[];
};

export type AutonomousCapabilityPlan = {
  readonly sources: readonly string[];
  readonly policy: readonly string[];
  readonly candidates: readonly CapabilityCandidate[];
  readonly surfaces: readonly CapabilitySurface[];
  readonly surfaceSummary: Record<CapabilitySurface, number>;
};

export type AutonomousResumePlan = {
  readonly status: 'preview' | 'ready';
  readonly checkpoints: readonly string[];
  readonly requiredArtifacts: readonly string[];
  readonly resumeInstructions: string;
};

export type AutonomousGoalCommand = {
  readonly command: string;
  readonly durable: false;
  readonly reason: string;
};

export type AutonomousStoragePlan = {
  readonly scope: 'user-local';
  readonly artifactWorkspacePath: string | null;
  readonly memoryBackupPath: string | null;
};

export type AutonomousMvpPackage = {
  readonly mode: WorkflowMode;
  readonly soloMode: SoloMode | undefined;
  readonly executionMode: 'preview';
  readonly dryRun: true;
  readonly routePolicy: WorkflowRouterPlan['routePolicy'];
  readonly rdWaveNames: readonly string[];
  readonly capabilitySurfaces: readonly CapabilitySurface[];
  readonly capabilityCountBySurface: Record<CapabilitySurface, number>;
  readonly ready: boolean;
};

export type AutonomousWorkflowPlan = {
  readonly available: boolean;
  readonly behavior: 'preview' | 'ready';
  readonly changeId: string;
  readonly goal: string;
  readonly mode: WorkflowMode;
  readonly dryRun: true;
  readonly goalPackage: AutonomousGoalPackage;
  readonly goalCommand: AutonomousGoalCommand;
  readonly capabilityPlan: AutonomousCapabilityPlan;
  readonly storagePlan: AutonomousStoragePlan;
  readonly routePlan: WorkflowRouterPlan;
  readonly modelAssignments: WorkflowRouterPlan['modelAssignments'];
  readonly rdPlan: RdPlanResult;
  readonly resumePlan: AutonomousResumePlan;
  readonly mvpPackage: AutonomousMvpPackage;
  readonly constraints: readonly string[];
  readonly blockedReasons: readonly string[];
  readonly nextActions: readonly string[];
};

const AUTONOMOUS_CONSTRAINTS = Object.freeze([
  'dry-run-only',
  'do-not-launch-workers',
  'do-not-install-capabilities',
  'do-not-mutate-claude-settings',
  'do-not-mutate-target-repo',
  'artifact-backed-resume-required',
  'evidence-before-resume'
]);

const RESUME_ARTIFACTS_MISSING_NEXT_ACTIONS = Object.freeze([
  'Persist autonomous goal package, RD plan, checkpoint, validation evidence, and resume instructions before autonomous resume.'
]);

const RESUME_ARTIFACTS_INVALID_NEXT_ACTIONS = Object.freeze([
  'Refresh autonomous resume artifacts with matching change ids, valid JSON state, and passed validation evidence before autonomous resume.'
]);

const MAX_RESUME_ARTIFACT_BYTES = 256_000;

function normalizeGoal(goal: string): string {
  const normalized = goal.trim();
  if (!normalized) {
    throw new Error('Goal must be non-empty');
  }
  return normalized;
}

function resolveArtifactWorkspacePath(request: AutonomousWorkflowRequest): string | undefined {
  return request.artifactWorkspacePath ?? (request.workspace ? getLocalArtifactPath(request.workspace) : undefined);
}

function hasArtifactWorkspace(request: AutonomousWorkflowRequest, artifactWorkspacePath: string | undefined): boolean {
  return !!request.workspace && !!artifactWorkspacePath && hasValidArtifactWorkspace(request.workspace, artifactWorkspacePath);
}

function createGoalPackage(changeId: string, goal: string): AutonomousGoalPackage {
  return {
    changeId,
    goal,
    nonGoals: [
      'Change product behavior without explicit approval.',
      'Install MCP servers, hooks, agents, or router configuration during dry-run planning.',
      'Store API keys or provider credentials in Peaks artifacts.'
    ],
    preservedBehavior: [
      'Existing product behavior remains stable unless the accepted goal explicitly changes it.',
      'Existing repository source files are not mutated by dry-run planning.',
      'Intermediate artifacts remain outside the target repository source tree.'
    ],
    acceptanceCriteria: [
      'A resumable autonomous RD plan exists with checkpoints, worker queue, and validation evidence requirements.',
      'Curated capabilities from docs/accessRepo.md and docs/mcpServer.md are considered before custom implementation.',
      'Resume after compact verifies checkpoints and evidence before continuing.',
      'All execution remains dry-run until explicitly approved.'
    ],
    doneCondition: `The ${changeId} autonomous plan is complete when all acceptance criteria pass, the worker queue is empty or blocked with next actions, and validation evidence is recorded.`,
    resumeCondition: `Resume ${changeId} only after checkpoint artifacts, worker queue state, and validation evidence requirements have been verified.`,
    riskNotes: [
      'Claude Code /goal is session-scoped and cannot be the only durable state source.',
      'External capabilities may require installation, credentials, network access, or settings changes.',
      'Large swarms need conflict groups and reducer evidence to avoid unsafe parallel edits.'
    ]
  };
}

const CAPABILITY_SURFACES: readonly CapabilitySurface[] = ['skill', 'mcp', 'plugin', 'expert'];

function createCapabilitySurfaceSummary(): Record<CapabilitySurface, number> {
  return {
    skill: 0,
    mcp: 0,
    plugin: 0,
    expert: 0
  };
}

function getCapabilitySurface(itemType: CapabilityItemType): CapabilitySurface {
  if (itemType === 'skill') return 'skill';
  if (itemType === 'mcp') return 'mcp';
  if (itemType === 'agent') return 'expert';
  return 'plugin';
}

function getCapabilityTrustLevel(sourceId: string): CapabilityTrustLevel {
  if (sourceId === 'skills/*/SKILL.md' || sourceId === 'local-peaks-skills') {
    return 'local';
  }

  if (
    sourceId.startsWith('everything-claude-code')
    || sourceId.startsWith('ruflo-')
    || sourceId === 'superpowers'
    || sourceId === 'openspec'
    || sourceId === 'gstack'
    || sourceId === 'impeccable'
    || sourceId === 'andrej-karpathy-skills'
    || sourceId === 'mattpocock-skills'
  ) {
    return 'user-curated';
  }

  return 'third-party';
}

function getCapabilityPurpose(item: { category: string; itemType: CapabilityItemType }): CapabilityPurpose {
  switch (item.category) {
    case 'browser-validation':
    case 'browser-debug':
    case 'design-context':
    case 'code-search':
    case 'database-inspection':
    case 'browser-agent':
    case 'docs-lookup':
    case 'design-source':
    case 'code-review':
    case 'security-review':
    case 'coding-standards':
    case 'worker-guidance':
    case 'memory':
    case 'context-management':
    case 'ui-components':
    case 'spec-workflow':
    case 'repo-intelligence':
    case 'openspec':
    case 'workflow-methodology':
    case 'workflow-reference':
    case 'workflow-guidance':
    case 'product-guidance':
    case 'design-reference':
    case 'ui-reference':
    case 'engineering-guidance':
    case 'typescript-guidance':
    case 'quality-guidance':
    case 'skill-pack':
    case 'external-skill':
    case 'design-critique':
    case 'design-guidance':
    case 'cloud-skill-pack':
      return item.category;
    default:
      return item.itemType === 'mcp' ? 'docs-lookup' : 'workflow-guidance';
  }
}

function getCapabilityActivation(status: CapabilityAvailabilityStatus, itemType: CapabilityItemType): CapabilityActivation {
  switch (status) {
    case 'available':
      return 'available';
    case 'installable':
      return itemType === 'mcp' ? 'needs-credentials' : 'needs-install';
    case 'disabled':
      return 'not-active';
    case 'unknown':
    default:
      return itemType === 'mcp' ? 'needs-credentials' : 'not-active';
  }
}

function createCapabilityPlan(request: AutonomousWorkflowRequest): AutonomousCapabilityPlan {
  const catalogPlan = createCapabilityMapPlan({ installedCapabilityIds: request.workspace?.installedCapabilityIds ?? [] });
  const surfaceSummary = createCapabilitySurfaceSummary();
  const candidates: CapabilityCandidate[] = catalogPlan.items.map((item) => {
    const surface = getCapabilitySurface(item.itemType);
    const availability = catalogPlan.availability.find((availability) => availability.capabilityId === item.capabilityId);

    surfaceSummary[surface] += 1;
    return {
      id: item.capabilityId,
      source: item.sourceId,
      purpose: getCapabilityPurpose(item),
      surface,
      kind: surface,
      sourceType: item.itemType,
      trustLevel: getCapabilityTrustLevel(item.sourceId),
      activation: getCapabilityActivation(availability?.status ?? 'unknown', item.itemType),
      risk: [item.riskLevel] as const
    };
  });

  candidates.push({
    id: 'local-peaks-skills',
    source: 'skills/*/SKILL.md',
    purpose: 'workflow-methodology',
    surface: 'skill',
    kind: 'skill',
    sourceType: 'skill',
    trustLevel: 'local',
    activation: 'available',
    risk: ['local-skill-boundary-misuse'] as const
  });
  surfaceSummary.skill += 1;

  return {
    sources: uniqueStrings(['docs/accessRepo.md', 'docs/mcpServer.md', 'skills/*/SKILL.md', ...catalogPlan.sources.map((source) => source.sourceId)]),
    policy: [
      'reuse-curated-capabilities-before-custom-build',
      'plan-capability-use-before-activation',
      'require-explicit-approval-for-install-credentials-network-or-settings-mutation'
    ],
    candidates,
    surfaces: [...CAPABILITY_SURFACES],
    surfaceSummary
  };
}

function createMvpPackage(request: AutonomousWorkflowRequest, routePlan: WorkflowRouterPlan, rdPlan: RdPlanResult, capabilityPlan: AutonomousCapabilityPlan, ready: boolean): AutonomousMvpPackage {
  return {
    mode: request.mode,
    soloMode: routePlan.soloMode,
    executionMode: 'preview',
    dryRun: true,
    routePolicy: routePlan.routePolicy,
    rdWaveNames: rdPlan.waves.map((wave) => wave.name),
    capabilitySurfaces: [...capabilityPlan.surfaces],
    capabilityCountBySurface: { ...capabilityPlan.surfaceSummary },
    ready
  };
}

function createGoalCommand(goalPackage: AutonomousGoalPackage): AutonomousGoalCommand {
  return {
    command: `/goal ${goalPackage.doneCondition}`,
    durable: false,
    reason: 'Claude Code /goal can help continue across turns in the current session, but Peaks artifacts remain the durable state.'
  };
}

function getResumeRequiredArtifacts(changeId: string): string[] {
  return [
    buildArtifactRelativePath(changeId, 'prd', 'autonomous-goal-package.json'),
    buildArtifactRelativePath(changeId, 'rd', 'swarm', 'autonomous-rd-plan.json'),
    buildArtifactRelativePath(changeId, 'rd', 'swarm', 'checkpoints', 'checkpoint-1.json'),
    buildArtifactRelativePath(changeId, 'rd', 'swarm', 'evidence', 'validation-report.md'),
    buildArtifactRelativePath(changeId, 'rd', 'swarm', 'resume-instructions.md')
  ];
}

type ResumeArtifactsStatus = 'ready' | 'missing' | 'invalid';

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInsidePath(childPath: string, parentPath: string): boolean {
  const relativePath = relative(parentPath, childPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function readFully(fd: number, size: number): string | null {
  const buffer = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const bytesRead = readSync(fd, buffer, offset, size - offset, offset);
    if (bytesRead === 0) {
      return null;
    }
    offset += bytesRead;
  }
  return buffer.toString('utf8');
}

function stripChangeScopePrefix(artifact: string, changeId: string): string {
  // Slice 2026-06-23-audit-5th-p1: `buildArtifactRelativePath` returns
  // `.peaks/_runtime/change/<changeId>/<role>/...`. `readResumeArtifact`
  // now expects just the role-relative sub-path (e.g.
  // `rd/swarm/checkpoints/checkpoint-1.json`) because the change-id
  // scope root is computed by `getChangeScopeDirAbs`. This helper
  // strips the well-known prefix. Falls back to the input string when
  // the prefix is not present (e.g. a caller passed a bare
  // sub-path directly), keeping `readResumeArtifact` tolerant of both
  // shapes.
  const normalized = artifact.replace(/\\/g, '/').replace(/^\/+/, '');
  const prefix = `.peaks/_runtime/change/${changeId}/`;
  if (normalized.startsWith(prefix)) {
    return normalized.slice(prefix.length);
  }
  return normalized;
}

function readResumeArtifact(artifactWorkspacePath: string, changeId: string, artifact: string): string | null {
  // Slice 2026-06-23-audit-5th-p1: the on-disk home for change-id
  // content is the canonical scope dir under
  // `.peaks/_runtime/change/<changeId>/` (see `getChangeScopeDirAbs`).
  // The previous read path `.peaks/_runtime/<changeId>/` was a SKILL.md 2.8.3
  // hard-ban violation (sibling of `.peaks/_runtime/`). The
  // relative-path argument is still useful for the role/swarm drill
  // (e.g. `rd/swarm/checkpoints/checkpoint-1.json`) — we use it
  // strictly to identify the sub-root, not to derive a new top-level
  // dir.
  const changeScopeRoot = getChangeScopeDirAbs(artifactWorkspacePath, changeId);
  const normalizedArtifact = artifact.replace(/\\/g, '/').replace(/^\/+/, '');
  const artifactPath = resolve(changeScopeRoot, normalizedArtifact);
  try {
    const artifactWorkspaceRealPath = realpathSync(artifactWorkspacePath);
    const artifactStat = lstatSync(artifactPath);
    if (artifactStat.isSymbolicLink() || !artifactStat.isFile() || artifactStat.size > MAX_RESUME_ARTIFACT_BYTES) {
      return null;
    }

    const sessionRootPath = changeScopeRoot;
    const roleRootPath = resolve(sessionRootPath, normalizedArtifact.split('/')[0] ?? '');
    if (lstatSync(sessionRootPath).isSymbolicLink() || lstatSync(roleRootPath).isSymbolicLink()) {
      return null;
    }

    const roleSegment = normalizedArtifact.split('/')[0] ?? '';
    let allowedRootRealPath: string;
    if (roleSegment === 'rd') {
      const swarmRootPath = resolve(roleRootPath, 'swarm');
      if (lstatSync(swarmRootPath).isSymbolicLink()) {
        return null;
      }
      allowedRootRealPath = realpathSync(swarmRootPath);
    } else {
      allowedRootRealPath = realpathSync(roleRootPath);
    }

    const artifactRealPath = realpathSync(artifactPath);
    if (!isInsidePath(allowedRootRealPath, artifactWorkspaceRealPath) || !isInsidePath(artifactRealPath, allowedRootRealPath)) {
      return null;
    }

    const fd = openSync(artifactPath, 'r');
    try {
      const openedStat = fstatSync(fd);
      const currentStat = statSync(artifactPath);
      if (!openedStat.isFile() || openedStat.size > MAX_RESUME_ARTIFACT_BYTES || openedStat.dev !== artifactStat.dev || openedStat.ino !== artifactStat.ino || openedStat.dev !== currentStat.dev || openedStat.ino !== currentStat.ino) {
        return null;
      }
      return readFully(fd, openedStat.size);
    } finally {
      closeSync(fd);
    }
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }
}

type ResumeArtifactType = 'goal-package' | 'rd-plan' | 'checkpoint' | 'validation-report' | 'resume-instructions';

function getExpectedResumeArtifactType(artifact: string): ResumeArtifactType {
  if (artifact.endsWith('/autonomous-goal-package.json')) return 'goal-package';
  if (artifact.endsWith('/autonomous-rd-plan.json')) return 'rd-plan';
  if (artifact.endsWith('/checkpoint-1.json')) return 'checkpoint';
  if (artifact.endsWith('/validation-report.md')) return 'validation-report';
  return 'resume-instructions';
}

function hasStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && item.trim().length > 0);
}

function hasValidGoalPackageJson(parsed: Record<string, unknown>, goal: string): boolean {
  return parsed.goal === goal
    && typeof parsed.doneCondition === 'string'
    && parsed.doneCondition.trim().length > 0
    && typeof parsed.resumeCondition === 'string'
    && parsed.resumeCondition.trim().length > 0
    && hasStringArray(parsed.acceptanceCriteria);
}

function hasValidRdPlanJson(parsed: Record<string, unknown>): boolean {
  return parsed.workerQueueStatus === 'ready'
    && typeof parsed.taskCount === 'number'
    && Number.isInteger(parsed.taskCount)
    && parsed.taskCount > 0
    && parsed.reducerRequired === true;
}

function hasValidCheckpointJson(parsed: Record<string, unknown>): boolean {
  return parsed.checkpointId === 'checkpoint-1'
    && typeof parsed.createdAt === 'string'
    && parsed.createdAt.trim().length > 0
    && isObjectRecord(parsed.workerQueueState)
    && hasStringArray(parsed.validationRefs);
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(content);
    return isObjectRecord(parsed) ? parsed : null;
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }
}

function hasValidJsonMetadata(content: string, changeId: string, artifactType: string, goal: string): boolean {
  const parsed = parseJsonObject(content);
  if (parsed === null || parsed.changeId !== changeId || parsed.artifactType !== artifactType || parsed.status !== 'ready') {
    return false;
  }

  if (artifactType === 'goal-package') return hasValidGoalPackageJson(parsed, goal);
  if (artifactType === 'rd-plan') return hasValidRdPlanJson(parsed);
  return artifactType === 'checkpoint' && hasValidCheckpointJson(parsed);
}

function parseFrontMatter(content: string): Record<string, string> | null {
  const lines = content.split(/\r?\n/);
  if (lines[0] !== '---') {
    return null;
  }

  const closingDelimiterIndex = lines.slice(1).findIndex((line) => line === '---');
  if (closingDelimiterIndex === -1) {
    return null;
  }

  const metadata = new Map<string, string>();
  for (const line of lines.slice(1, closingDelimiterIndex + 1)) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) {
      return null;
    }

    metadata.set(line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1).trim());
  }

  return Object.fromEntries(metadata);
}

function getMarkdownBody(content: string): string {
  const lines = content.split(/\r?\n/);
  const closingDelimiterIndex = lines.slice(1).findIndex((line) => line === '---');
  return closingDelimiterIndex === -1 ? '' : lines.slice(closingDelimiterIndex + 2).join('\n');
}

function hasValidationReportBody(body: string): boolean {
  return body.includes('Validation summary:')
    && body.includes('Checks:')
    && body.includes('Result: passed')
    && body.includes('Evidence refs:');
}

function hasResumeInstructionsBody(body: string): boolean {
  return body.includes('Resume steps:')
    && body.includes('Preconditions:')
    && body.includes('Blocked actions:')
    && body.includes('Next actions:');
}

function extractMarkdownListSection(body: string, heading: string): string[] {
  const lines = body.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line.trim() === heading);
  if (startIndex === -1) {
    return [];
  }

  const sectionLines = lines.slice(startIndex + 1);
  const nextHeadingIndex = sectionLines.findIndex((line) => /^[A-Z][A-Za-z ]+:$/.test(line.trim()));
  const sectionEndIndex = nextHeadingIndex + 1 || sectionLines.length;
  return sectionLines.slice(0, sectionEndIndex)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim())
    .filter((line) => line.length > 0);
}

function getCheckpointValidationRefs(checkpointContent: string): string[] {
  const parsed = parseJsonObject(checkpointContent);
  return parsed && hasStringArray(parsed.validationRefs) ? parsed.validationRefs : [];
}

function isSafeEvidenceRef(ref: string): boolean {
  return ref.toLowerCase() !== 'validation-report.md' && /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(ref) && !ref.includes('..');
}

function evidenceRefsExist(artifactWorkspacePath: string, changeId: string, refs: readonly string[]): boolean {
  return refs.every((ref) => isSafeEvidenceRef(ref) && readResumeArtifact(artifactWorkspacePath, changeId, `rd/swarm/evidence/${ref}`) !== null);
}

function hasMatchingEvidenceRefs(artifactWorkspacePath: string, changeId: string, validationReportContent: string, checkpointContent: string): boolean {
  const expectedRefs = getCheckpointValidationRefs(checkpointContent);
  const actualRefs = extractMarkdownListSection(getMarkdownBody(validationReportContent), 'Evidence refs:');
  return expectedRefs.length > 0
    && expectedRefs.length === actualRefs.length
    && expectedRefs.every((expectedRef, index) => expectedRef === actualRefs[index])
    && evidenceRefsExist(artifactWorkspacePath, changeId, expectedRefs);
}

function hasValidMarkdownMetadata(content: string, changeId: string, artifactType: string): boolean {
  const metadata = parseFrontMatter(content);
  if (metadata === null || metadata.changeId !== changeId || metadata.artifactType !== artifactType || metadata.status !== 'passed') {
    return false;
  }

  const body = getMarkdownBody(content);
  return artifactType === 'validation-report' ? hasValidationReportBody(body) : hasResumeInstructionsBody(body);
}

function isValidResumeArtifact(artifact: string, content: string, changeId: string, goal: string): boolean {
  if (!content.trim()) {
    return false;
  }

  const artifactType = getExpectedResumeArtifactType(artifact);
  return artifact.endsWith('.json')
    ? hasValidJsonMetadata(content, changeId, artifactType, goal)
    : hasValidMarkdownMetadata(content, changeId, artifactType);
}

function getResumeArtifactsStatus(artifactWorkspacePath: string, requiredArtifacts: readonly string[], changeId: string, goal: string): ResumeArtifactsStatus {
  let hasInvalidArtifact = false;
  const artifactContents = new Map<string, string>();
  for (const artifact of requiredArtifacts) {
    // Slice 2026-06-23-audit-5th-p1: pass the explicit changeId so
    // `readResumeArtifact` can route through `getChangeScopeDirAbs`
    // rather than guessing from path segments.
    const content = readResumeArtifact(artifactWorkspacePath, changeId, stripChangeScopePrefix(artifact, changeId));
    if (content === null) {
      return 'missing';
    }

    artifactContents.set(artifact, content);
    if (!isValidResumeArtifact(artifact, content, changeId, goal)) {
      hasInvalidArtifact = true;
    }
  }

  const checkpointContent = artifactContents.get(buildArtifactRelativePath(changeId, 'rd', 'swarm', 'checkpoints', 'checkpoint-1.json'));
  const validationReportContent = artifactContents.get(buildArtifactRelativePath(changeId, 'rd', 'swarm', 'evidence', 'validation-report.md'));
  if (!checkpointContent || !validationReportContent || !hasMatchingEvidenceRefs(artifactWorkspacePath, changeId, validationReportContent, checkpointContent)) {
    hasInvalidArtifact = true;
  }

  return hasInvalidArtifact ? 'invalid' : 'ready';
}

function createResumePlan(changeId: string, ready: boolean): AutonomousResumePlan {
  const requiredArtifacts = getResumeRequiredArtifacts(changeId);

  return {
    status: ready ? 'ready' : 'preview',
    checkpoints: ['goal-package-created', 'capabilities-planned', 'rd-swarm-planned', 'validation-evidence-required'],
    requiredArtifacts,
    resumeInstructions: ready
      ? 'Before continuing, verify checkpoint artifacts, pending worker queue state, and validation evidence requirements.'
      : 'Resolve blocked planning reasons before relying on autonomous resume state.'
  };
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function createAutonomousWorkflowPlan(request: AutonomousWorkflowRequest): AutonomousWorkflowPlan {
  validateChangeIdOrThrow(request.changeId);
  const goal = normalizeGoal(request.goal);
  const maxWorkers = request.maxWorkers ?? 40;
  const artifactWorkspacePath = resolveArtifactWorkspacePath(request);
  const memoryBackupPath = artifactWorkspacePath ? join(artifactWorkspacePath, '.peaks', 'memory-backups', 'project-memory-primary') : null;
  const sharedWorkspaceOptions = {
    ...(artifactWorkspacePath ? { artifactWorkspacePath } : {}),
    ...(request.workspace ? { workspace: request.workspace } : {})
  };
  const goalPackage = createGoalPackage(request.changeId, goal);
  const available = hasArtifactWorkspace(request, artifactWorkspacePath);
  const routePlan = createWorkflowRouterPlan({
    mode: request.mode,
    ...(request.soloMode !== undefined ? { soloMode: request.soloMode } : {}),
    changeId: request.changeId,
    goal,
    maxWorkers,
    dryRun: true,
    ...(request.config ? { config: request.config } : {}),
    ...sharedWorkspaceOptions
  });
  const rdPlan = createRdSwarmPlan({
    skill: 'rd',
    changeId: request.changeId,
    goal,
    maxWorkers,
    dryRun: true,
    ...(request.config?.swarmMode !== undefined ? { swarmMode: request.config.swarmMode } : {}),
    executionModelId: routePlan.modeStatus.executionModelId,
    ...sharedWorkspaceOptions
  });
  const requiredArtifacts = getResumeRequiredArtifacts(request.changeId);
  const resumeArtifactsStatus = available && artifactWorkspacePath
    ? getResumeArtifactsStatus(artifactWorkspacePath, requiredArtifacts, request.changeId, goal)
    : 'missing';
  const blockedReasons = uniqueStrings([
    ...routePlan.blockedReasons,
    ...rdPlan.blockedReasons,
    ...(available ? [] : ['artifact-workspace-unavailable']),
    ...(resumeArtifactsStatus === 'missing' ? ['resume-artifacts-missing'] : []),
    ...(resumeArtifactsStatus === 'invalid' ? ['resume-artifacts-invalid'] : [])
  ]);
  const ready = available && blockedReasons.length === 0;
  const capabilityPlan = createCapabilityPlan(request);
  const mvpPackage = createMvpPackage(request, routePlan, rdPlan, capabilityPlan, ready);

  return {
    available: ready,
    behavior: ready ? 'ready' : 'preview',
    changeId: request.changeId,
    goal,
    mode: request.mode,
    dryRun: true,
    goalPackage,
    goalCommand: createGoalCommand(goalPackage),
    capabilityPlan,
    storagePlan: {
      scope: 'user-local',
      artifactWorkspacePath: artifactWorkspacePath ?? null,
      memoryBackupPath: memoryBackupPath ?? null
    },
    routePlan,
    modelAssignments: routePlan.modelAssignments,
    rdPlan,
    resumePlan: createResumePlan(request.changeId, ready),
    mvpPackage,
    constraints: [...AUTONOMOUS_CONSTRAINTS],
    blockedReasons,
    nextActions: available
      ? uniqueStrings([
          ...routePlan.nextActions,
          ...rdPlan.nextActions,
          ...(resumeArtifactsStatus === 'missing' ? RESUME_ARTIFACTS_MISSING_NEXT_ACTIONS : []),
          ...(resumeArtifactsStatus === 'invalid' ? RESUME_ARTIFACTS_INVALID_NEXT_ACTIONS : [])
        ])
      : [...WORKSPACE_UNAVAILABLE_NEXT_ACTIONS]
  };
}
