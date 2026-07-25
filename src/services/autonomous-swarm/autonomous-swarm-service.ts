/**
 * autonomous-swarm-service — slice rid-014.
 *
 * Purpose:
 *   Build a dry-run-only autonomous RD swarm planner that turns a
 *   user-supplied goal + change-id + mode into a *resumable* plan:
 *   goal package (done / resume conditions), capability reuse list,
 *   checkpoint queue, worker-queue placeholders (no spawn), evidence
 *   requirements, and resume instructions.
 *
 * Reuse (per rid-014 plan §1):
 *   - `validateChangeId` + `planArtifactPath` + `buildWorkspaceUnavailable`
 *     from `src/services/openspec/artifact-boundary.ts` (rid-009).
 *   - `getTechStatus` from `src/services/tech/tech-service.ts` (rid-012).
 *   - `planRdSwarmGraph` shape from `src/services/rd-swarm/rd-swarm-service.ts`
 *     (rid-013) — composed as the workerQueue feed.
 *
 * Style:
 *   - Named function exports — matches `rd-swarm-service.ts` + `artifact-boundary.ts`.
 *   - Hand-rolled `Result<T, E>` unions — no `neverthrow` dep.
 *   - Pure path math + intentional capability fs reads (no side effects).
 *   - No real workers, no MCP install, no settings mutation, no target-repo edit.
 *
 * Hard ban:
 *   - MUST NOT install / invoke / import any external skill or MCP server.
 *   - MUST NOT launch workers or mutate the target repo.
 *   - MUST NOT touch `src/services/openspec/artifact-boundary.ts`,
 *     `src/services/tech/`, or `src/services/rd-swarm/`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  validateChangeId,
  planArtifactPath,
  buildWorkspaceUnavailable,
  type Result,
  type BoundaryError,
} from '../openspec/artifact-boundary.js';
import { planRdSwarmGraph, type RdSwarmPlanRequest, type RdTaskGraph } from '../rd-swarm/rd-swarm-service.js';

export type AutonomousMode = 'code' | 'team';

export type GoalCommandMarker = {
  marker: '/goal';
  nonDurable: true;
  notes: string;
};

export type AutonomousGoalPackage = {
  changeId: string;
  goal: string;
  mode: AutonomousMode;
  autonomyMode: 'dry-run';
  nonGoals: string[];
  doneCondition: string;
  resumeCondition: string;
  riskNotes: string[];
  goalCommand?: GoalCommandMarker;
};

export type CheckpointStatus = 'pending' | 'verified' | 'failed';

export type Checkpoint = {
  id: string;
  name: string;
  evidencePath: string;
  status: CheckpointStatus;
};

export type WorkerQueueEntry = {
  taskId: string;
  wave: string;
  status: 'planned' | 'running' | 'done' | 'blocked';
  briefPath: string;
  dependsOn: string[];
};

export type EvidenceRequirement = {
  id: string;
  kind: 'validation-report' | 'coverage-report' | 'reducer-report';
  path: string;
  required: boolean;
};

export type CapabilityEntry = {
  source: string;
  purpose: string;
  trustLevel: 'internal' | 'external' | 'unknown';
  activation: string;
  risk: string;
};

export type CapabilityReuseResult = {
  entries: CapabilityEntry[];
  truncated: boolean;
  warnings: string[];
};

export type ResumeInstructions = {
  summary: string;
  steps: string[];
  checkpointStates: Array<{ id: string; status: CheckpointStatus }>;
};

export type AutonomousRdPlan = {
  changeId: string;
  goal: string;
  mode: AutonomousMode;
  autonomyMode: 'dry-run';
  available: boolean;
  goalPackage: AutonomousGoalPackage;
  capabilityReuse: CapabilityReuseResult;
  checkpoints: Checkpoint[];
  workerQueue: WorkerQueueEntry[];
  evidence: EvidenceRequirement[];
  artifactRoot: string;
  gateStatus: { techApprovalRequired: boolean; techStatus: string; skipReason?: string };
  blockedReasons: string[];
  nextActions: string[];
  resumeInstructions: ResumeInstructions;
};

export type BuildAutonomousGoalPackageInput = {
  changeId: string;
  goal: string;
  mode: AutonomousMode;
  maxWorkers: number;
  dryRun: true;
  workspaceRoot: string;
};

export type PlanAutonomousRdSwarmInput = BuildAutonomousGoalPackageInput & {
  requiresTechApproval?: boolean;
};

const MAX_CAPABILITY_ENTRIES = 50;
const MIN_WORKERS = 25;
const MAX_WORKERS = 40;

export function buildAutonomousGoalPackage(input: BuildAutonomousGoalPackageInput): AutonomousGoalPackage {
  const trimmedGoal = input.goal.trim();
  if (!trimmedGoal) {
    throw new Error('Goal must be non-empty');
  }
  const id = validateChangeId(input.changeId);
  if (!id.ok) {
    throw new Error(id.error.message);
  }
  const trimmedChangeId = id.value.changeId;

  const doneCondition =
    input.mode === 'code'
      ? 'All checkpoints verified; reducer-report.md committed; validation-report.md and coverage-report.md pass.'
      : 'All team-mode checkpoints verified; team review artifacts persisted; reducer summary committed.';

  const resumeCondition =
    'Re-read the persisted Peaks artifacts (NOT session state); verify the latest checkpoint; re-verify evidence before continuing.';

  const nonGoals: string[] = [
    'Real worker spawning (dry-run only — autonomyMode is hard-coded to dry-run).',
    'No external skill / MCP installation — capability entries are metadata-only.',
    'No target-repo source edits — artifacts land under .peaks/changes/<id>/.',
  ];

  const riskNotes: string[] = [
    'Treating /goal as durable would leak session state across runs; goalCommand is non-durable.',
    'Worker queue is capped at 40; coordinate via checkpoints, not raw fan-out.',
  ];

  const goalCommand: GoalCommandMarker = {
    marker: '/goal',
    nonDurable: true,
    notes: 'Read-only marker; never persisted as run state. Re-derive from the goal-package on every resume.',
  };

  return {
    changeId: trimmedChangeId,
    goal: trimmedGoal,
    mode: input.mode,
    autonomyMode: 'dry-run',
    nonGoals,
    doneCondition,
    resumeCondition,
    riskNotes,
    goalCommand,
  };
}

function readWorkspaceConfigArtifacts(workspaceRoot: string): { workspace?: RdSwarmPlanRequest['workspace'] } {
  // Read the project's workspace config file if present; the rd-swarm
  // service expects a `workspace` field carrying the resolved config so
  // its `getTechStatus` fallback can query the canonical path.
  const configPath = join(workspaceRoot, '.peaks', 'workspace.json');
  if (!existsSync(configPath)) return {};
  try {
    const raw = readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as { workspace?: RdSwarmPlanRequest['workspace'] };
    return parsed.workspace ? { workspace: parsed.workspace } : {};
  } catch {
    return {};
  }
}

function planSwarmArtifactPath(input: { changeId: string; workspaceRoot: string; requestId: string; template: string }): string {
  const result = planArtifactPath({
    changeId: input.changeId,
    workspaceRoot: input.workspaceRoot,
    role: 'swarm',
    requestId: input.requestId,
    template: input.template,
  });
  if (!result.ok) {
    return `${input.changeId}/swarm/${input.template.replace('<changeId>/swarm/', '')}`;
  }
  return result.value.jsonSafeRelativePath;
}

function deriveCheckpoints(goal: string, changeId: string, workspaceRoot: string): Checkpoint[] {
  const requestId = 'autonomous';
  return [
    {
      id: 'checkpoint-1-goal-package',
      name: 'Goal package verified',
      evidencePath: planSwarmArtifactPath({
        changeId,
        workspaceRoot,
        requestId,
        template: `<changeId>/swarm/evidence/goal-package.md`,
      }),
      status: 'pending',
    },
    {
      id: 'checkpoint-2-capability-reuse',
      name: 'Capability reuse parsed',
      evidencePath: planSwarmArtifactPath({
        changeId,
        workspaceRoot,
        requestId,
        template: `<changeId>/swarm/evidence/capability-reuse.md`,
      }),
      status: 'pending',
    },
    {
      id: 'checkpoint-3-worker-queue',
      name: 'Worker queue composed',
      evidencePath: planSwarmArtifactPath({
        changeId,
        workspaceRoot,
        requestId,
        template: `<changeId>/swarm/evidence/worker-queue.md`,
      }),
      status: 'pending',
    },
    {
      id: 'checkpoint-4-evidence-reports',
      name: 'Validation + coverage + reducer reports generated',
      evidencePath: planSwarmArtifactPath({
        changeId,
        workspaceRoot,
        requestId,
        template: `<changeId>/swarm/evidence/evidence-summary.md`,
      }),
      status: 'pending',
    },
  ];
}

function deriveEvidenceRequirements(changeId: string, workspaceRoot: string): EvidenceRequirement[] {
  const requestId = 'autonomous';
  return [
    {
      id: 'evidence-validation-report',
      kind: 'validation-report',
      path: planSwarmArtifactPath({
        changeId,
        workspaceRoot,
        requestId,
        template: `<changeId>/swarm/evidence/validation-report.md`,
      }),
      required: true,
    },
    {
      id: 'evidence-coverage-report',
      kind: 'coverage-report',
      path: planSwarmArtifactPath({
        changeId,
        workspaceRoot,
        requestId,
        template: `<changeId>/swarm/evidence/coverage-report.md`,
      }),
      required: true,
    },
    {
      id: 'evidence-reducer-report',
      kind: 'reducer-report',
      path: planSwarmArtifactPath({
        changeId,
        workspaceRoot,
        requestId,
        template: `<changeId>/swarm/reducer-report.md`,
      }),
      required: true,
    },
  ];
}

function workerQueueFromGraph(graph: RdTaskGraph): WorkerQueueEntry[] {
  return graph.tasks.map((task) => ({
    taskId: task.taskId,
    wave: task.wave,
    status: 'planned',
    briefPath: `${graph.artifactRoot}/${task.outputs[0]}`,
    dependsOn: [...task.dependsOn],
  }));
}

function localTechStatus(workspaceRoot: string, changeId: string, workspace?: RdSwarmPlanRequest['workspace']): string {
  // Direct fs probe matching `rd-swarm-service.ts#localTechStatus` so the
  // autonomous-swarm composer sees the same per-file presence check that
  // the rd-swarm planner uses. The `getTechStatus` service wrapper requires
  // a fully-configured `workspace` (the workspace-only contract); the
  // rd-swarm planner's fs probe is the cross-mode fallback.
  const root = join(workspaceRoot, changeId, 'rd', 'architecture');
  const required = ['frontend-tech-doc.md', 'backend-tech-doc.md', 'tech-approval-record.md'];
  const missing = required.filter((name) => !existsSync(join(root, name)));
  if (missing.length > 0) {
    return missing.includes('tech-approval-record.md') && missing.length === 1 ? 'missing-approval' : 'missing';
  }
  try {
    return readFileSync(join(root, 'tech-approval-record.md'), 'utf8').split(/\r?\n/).some((line) => line.trim() === 'status: approved') ? 'approved' : 'not-approved';
  } catch {
    return 'not-approved';
  }
}

export function planCapabilityReuse(input: { workspaceRoot: string }): CapabilityReuseResult {
  const docsDir = join(input.workspaceRoot, 'docs');
  const warnings: string[] = [];
  const entries: CapabilityEntry[] = [];

  if (!existsSync(docsDir)) {
    return { entries, truncated: false, warnings };
  }

  const files: Array<{ source: string; trustLevel: CapabilityEntry['trustLevel'] }> = [
    { source: 'accessRepo.md', trustLevel: 'internal' },
    { source: 'mcpServer.md', trustLevel: 'external' },
  ];

  for (const file of files) {
    const fullPath = join(docsDir, file.source);
    if (!existsSync(fullPath)) continue;
    let raw: string;
    try {
      raw = readFileSync(fullPath, 'utf8');
    } catch {
      continue;
    }
    // Match markdown bullets of the form `- name: purpose` or `* name: purpose`.
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      if (entries.length >= MAX_CAPABILITY_ENTRIES) break;
      const match = line.match(/^\s*[-*]\s+([A-Za-z0-9._-]+)\s*:\s*(.+?)\s*$/);
      if (!match) continue;
      const name = match[1];
      const purpose = match[2];
      if (!name || !purpose) continue;
      entries.push({
        source: file.source,
        purpose,
        trustLevel: file.trustLevel,
        activation: `metadata-only — read from ${file.source}, never invoked`,
        risk: file.source === 'mcpServer.md' ? 'external' : 'internal',
      });
    }
  }

  const truncated = entries.length >= MAX_CAPABILITY_ENTRIES;
  if (truncated) {
    warnings.push('TRUNCATED');
  }

  return { entries, truncated, warnings };
}

export function buildResumeInstructions(plan: AutonomousRdPlan): ResumeInstructions {
  const steps: string[] = [
    'Re-read artifact paths under .peaks/changes/<changeId>/swarm/ — do not trust session state.',
    'Verify the latest checkpoint (status: verified | pending | failed) before continuing.',
    'Re-verify evidence: validation-report.md, coverage-report.md, reducer-report.md.',
    'Re-derive the goal package from the persisted request; the /goal marker is non-durable.',
  ];

  const checkpointStates = plan.checkpoints.map((checkpoint) => ({
    id: checkpoint.id,
    status: checkpoint.status,
  }));

  return {
    summary: plan.available
      ? 'Plan is available; resume by re-deriving the goal package and verifying the next pending checkpoint.'
      : 'Plan is blocked; resume by re-running planAutonomousRdSwarm and addressing the gateStatus / blockedReasons.',
    steps,
    checkpointStates,
  };
}

export function planAutonomousRdSwarm(input: PlanAutonomousRdSwarmInput): AutonomousRdPlan {
  const id = validateChangeId(input.changeId);
  if (!id.ok) {
    const blocked: AutonomousRdPlan = {
      changeId: input.changeId,
      goal: input.goal.trim(),
      mode: input.mode,
      autonomyMode: 'dry-run',
      available: false,
      goalPackage: buildAutonomousGoalPackage(input),
      capabilityReuse: planCapabilityReuse({ workspaceRoot: input.workspaceRoot }),
      checkpoints: deriveCheckpoints(input.goal, input.changeId, input.workspaceRoot),
      workerQueue: [],
      evidence: deriveEvidenceRequirements(input.changeId, input.workspaceRoot),
      artifactRoot: `${input.changeId}/swarm`,
      gateStatus: { techApprovalRequired: input.requiresTechApproval === true, techStatus: 'unavailable', ...(input.requiresTechApproval === true ? {} : { skipReason: 'tech-gate-not-required' }) },
      blockedReasons: [id.error.code],
      nextActions: [id.error.message],
      resumeInstructions: {
        summary: 'Plan is blocked; resume after fixing the change-id format.',
        steps: [],
        checkpointStates: [],
      },
    };
    return blocked;
  }

  const trimmedGoal = input.goal.trim();
  if (!trimmedGoal) {
    const blocked: AutonomousRdPlan = {
      changeId: id.value.changeId,
      goal: trimmedGoal,
      mode: input.mode,
      autonomyMode: 'dry-run',
      available: false,
      goalPackage: buildAutonomousGoalPackage(input),
      capabilityReuse: planCapabilityReuse({ workspaceRoot: input.workspaceRoot }),
      checkpoints: deriveCheckpoints(input.goal, id.value.changeId, input.workspaceRoot),
      workerQueue: [],
      evidence: deriveEvidenceRequirements(id.value.changeId, input.workspaceRoot),
      artifactRoot: `${id.value.changeId}/swarm`,
      gateStatus: { techApprovalRequired: input.requiresTechApproval === true, techStatus: 'unavailable', ...(input.requiresTechApproval === true ? {} : { skipReason: 'tech-gate-not-required' }) },
      blockedReasons: ['INVALID_GOAL'],
      nextActions: ['Use a non-empty goal'],
      resumeInstructions: {
        summary: 'Plan is blocked; resume by providing a non-empty goal.',
        steps: [],
        checkpointStates: [],
      },
    };
    return blocked;
  }

  const changeId = id.value.changeId;
  const workspaceArtifacts = readWorkspaceConfigArtifacts(input.workspaceRoot);

  const requested = input.maxWorkers;
  if (!Number.isInteger(requested) || requested < 1) {
    const blocked: AutonomousRdPlan = {
      changeId,
      goal: trimmedGoal,
      mode: input.mode,
      autonomyMode: 'dry-run',
      available: false,
      goalPackage: buildAutonomousGoalPackage(input),
      capabilityReuse: planCapabilityReuse({ workspaceRoot: input.workspaceRoot }),
      checkpoints: deriveCheckpoints(trimmedGoal, changeId, input.workspaceRoot),
      workerQueue: [],
      evidence: deriveEvidenceRequirements(changeId, input.workspaceRoot),
      artifactRoot: `${changeId}/swarm`,
      gateStatus: { techApprovalRequired: input.requiresTechApproval === true, techStatus: 'unavailable', ...(input.requiresTechApproval === true ? {} : { skipReason: 'tech-gate-not-required' }) },
      blockedReasons: ['INVALID_MAX_WORKERS'],
      nextActions: ['Use a positive integer for max-workers.'],
      resumeInstructions: {
        summary: 'Plan is blocked; resume by setting a positive max-workers value.',
        steps: [],
        checkpointStates: [],
      },
    };
    return blocked;
  }

  const target = Math.min(requested, MAX_WORKERS);
  const requiresTechApproval = input.requiresTechApproval === true;

  let graph: RdTaskGraph;
  try {
    graph = planRdSwarmGraph({
      skill: 'rd',
      changeId,
      goal: trimmedGoal,
      maxWorkers: target,
      dryRun: true,
      workspaceRoot: input.workspaceRoot,
      requiresTechApproval,
      ...(workspaceArtifacts.workspace ? { workspace: workspaceArtifacts.workspace } : {}),
    });
  } catch {
    graph = {
      changeId,
      goal: trimmedGoal,
      available: false,
      workerTarget: target,
      waves: [],
      tasks: [],
      conflictGroups: [],
      artifactRoot: `${changeId}/swarm`,
      outputs: { taskGraph: `${changeId}/swarm/task-graph.json`, waveManifests: [], workerBriefs: [], reducerReport: `${changeId}/swarm/reducer-report.md` },
      gateStatus: { techApprovalRequired: requiresTechApproval, techStatus: 'unavailable', ...(requiresTechApproval ? {} : { skipReason: 'tech-gate-not-required' }) },
      blockedReasons: [],
      nextActions: [],
    };
  }

  const blockedReasons: string[] = [...graph.blockedReasons];
  if (requested < MIN_WORKERS && !blockedReasons.includes('SMALL_SCOPE')) {
    blockedReasons.push('SMALL_SCOPE');
  }
  if (requested > MAX_WORKERS && !blockedReasons.includes('WORKER_CAP_EXCEEDED')) {
    blockedReasons.push('WORKER_CAP_EXCEEDED');
  }

  const techStatus = localTechStatus(input.workspaceRoot, changeId, workspaceArtifacts.workspace);
  const gateStatus = {
    techApprovalRequired: requiresTechApproval,
    techStatus,
    ...(requiresTechApproval ? {} : { skipReason: 'tech-gate-not-required' }),
  };

  const available = graph.available && !blockedReasons.includes('SMALL_SCOPE') && !blockedReasons.includes('INVALID_MAX_WORKERS');

  const nextActions: string[] = [];
  if (blockedReasons.includes('WORKER_CAP_EXCEEDED')) {
    nextActions.push('Worker target was capped at 40.');
  }
  if (requiresTechApproval && techStatus !== 'approved') {
    nextActions.push('Review and approve the technical plan before running the autonomous swarm.');
  }

  const goalPackage = buildAutonomousGoalPackage(input);
  const capabilityReuse = planCapabilityReuse({ workspaceRoot: input.workspaceRoot });
  const checkpoints = deriveCheckpoints(trimmedGoal, changeId, input.workspaceRoot);
  const evidence = deriveEvidenceRequirements(changeId, input.workspaceRoot);
  const workerQueue = workerQueueFromGraph(graph);

  const draft: AutonomousRdPlan = {
    changeId,
    goal: trimmedGoal,
    mode: input.mode,
    autonomyMode: 'dry-run',
    available,
    goalPackage,
    capabilityReuse,
    checkpoints,
    workerQueue,
    evidence,
    artifactRoot: `${changeId}/swarm`,
    gateStatus,
    blockedReasons,
    nextActions,
    resumeInstructions: { summary: '', steps: [], checkpointStates: [] },
  };

  draft.resumeInstructions = buildResumeInstructions(draft);
  return draft;
}

// Re-export the result types so the CLI module can pull everything from
// one place.
export type { Result, BoundaryError };
// Re-export the workspace-unavailable response so the CLI can map an
// unconfigured artifact workspace to the standard envelope.
export { buildWorkspaceUnavailable };
