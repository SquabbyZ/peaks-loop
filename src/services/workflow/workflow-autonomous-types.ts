/**
 * peaks-workflow — public type declarations for autonomous workflow planning.
 *
 * Pure type module. No runtime helpers, no constants. The slimmed
 * `workflow-autonomous-service.ts` re-exports the types so existing
 * import paths compile unchanged (rid-006 split).
 *
 * Per PRD EC-1, this module is consumed by both
 * `workflow-autonomous-service.ts` and
 * `workflow-autonomous-resume-helpers.ts` via `import type`. Importing
 * this types-only module breaks the existing
 * resume-helpers ↔ autonomous-service runtime cycle (both modules
 * previously re-exported `AutonomousResumePlan` from each other).
 *
 * File budget: ≤ 400 lines (rid-006 split).
 */

import type { CapabilityAvailabilityStatus, CapabilityItemType } from '../recommendations/recommendation-types.js';
import type { ModelProviderConfig, WorkspaceConfig } from '../config/config-types.js';
import type { RdPlanResult } from '../rd/rd-service.js';
import type { CodeMode, WorkflowMode, WorkflowRouterPlan } from './workflow-router-service.js';

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
  readonly codeMode?: CodeMode;
  readonly sessionId: string;
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
  readonly sessionId: string;
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
  readonly codeMode: CodeMode | undefined;
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
  readonly sessionId: string;
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

// Note: `CapabilityAvailabilityStatus` is referenced by the orchestrator's
// helper functions. It is imported (not re-exported) from the
// recommendation-types module — keep this types module pure to the
// declarations originally declared in `workflow-autonomous-service.ts`.