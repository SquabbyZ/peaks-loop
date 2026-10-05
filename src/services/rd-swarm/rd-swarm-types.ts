/**
 * rd-swarm-types — the pure declaration surface of the RD swarm dry-run
 * planner (`rd-swarm-service.ts`).
 *
 * shapes (wave names, task records, conflict groups, and the task-graph
 * envelope). `rd-swarm-service.ts` imports and re-exports every name here, so
 * importers keep resolving them from the original path.
 */

export type RdWaveName =
  'discovery' | 'planning' | 'implementation candidates' | 'quality gates' | 'reducer';
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
  outputs: {
    taskGraph: string;
    waveManifests: string[];
    workerBriefs: string[];
    reducerReport: string;
  };
  gateStatus: { techApprovalRequired: boolean; techStatus: string; skipReason?: string };
  blockedReasons: string[];
  nextActions: string[];
};
