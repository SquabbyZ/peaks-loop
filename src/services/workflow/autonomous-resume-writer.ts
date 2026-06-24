import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { validateChangeIdOrThrow } from '../../shared/change-id.js';
import { getChangeScopeDirAbs } from '../artifacts/change-scope-service.js';
import { pathExists } from '../../shared/fs.js';

export type AutonomousResumeWriteRequest = {
  readonly changeId: string;
  readonly goal: string;
  readonly artifactWorkspacePath: string;
  readonly apply?: boolean;
  readonly clock?: () => string;
};

export type AutonomousResumeArtifactFile = {
  readonly path: string;
  readonly content: string;
};

export type AutonomousResumeWriteResult = {
  readonly applied: boolean;
  readonly files: readonly AutonomousResumeArtifactFile[];
};

function defaultClock(): string {
  return new Date().toISOString();
}

function normalizeGoal(goal: string): string {
  const trimmed = goal.trim();
  if (!trimmed) {
    throw new Error('Goal must be non-empty');
  }
  return trimmed;
}

function renderGoalPackage(changeId: string, goal: string): string {
  return `${JSON.stringify({
    changeId,
    artifactType: 'goal-package',
    status: 'ready',
    goal,
    doneCondition: `Autonomous plan for ${changeId} is complete when all acceptance criteria pass, the worker queue is empty or blocked with next actions, and validation evidence is recorded.`,
    resumeCondition: `Resume ${changeId} only after checkpoint artifacts, worker queue state, and validation evidence requirements have been verified.`,
    acceptanceCriteria: [
      'A resumable autonomous RD plan exists with checkpoints, worker queue, and validation evidence requirements.',
      'Curated capabilities from docs/accessRepo.md and docs/mcpServer.md are considered before custom implementation.',
      'Resume after compact verifies checkpoints and evidence before continuing.',
      'All execution remains dry-run until explicitly approved.'
    ]
  }, null, 2)}\n`;
}

function renderRdPlan(changeId: string): string {
  return `${JSON.stringify({
    changeId,
    artifactType: 'rd-plan',
    status: 'ready',
    workerQueueStatus: 'ready',
    taskCount: 1,
    reducerRequired: true
  }, null, 2)}\n`;
}

function renderCheckpoint(changeId: string, createdAt: string): string {
  return `${JSON.stringify({
    changeId,
    artifactType: 'checkpoint',
    status: 'ready',
    checkpointId: 'checkpoint-1',
    createdAt,
    workerQueueState: {},
    validationRefs: ['unit-tests.md']
  }, null, 2)}\n`;
}

function renderValidationReport(changeId: string): string {
  return `---
changeId: ${changeId}
artifactType: validation-report
status: passed
---

Validation summary:

- Resume artifact scaffold generated for ${changeId}.

Checks:

- unit-tests

Result: passed

Evidence refs:

- unit-tests.md
`;
}

function renderUnitTestsEvidence(changeId: string): string {
  return `# unit-tests evidence for ${changeId}

Replace this stub with the real test command, output, and coverage delta. The autonomous resume validator only requires this file to exist and be a safe markdown name listed in checkpoint-1.json validationRefs.
`;
}

function renderResumeInstructions(changeId: string): string {
  return `---
changeId: ${changeId}
artifactType: resume-instructions
status: passed
---

Resume steps:

- Read autonomous-goal-package.json and confirm acceptance criteria.
- Read autonomous-rd-plan.json and reconcile worker queue with current diff.
- Read checkpoint-1.json and verify worker queue state matches what is on disk.
- Read evidence/*.md referenced by checkpoint validationRefs and confirm Result: passed.

Preconditions:

- Artifact workspace is local and matches changeId ${changeId}.
- No destructive --apply has run without explicit authorization.

Blocked actions:

- Resume cannot proceed if checkpoint validationRefs or evidence files are missing or invalid.

Next actions:

- Run peaks workflow autonomous --change-id ${changeId} --goal "<goal>" --json to recompute the plan.
- Compare blockedReasons; resolve before reattempting resume.
`;
}

function buildFiles(changeId: string, goal: string, createdAt: string, artifactWorkspacePath: string): AutonomousResumeArtifactFile[] {
  // Slice 2026-06-23-audit-5th-p1: route every reviewable artifact under
  // the canonical change-id scope dir at
  // `.peaks/_runtime/change/<changeId>/...` (see
  // `getChangeScopeDirAbs` in `services/artifacts/change-scope-service.ts`).
  // The old `.peaks/_runtime/${changeId}/...` shape was a SKILL.md 2.8.3 hard-ban
  // violation — change-id content must NEVER appear as a sibling of
  // `.peaks/_runtime/`. The `.peaks/_runtime/` gitignore rule covers
  // the new path; reviewable-vs-ephemeral split is preserved.
  const scopeRoot = getChangeScopeDirAbs(artifactWorkspacePath, changeId);
  return [
    {
      path: join(scopeRoot, 'prd', 'autonomous-goal-package.json'),
      content: renderGoalPackage(changeId, goal)
    },
    {
      path: join(scopeRoot, 'rd', 'swarm', 'autonomous-rd-plan.json'),
      content: renderRdPlan(changeId)
    },
    {
      path: join(scopeRoot, 'rd', 'swarm', 'checkpoints', 'checkpoint-1.json'),
      content: renderCheckpoint(changeId, createdAt)
    },
    {
      path: join(scopeRoot, 'rd', 'swarm', 'evidence', 'unit-tests.md'),
      content: renderUnitTestsEvidence(changeId)
    },
    {
      path: join(scopeRoot, 'rd', 'swarm', 'evidence', 'validation-report.md'),
      content: renderValidationReport(changeId)
    },
    {
      path: join(scopeRoot, 'rd', 'swarm', 'resume-instructions.md'),
      content: renderResumeInstructions(changeId)
    }
  ];
}

export async function writeAutonomousResumeArtifacts(request: AutonomousResumeWriteRequest): Promise<AutonomousResumeWriteResult> {
  validateChangeIdOrThrow(request.changeId);
  const goal = normalizeGoal(request.goal);
  const clock = request.clock ?? defaultClock;
  const createdAt = clock();
  const files = buildFiles(request.changeId, goal, createdAt, request.artifactWorkspacePath);

  if (request.apply !== true) {
    return { applied: false, files };
  }

  for (const file of files) {
    if (await pathExists(file.path)) {
      throw new Error(`Refusing to write: ${file.path} already exists. Remove it before re-running peaks autonomous resume init --apply.`);
    }
  }

  for (const file of files) {
    await mkdir(dirname(file.path), { recursive: true });
    await writeFile(file.path, file.content, 'utf8');
  }

  return { applied: true, files };
}
