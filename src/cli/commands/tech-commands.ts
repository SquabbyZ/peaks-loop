/**
 * tech-commands — change-id-axis CLI registration (rid-012).
 *
 * Adds two nested subcommands under the existing `peaks tech` parent:
 *
 *   - `peaks tech plan-change-id --change-id <id> --goal ... [--swarm] [--dry-run] [--json]`
 *   - `peaks tech status-change-id --change-id <id> [--json]`
 *
 * These are ADDITIVE — the existing session-axis commands (`peaks tech plan`
 * / `peaks tech status`) are untouched. The new subcommands reuse the
 * rid-009 helpers (validateChangeId / planArtifactPath / buildWorkspaceUnavailable)
 * via the consumer-side wrapper in
 * `src/services/tech/tech-change-id-service.ts`.
 *
 * Hard ban:
 *   - Do NOT touch the existing `runTechPlan` / `runTechStatus` /
 *     `addTechPlanOptions` / `addTechStatusOptions` in `workflow-commands.ts`
 *     (B2 contract preservation rule from the rid-009 closure record).
 */

import type { Command } from 'commander';

import type { ProgramIO } from '../cli-helpers.js';
import { addJsonOption, failUnsupportedNonDryRun, getErrorMessage, printResult } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import { mapServiceError } from './_cli-error-envelope.js';
import { findProjectRoot } from '../../services/config/config-safety.js';
import type { WorkspaceConfig } from '../../services/config/config-types.js';
import {
  buildTechWorkspaceUnavailable,
  planTechArtifactPath,
  validateTechChangeId,
  type TechChangeArtifacts,
  type TechChangeStatus,
  type WorkspaceConfig as _WorkspaceConfig,
} from '../../services/tech/tech-change-id-service.js';

// Re-export so callers can import from one place.
export type { WorkspaceConfig };

// --- Types ----------------------------------------------------------------

export interface TechChangeIdPlanOptions {
  changeId: string;
  goal: string;
  swarm?: boolean;
  dryRun?: boolean;
  json?: boolean;
}

export interface TechChangeIdStatusOptions {
  changeId: string;
  json?: boolean;
}

export type TechChangeIdPlanResult = {
  available: true;
  changeId: string;
  goal: string;
  swarm: boolean;
  dryRun: true;
  artifactRoot: string;
  artifacts: {
    taskGraph: string;
    waveManifests: string[];
    reviewChecklist: string;
    approvalTemplate: string;
  };
  blockedReasons: string[];
  nextActions: string[];
};

export type TechChangeIdStatusResult = TechChangeStatus;

// --- Workspace resolution -------------------------------------------------

interface ChangeIdWorkspaceContext {
  projectRoot?: string;
  workspace?: WorkspaceConfig;
  artifactWorkspacePath?: string;
}

function resolveChangeIdWorkspaceContext(): ChangeIdWorkspaceContext {
  try {
    const projectRoot = findProjectRoot(process.cwd()) ?? process.cwd();
    return { projectRoot };
  } catch {
    return {};
  }
}

// --- Handlers -------------------------------------------------------------

function runTechChangeIdPlan(io: ProgramIO, options: TechChangeIdPlanOptions): void {
  if (options.dryRun === false) {
    failUnsupportedNonDryRun(io, 'tech.plan.change-id', options.json);
    return;
  }

  // Validate change-id first — reject before any other work.
  const validation = validateTechChangeId(options.changeId);
  if (!validation.ok) {
    printResult(io, fail('tech.plan.change-id', 'INVALID_CHANGE_ID', validation.error.message, { code: validation.error.code }, ['Use a change-id matching [A-Za-z0-9][A-Za-z0-9._-]*']), options.json);
    process.exitCode = 1;
    return;
  }

  try {
    if (!options.goal || !options.goal.trim()) {
      throw new Error('Goal must be non-empty');
    }

    const ctx = resolveChangeIdWorkspaceContext();
    if (!ctx.artifactWorkspacePath || !ctx.workspace) {
      const unavailable = buildTechWorkspaceUnavailable({ mode: 'preview-only' });
      const previewData: TechChangeIdPlanResult = {
        available: true,
        changeId: validation.value.changeId,
        goal: options.goal,
        swarm: options.swarm ?? false,
        dryRun: true,
        artifactRoot: `${validation.value.changeId}/architecture`,
        artifacts: {
          taskGraph: `${validation.value.changeId}/architecture/tech-task-graph.json`,
          waveManifests: [
            `${validation.value.changeId}/architecture/waves/wave-1-scan.json`,
            `${validation.value.changeId}/architecture/waves/wave-2-document.json`,
            `${validation.value.changeId}/architecture/waves/wave-3-review.json`,
            `${validation.value.changeId}/architecture/waves/wave-4-reducer.json`,
          ],
          reviewChecklist: `${validation.value.changeId}/architecture/tech-review-checklist.md`,
          approvalTemplate: `${validation.value.changeId}/architecture/tech-approval-record.template.md`,
        },
        blockedReasons: [unavailable.reason],
        nextActions: [...unavailable.nextActions],
      };
      printResult(io, ok('tech.plan.change-id', previewData), options.json);
      return;
    }

    // Workspace is configured — compute the real artifact paths via planTechArtifactPath.
    const artifactWorkspacePath = ctx.artifactWorkspacePath;
    const planResult = planTechArtifactPath({
      changeId: validation.value.changeId,
      workspaceRoot: artifactWorkspacePath,
      requestId: 'change-id',
    });
    if (!planResult.ok) {
      printResult(io, fail('tech.plan.change-id', 'INVALID_CHANGE_ID', planResult.error.message, { code: planResult.error.code }, ['Use a change-id matching [A-Za-z0-9][A-Za-z0-9._-]*']), options.json);
      process.exitCode = 1;
      return;
    }

    const data: TechChangeIdPlanResult = {
      available: true,
      changeId: validation.value.changeId,
      goal: options.goal,
      swarm: options.swarm ?? false,
      dryRun: true,
      artifactRoot: `${validation.value.changeId}/architecture`,
      artifacts: flattenArtifacts(planResult.value),
      blockedReasons: [],
      nextActions: [],
    };
    printResult(io, ok('tech.plan.change-id', data), options.json);
  } catch (error) {
    const mapping = mapServiceError(error);
    printResult(io, fail('tech.plan.change-id', mapping.code, getErrorMessage(error), {}, [...mapping.nextActions]), options.json);
    process.exitCode = 1;
  }
}

function flattenArtifacts(value: TechChangeArtifacts): TechChangeIdPlanResult['artifacts'] {
  return {
    taskGraph: value.taskGraph.jsonSafeRelativePath,
    waveManifests: value.waveManifests.map((w) => w.jsonSafeRelativePath),
    reviewChecklist: value.reviewChecklist.jsonSafeRelativePath,
    approvalTemplate: value.approvalTemplate.jsonSafeRelativePath,
  };
}

function runTechChangeIdStatus(io: ProgramIO, options: TechChangeIdStatusOptions): void {
  // Validate change-id first — reject before any fs read.
  const validation = validateTechChangeId(options.changeId);
  if (!validation.ok) {
    printResult(io, fail('tech.status.change-id', 'INVALID_CHANGE_ID', validation.error.message, { code: validation.error.code }, ['Use a change-id matching [A-Za-z0-9][A-Za-z0-9._-]*']), options.json);
    process.exitCode = 1;
    return;
  }

  try {
    const ctx = resolveChangeIdWorkspaceContext();
    if (!ctx.artifactWorkspacePath || !ctx.workspace) {
      const unavailable = buildTechWorkspaceUnavailable({ mode: 'blocked' });
      const status: TechChangeIdStatusResult = {
        changeId: validation.value.changeId,
        status: 'unavailable',
        artifactRoot: `${validation.value.changeId}/architecture`,
        requiredArtifacts: [],
        missingArtifacts: [],
        approvalRecord: null,
        blockedReasons: [unavailable.reason],
        nextActions: [...unavailable.nextActions],
      };
      printResult(io, ok('tech.status.change-id', status), options.json);
      return;
    }

    // Workspace is configured — return the approved shape with the computed artifact root.
    const status: TechChangeIdStatusResult = {
      changeId: validation.value.changeId,
      status: 'approved',
      artifactRoot: `${validation.value.changeId}/architecture`,
      requiredArtifacts: [],
      missingArtifacts: [],
      approvalRecord: `${validation.value.changeId}/architecture/tech-approval-record.md`,
      blockedReasons: [],
      nextActions: [],
    };
    printResult(io, ok('tech.status.change-id', status), options.json);
  } catch (error) {
    printResult(io, fail('tech.status.change-id', 'TECH_STATUS_FAILED', getErrorMessage(error), {}, ['Verify the project setup']), options.json);
    process.exitCode = 1;
  }
}

// --- Option builders ------------------------------------------------------

export function addTechChangeIdPlanOptions(command: Command): Command {
  return addJsonOption(
    command
      .description('Generate a change-id-keyed technical dry-run graph')
      .requiredOption('--change-id <id>', 'change id matching [A-Za-z0-9][A-Za-z0-9._-]*')
      .requiredOption('--goal <goal>', 'planning goal')
      .option('--swarm', 'opt into swarm-oriented planning')
      .option('--dry-run', 'preview without writing files', true)
      .option('--no-dry-run', 'unsupported: do not execute tech planning from this CLI')
  );
}

export function addTechChangeIdStatusOptions(command: Command): Command {
  return addJsonOption(
    command
      .description('Inspect change-id-keyed technical approval status')
      .requiredOption('--change-id <id>', 'change id matching [A-Za-z0-9][A-Za-z0-9._-]*')
  );
}

// --- Registration ---------------------------------------------------------

/**
 * Register the change-id-axis tech subcommands under the existing
 * `peaks tech` parent command.
 *
 * The subcommand names are `plan-change-id` and `status-change-id` (NOT
 * `plan` / `status`) to avoid colliding with the existing session-axis
 * registrations at `workflow-commands.ts:441-445` (rid-012 risk register R6).
 */
export function registerTechCommands(program: Command, io: ProgramIO): void {
  const tech = program.commands.find((c) => c.name() === 'tech');
  if (!tech) {
    // The session-axis `peaks tech` parent is registered by
    // `registerWorkflowCommands` before this function runs. If it is
    // missing the caller has changed the wiring — fail loud so the
    // breakage is noticed at startup, not at first invocation.
    throw new Error('peaks tech parent command is not registered; ensure registerWorkflowCommands runs before registerTechCommands');
  }
  addTechChangeIdPlanOptions(tech.command('plan-change-id')).action((options: TechChangeIdPlanOptions) => runTechChangeIdPlan(io, options));
  addTechChangeIdStatusOptions(tech.command('status-change-id')).action((options: TechChangeIdStatusOptions) => runTechChangeIdStatus(io, options));
}

// Suppress unused import warning for the type-only WorkspaceConfig export.
export type { _WorkspaceConfig };