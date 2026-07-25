import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WorkspaceConfig } from '../config/config-types.js';
import { planArtifactPath, validateChangeId, type BoundaryError } from '../openspec/artifact-boundary.js';
import { getTechStatus as getLegacyTechStatus } from '../tech/tech-service.js';

type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export type RdSwarmPlanRequest = {
  skill: 'rd' | string;
  changeId: string;
  goal: string;
  maxWorkers?: number;
  dryRun: true;
  workspaceRoot: string;
  targetRepoRoot?: string;
  requiresTechApproval?: boolean;
  workspace?: WorkspaceConfig;
};

export type RdWaveName = 'discovery' | 'planning' | 'implementation candidates' | 'quality gates' | 'reducer';
export type RdTask = {
  taskId: string;
  wave: RdWaveName;
  workerKind: string;
  purpose: string;
  inputs: string[];
  outputs: [string, ...string[]];
  dependsOn: string[];
  conflictGroup: string;
  targetArea: string;
  expectedEvidence: string;
};
export type RdConflictGroup = {
  groupId: string;
  ownedPaths: string[];
  parallelismPolicy: 'parallel' | 'sequential';
  reason: string;
};
export type RdTaskGraph = {
  changeId: string;
  goal: string;
  available: boolean;
  workerTarget: number;
  waves: Array<{ name: RdWaveName; taskIds: string[] }>;
  tasks: RdTask[];
  conflictGroups: RdConflictGroup[];
  artifactRoot: string;
  outputs: { taskGraph: string; waveManifests: string[]; workerBriefs: string[]; reducerReport: string };
  gateStatus: { techApprovalRequired: boolean; techStatus: string; skipReason?: string };
  blockedReasons: string[];
  nextActions: string[];
};

type GateStatus = RdTaskGraph['gateStatus'];
const MIN_WORKERS = 25;
const MAX_WORKERS = 40;
const REQUIRED_TECH_FILES = ['frontend-tech-doc.md', 'backend-tech-doc.md', 'tech-approval-record.md'];

function failure(input: Pick<RdTaskGraph, 'changeId' | 'goal' | 'artifactRoot'>, reasons: string[], actions: string[], gateStatus: GateStatus, workerTarget: number): RdTaskGraph {
  return { ...input, available: false, workerTarget, waves: [], tasks: [], conflictGroups: [], outputs: { taskGraph: `${input.artifactRoot}/task-graph.json`, waveManifests: [], workerBriefs: [], reducerReport: `${input.artifactRoot}/reducer-report.md` }, gateStatus, blockedReasons: reasons, nextActions: actions };
}

function validate(input: RdSwarmPlanRequest): Result<{ changeId: string; goal: string }, { code: string; message: string }> {
  if (input.skill !== 'rd') return { ok: false, error: { code: 'UNSUPPORTED_SWARM_SKILL', message: `Unsupported skill ${input.skill}` } };
  const id = validateChangeId(input.changeId);
  if (!id.ok) return { ok: false, error: id.error };
  const goal = input.goal.trim();
  if (!goal) return { ok: false, error: { code: 'INVALID_GOAL', message: 'Goal must be non-empty' } };
  return { ok: true, value: { changeId: id.value.changeId, goal } };
}

function localTechStatus(input: RdSwarmPlanRequest): string {
  try {
    const canonical = getLegacyTechStatus({ sessionId: input.changeId, artifactWorkspacePath: input.workspaceRoot, ...(input.workspace ? { workspace: input.workspace } : {}) });
    if (canonical.status === 'approved') return 'approved';
  } catch { /* pure planner fallback for an unconfigured workspace */ }
  const root = join(input.workspaceRoot, input.changeId, 'rd', 'architecture');
  const missing = REQUIRED_TECH_FILES.filter((name) => !existsSync(join(root, name)));
  if (missing.length > 0) return missing.includes('tech-approval-record.md') && missing.length === 1 ? 'missing-approval' : 'missing';
  try {
    return readFileSync(join(root, 'tech-approval-record.md'), 'utf8').split(/\r?\n/).some((line) => line.trim() === 'status: approved') ? 'approved' : 'not-approved';
  } catch { return 'not-approved'; }
}

function path(input: RdSwarmPlanRequest, template: string): string {
  const result = planArtifactPath({ changeId: input.changeId, workspaceRoot: input.workspaceRoot, role: 'rd', requestId: 'swarm', template });
  if (!result.ok) throw new Error(result.error.message);
  return result.value.jsonSafeRelativePath;
}

function createTask(taskId: string, wave: RdWaveName, goal: string, dependencies: string[], index: number): RdTask {
  const output = `workers/${taskId}/brief.md`;
  return { taskId, wave, workerKind: taskId, purpose: `${taskId} for ${goal}`, inputs: [goal], outputs: [output], dependsOn: [...dependencies], conflictGroup: `group-${wave.replace(/\s/g, '-')}`, targetArea: wave === 'implementation candidates' ? `slice-${index + 1}` : wave, expectedEvidence: `${taskId}-evidence.md` };
}

function taskIds(target: number): Record<RdWaveName, string[]> {
  const discovery = ['rd-frontend-scan', 'rd-backend-scan', 'rd-test-scan', 'rd-contract-scan', 'rd-risk-scan'];
  const planning = ['rd-frontend-slicer', 'rd-backend-slicer', 'rd-unit-test-slicer', 'rd-contract-planner', 'rd-quality-gate-planner'];
  const quality = ['rd-code-review-worker', 'rd-security-review-worker', 'rd-typecheck-worker', 'rd-coverage-worker', 'rd-regression-worker'];
  const implementationCount = Math.max(1, target - discovery.length - planning.length - quality.length - 1);
  const implementation = Array.from({ length: implementationCount }, (_, i) => `rd-impl-${String(i + 1).padStart(3, '0')}`);
  return { discovery, planning, 'implementation candidates': implementation, 'quality gates': quality, reducer: ['rd-reducer-worker'] };
}

export function planRdSwarmGraph(input: RdSwarmPlanRequest): RdTaskGraph {
  const checked = validate(input);
  const defaultRoot = `${input.changeId}/swarm`;
  const common = { changeId: input.changeId, goal: input.goal.trim(), artifactRoot: defaultRoot };
  const requested = input.maxWorkers ?? 25;
  if (!checked.ok) return failure(common, [checked.error.code], [checked.error.message], { techApprovalRequired: input.requiresTechApproval === true, techStatus: 'unavailable' }, Number.isInteger(requested) && requested > 0 ? Math.min(requested, MAX_WORKERS) : 0);
  if (!Number.isInteger(requested) || requested < 1) return failure({ ...common, goal: checked.value.goal, changeId: checked.value.changeId, artifactRoot: `${checked.value.changeId}/swarm` }, ['INVALID_MAX_WORKERS'], ['Use a positive integer for max-workers.'], { techApprovalRequired: input.requiresTechApproval === true, techStatus: 'unavailable' }, 0);
  const goal = checked.value.goal;
  const changeId = checked.value.changeId;
  const artifactRoot = `${changeId}/swarm`;
  const target = Math.min(requested, MAX_WORKERS);
  const reasons: string[] = requested > MAX_WORKERS ? ['WORKER_CAP_EXCEEDED'] : [];
  if (requested < MIN_WORKERS) reasons.push('SMALL_SCOPE');
  const required = input.requiresTechApproval === true;
  const techStatus = localTechStatus({ ...input, changeId, goal });
  const gateStatus: GateStatus = { techApprovalRequired: required, techStatus, ...(required ? {} : { skipReason: 'tech-gate-not-required' }) };
  if (required && techStatus !== 'approved') {
    reasons.push('TECH_APPROVAL_REQUIRED');
    if (techStatus === 'missing-approval' || techStatus === 'missing') reasons.push('TECH_APPROVAL_MISSING');
  }
  if (reasons.includes('SMALL_SCOPE')) return failure({ changeId, goal, artifactRoot }, reasons, ['Describe the small scope in natural language or increase the worker target to at least 25.'], gateStatus, target);
  if (required && techStatus !== 'approved') return failure({ changeId, goal, artifactRoot }, reasons, ['Review and approve the technical plan before running the RD swarm.'], gateStatus, target);
  const ids = taskIds(target);
  const waves = (Object.entries(ids) as Array<[RdWaveName, string[]]>).map(([name, taskIds]) => ({ name, taskIds }));
  const dependencies: Record<RdWaveName, string[]> = { discovery: [], planning: ids.discovery, 'implementation candidates': ids.planning, 'quality gates': ids['implementation candidates'], reducer: ids['quality gates'] };
  const tasks = waves.flatMap(({ name, taskIds: waveTaskIds }) => waveTaskIds.map((id, i) => createTask(id, name, goal, dependencies[name], i)));
  const conflictGroups = waves.map(({ name, taskIds: waveTaskIds }) => ({ groupId: `group-${name.replace(/\s/g, '-')}`, ownedPaths: waveTaskIds.map((id) => `${artifactRoot}/workers/${id}/brief.md`), parallelismPolicy: waveTaskIds.length > 1 ? 'parallel' as const : 'sequential' as const, reason: `${name} workers have isolated artifact ownership` }));
  const outputs = { taskGraph: path(input, '<changeId>/swarm/task-graph.json'), waveManifests: waves.map((wave, i) => path(input, `<changeId>/swarm/waves/wave-${i + 1}-${wave.name}.json`)), workerBriefs: tasks.map((task) => path(input, `<changeId>/swarm/${task.outputs[0]}`)), reducerReport: path(input, '<changeId>/swarm/reducer-report.md') };
  return { changeId, goal, available: true, workerTarget: target, waves, tasks, conflictGroups, artifactRoot, outputs, gateStatus, blockedReasons: reasons, nextActions: reasons.includes('WORKER_CAP_EXCEEDED') ? ['Worker target was capped at 40.'] : [] };
}

export type { BoundaryError };
