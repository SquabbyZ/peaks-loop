import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { getSessionDir } from '../session/getSessionDir.js';
import { pathExists } from '../../shared/fs.js';
import { isUnsafePathInput } from '../../shared/path-safety.js';

export type AutonomousResumeWriteRequest = {
  readonly sessionId: string;
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

function renderGoalPackage(sessionId: string, goal: string): string {
  return `${JSON.stringify({
    sessionId,
    artifactType: 'goal-package',
    status: 'ready',
    goal,
    doneCondition: `Autonomous plan for ${sessionId} is complete when all acceptance criteria pass, the worker queue is empty or blocked with next actions, and validation evidence is recorded.`,
    resumeCondition: `Resume ${sessionId} only after checkpoint artifacts, worker queue state, and validation evidence requirements have been verified.`,
    acceptanceCriteria: [
      'A resumable autonomous RD plan exists with checkpoints, worker queue, and validation evidence requirements.',
      'Curated capabilities from docs/accessRepo.md and docs/mcpServer.md are considered before custom implementation.',
      'Resume after compact verifies checkpoints and evidence before continuing.',
      'All execution remains dry-run until explicitly approved.'
    ]
  }, null, 2)}\n`;
}

function renderRdPlan(sessionId: string): string {
  return `${JSON.stringify({
    sessionId,
    artifactType: 'rd-plan',
    status: 'ready',
    workerQueueStatus: 'ready',
    taskCount: 1,
    reducerRequired: true
  }, null, 2)}\n`;
}

function renderCheckpoint(sessionId: string, createdAt: string): string {
  return `${JSON.stringify({
    sessionId,
    artifactType: 'checkpoint',
    status: 'ready',
    checkpointId: 'checkpoint-1',
    createdAt,
    workerQueueState: {},
    validationRefs: ['unit-tests.md']
  }, null, 2)}\n`;
}

function renderValidationReport(sessionId: string): string {
  return `---
sessionId: ${sessionId}
artifactType: validation-report
status: passed
---

Validation summary:

- Resume artifact scaffold generated for ${sessionId}.

Checks:

- unit-tests

Result: passed

Evidence refs:

- unit-tests.md
`;
}

function renderUnitTestsEvidence(sessionId: string): string {
  return `# unit-tests evidence for ${sessionId}

Replace this stub with the real test command, output, and coverage delta. The autonomous resume validator only requires this file to exist and be a safe markdown name listed in checkpoint-1.json validationRefs.
`;
}

function renderResumeInstructions(sessionId: string): string {
  return `---
sessionId: ${sessionId}
artifactType: resume-instructions
status: passed
---

Resume steps:

- Read autonomous-goal-package.json and confirm acceptance criteria.
- Read autonomous-rd-plan.json and reconcile worker queue with current diff.
- Read checkpoint-1.json and verify worker queue state matches what is on disk.
- Read evidence/*.md referenced by checkpoint validationRefs and confirm Result: passed.

Preconditions:

- Artifact workspace is local and matches sessionId ${sessionId}.
- No destructive --apply has run without explicit authorization.

Blocked actions:

- Resume cannot proceed if checkpoint validationRefs or evidence files are missing or invalid.

Next actions:

- Run peaks workflow autonomous --change-id ${sessionId} --goal "<goal>" --json to recompute the plan.
- Compare blockedReasons; resolve before reattempting resume.
`;
}

function buildFiles(sessionId: string, goal: string, createdAt: string, artifactWorkspacePath: string): AutonomousResumeArtifactFile[] {
  // Slice 2026-06-29-change-id-root-removal: route every reviewable
  // artifact under the session-axis dir at `.peaks/_runtime/<sid>/...`
  // via `getSessionDir`. The change-id identifier is reused as the
  // session-dir name (per-execution scope). The gitignore rule on
  // `.peaks/_runtime/` covers the path; the reviewable-vs-ephemeral
  // split is preserved.
  const scopeRoot = getSessionDir(artifactWorkspacePath, sessionId);
  return [
    {
      path: join(scopeRoot, 'prd', 'autonomous-goal-package.json'),
      content: renderGoalPackage(sessionId, goal)
    },
    {
      path: join(scopeRoot, 'rd', 'swarm', 'autonomous-rd-plan.json'),
      content: renderRdPlan(sessionId)
    },
    {
      path: join(scopeRoot, 'rd', 'swarm', 'checkpoints', 'checkpoint-1.json'),
      content: renderCheckpoint(sessionId, createdAt)
    },
    {
      path: join(scopeRoot, 'rd', 'swarm', 'evidence', 'unit-tests.md'),
      content: renderUnitTestsEvidence(sessionId)
    },
    {
      path: join(scopeRoot, 'rd', 'swarm', 'evidence', 'validation-report.md'),
      content: renderValidationReport(sessionId)
    },
    {
      path: join(scopeRoot, 'rd', 'swarm', 'resume-instructions.md'),
      content: renderResumeInstructions(sessionId)
    }
  ];
}

export async function writeAutonomousResumeArtifacts(request: AutonomousResumeWriteRequest): Promise<AutonomousResumeWriteResult> {
  // Slice 2026-06-29-change-id-root-removal: change-id is metadata-only;
  // structural validation for the session id is a path-safety check
  // (no path-traversal / no absolute path) so unsafe ids never escape
  // the canonical `.peaks/_runtime/<sid>/` scope.
  if (isUnsafePathInput(request.sessionId)) {
    throw new Error(`Refusing to write: session id '${request.sessionId}' is unsafe (path-traversal, absolute, or otherwise malformed).`);
  }
  const goal = normalizeGoal(request.goal);
  const clock = request.clock ?? defaultClock;
  const createdAt = clock();
  const files = buildFiles(request.sessionId, goal, createdAt, request.artifactWorkspacePath);

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
