/**
 * tech-change-id-service — change-id-axis slice of the tech planner (rid-012).
 *
 * Purpose:
 *   The original `peaks tech plan` / `peaks tech status` (in `tech-service.ts`)
 *   is keyed by an active session id (the change-id axis was removed in
 *   v2.19.0). This module provides the *consumer-side wiring* that lets the
 *   same CLI surface be re-keyed by an explicit `--change-id <id>` for the
 *   OpenSpec / change-driven workflow. The path math, change-id validation,
 *   and workspace-unavailable response are all delegated to the rid-009
 *   helpers in `src/services/openspec/artifact-boundary.ts`.
 *
 * Style:
 *   - Named function exports (matches `artifact-boundary.ts`).
 *   - Hand-rolled `Result<T, E>` unions — no `neverthrow` dep.
 *   - Pure path math; never reads the filesystem.
 *
 * Hard ban:
 *   - This file MUST NOT import from `peaks-loop-shared` (stays inside
 *     peaks-loop per §9 of the rid-012 plan).
 *   - This file MUST NOT touch `src/services/openspec/artifact-boundary.ts`
 *     (rid-009 helpers are frozen; we only consume via import).
 */

import type { WorkspaceConfig } from '../config/config-types.js';
import {
  type BoundaryError,
  type ChangeIdError,
  type PlanArtifactPathOutput,
  type WorkspaceUnavailableResponse,
  buildWorkspaceUnavailable,
  planArtifactPath,
  validateChangeId,
  type Result,
} from '../openspec/artifact-boundary.js';

export type TechArtifactPathResult = PlanArtifactPathOutput;

export type TechChangeArtifacts = {
  taskGraph: TechArtifactPathResult;
  waveManifests: TechArtifactPathResult[];
  reviewChecklist: TechArtifactPathResult;
  approvalTemplate: TechArtifactPathResult;
};

export type TechChangeStatusValue = 'unavailable' | 'missing' | 'blocked' | 'approved';

export type TechChangeStatus = {
  changeId: string;
  status: TechChangeStatusValue;
  artifactRoot: string;
  requiredArtifacts: string[];
  missingArtifacts: string[];
  approvalRecord: string | null;
  blockedReasons: string[];
  nextActions: string[];
};

/**
 * Wave template names — must match the 4 waves the existing
 * `tech-service.ts#createTechGraph` produces (scan / document / review /
 * reducer). The relative path layout follows `design.md §Artifact Layout`
 * verbatim: `<change-id>/architecture/waves/wave-<index>-<wave>.json`.
 */
const TECH_CHANGE_ID_WAVES = ['scan', 'document', 'review', 'reducer'] as const;

const TECH_ARCHITECTURE_ROOT = '<changeId>/architecture';

/**
 * Validate a change-id string. This is a thin consumer-side wrapper that
 * delegates to `validateChangeId` (rid-009). The wrapper exists so the
 * change-id-axis service has a single named export point (`validateTechChangeId`)
 * and so the test file can import it without reaching across to openspec.
 */
export function validateTechChangeId(id: string): Result<{ changeId: string }, ChangeIdError> {
  return validateChangeId(id);
}

/**
 * Plan the 5 artifact-relative paths the tech-change-id planner needs to
 * expose:
 *   - `taskGraph`           → `<id>/architecture/tech-task-graph.json`
 *   - `waveManifests`       → `<id>/architecture/waves/wave-<n>-<wave>.json` (4)
 *   - `reviewChecklist`     → `<id>/architecture/tech-review-checklist.md`
 *   - `approvalTemplate`    → `<id>/architecture/tech-approval-record.template.md`
 *
 * Delegates to `planArtifactPath` (rid-009) for each one. Returns the FIRST
 * failure (so callers get a single, deterministic BoundaryError).
 *
 * Pure path math — does not touch the filesystem.
 */
export function planTechArtifactPath(input: {
  changeId: string;
  workspaceRoot: string;
  requestId: string;
}): Result<TechChangeArtifacts, BoundaryError> {
  const taskGraphResult = planArtifactPath({
    changeId: input.changeId,
    workspaceRoot: input.workspaceRoot,
    role: 'architecture',
    requestId: input.requestId,
    template: `${TECH_ARCHITECTURE_ROOT}/tech-task-graph.json`,
  });
  if (!taskGraphResult.ok) return taskGraphResult;

  const waveManifestResults: TechArtifactPathResult[] = [];
  for (let index = 0; index < TECH_CHANGE_ID_WAVES.length; index += 1) {
    const wave = TECH_CHANGE_ID_WAVES[index];
    const waveResult = planArtifactPath({
      changeId: input.changeId,
      workspaceRoot: input.workspaceRoot,
      role: 'architecture',
      requestId: input.requestId,
      template: `${TECH_ARCHITECTURE_ROOT}/waves/wave-${index + 1}-${wave}.json`,
    });
    if (!waveResult.ok) return waveResult;
    waveManifestResults.push(waveResult.value);
  }

  const reviewChecklistResult = planArtifactPath({
    changeId: input.changeId,
    workspaceRoot: input.workspaceRoot,
    role: 'architecture',
    requestId: input.requestId,
    template: `${TECH_ARCHITECTURE_ROOT}/tech-review-checklist.md`,
  });
  if (!reviewChecklistResult.ok) return reviewChecklistResult;

  const approvalTemplateResult = planArtifactPath({
    changeId: input.changeId,
    workspaceRoot: input.workspaceRoot,
    role: 'architecture',
    requestId: input.requestId,
    template: `${TECH_ARCHITECTURE_ROOT}/tech-approval-record.template.md`,
  });
  if (!approvalTemplateResult.ok) return approvalTemplateResult;

  return {
    ok: true,
    value: {
      taskGraph: taskGraphResult.value,
      waveManifests: waveManifestResults,
      reviewChecklist: reviewChecklistResult.value,
      approvalTemplate: approvalTemplateResult.value,
    },
  };
}

/**
 * Build the workspace-unavailable response for the change-id-axis tech
 * planner. Thin wrapper around `buildWorkspaceUnavailable` (rid-009) so
 * the same single source of truth (nextActions constant) is reused.
 *
 * The `mode` discriminator matches the existing artifact-boundary shape
 * (`'preview-only' | 'blocked'`).
 */
export function buildTechWorkspaceUnavailable(input: {
  mode: WorkspaceUnavailableResponse['mode'];
}): WorkspaceUnavailableResponse {
  return buildWorkspaceUnavailable(input);
}

// Re-export the WorkspaceConfig type so the CLI module can import everything
// it needs from one place.
export type { WorkspaceConfig };