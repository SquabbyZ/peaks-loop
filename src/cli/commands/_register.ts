import type { Command } from 'commander';
import type { ProgramIO } from '../cli-helpers.js';

import { registerAdapterCommands } from './adapter-commands.js';
import { registerAdapterS2ACommands } from './adapter-commands-s2a.js';
import { registerAssetCommands } from './asset-commands.js';
import { registerAuditCommands } from './audit-commands.js';
import { registerAutonomousSwarmCommands } from './autonomous-swarm-commands.js';
import { registerBeeCommands } from './bee-commands.js';
import { registerCapabilityCommands } from './capability-commands.js';
import { registerCapabilityWorkerConfigAndSCCommands } from './capability-worker-config-sc-commands.js';
import { registerCodeCommands } from './code-commands.js';
import { registerCodeReviewCommands } from './code-review-commands.js';
import { registerCodegraphCommands } from './codegraph-commands.js';
import { registerCompactCommands } from './compact-command.js';
import { registerComplexityCommands } from './complexity-commands.js';
import { registerConfigCommands } from './config-commands.js';
import { registerContextCommands } from './context-commands.js';
import { registerCoreAndArtifactCommands } from './core-artifact-commands.js';
import { registerDocCommands } from './doc-commands.js';
import { registerEccCommands } from './ecc-commands.js';
import { registerEvolutionCommands } from './evolution-commands.js';
import { registerFeedbackCommands } from './feedback-commands.js';
import { registerFinalReviewCommands } from './final-review-commands.js';
import { registerFixtureCommands } from './fixture-commands.js';
import { registerForkCommands } from './fork-commands.js';
import { registerGateCommands } from './gate-commands.js';
import { registerClassifyCommands, registerContractCommands } from './governance-classify-contract-commands.js';
import { registerHookHandleCommand } from './hook-handle.js';
import { registerHooksCommands } from './hooks-commands.js';
import { registerIdeCommands } from './ide-commands.js';
import { registerImpactCommands } from './impact-commands.js';
import { registerJobCommands } from './job-commands.js';
import { registerLegacyCommands } from './legacy-commands.js';
import { registerLogCommands } from './log-commands.js';
import { registerLoopCommands } from './loop-commands.js';
import { registerWorkflowEvalCommands } from './loop-eval-commands.js';
import { registerMutCommands } from './mut-commands.js';
import { registerObservabilityCommands } from './observability-commands.js';
import { registerOpenSpecCommands } from './openspec-commands.js';
import { registerPerfAuditCommands } from './perf-audit-commands.js';
import { registerPerfCommands } from './perf-commands.js';
import { registerPlaywrightCommands } from './playwright-commands.js';
import { registerPolyrepoCommands } from './polyrepo-commands.js';
import { registerPrdBlocksCommands } from './prd-blocks-commands.js';
import { registerPrdCommands } from './prd-commands.js';
import { registerPreferencesCommands } from './preferences-commands.js';
import { registerProjectCommands } from './project-commands.js';
import { registerChangesetCommands } from './changeset-commands.js';
import { registerQaBusinessReviewCommands } from './qa-business-review-commands.js';
import { registerQaCommands } from './qa-commands.js';
import { registerReleaseCommands } from './release-commands.js';
import { registerRequestCommands } from './request-commands.js';
import { registerRetrospectiveCommands } from './retrospective-commands.js';
import { registerReviewerCommands } from './reviewer-commands.js';
import { registerRoleCommands } from './role-commands.js';
import { registerRuntimeCommands } from './runtime-commands.js';
import { registerSCCommands } from './sc-commands.js';
import { registerScanCommands } from './scan-commands.js';
import { registerSecurityAuditCommands } from './security-audit-commands.js';
import { registerSedimentCommands } from './sediment-commands.js';
import { registerSkillConformanceCommands } from './skill-conformance-commands.js';
import { registerSkillLoopEngineeringReadinessCommands } from './skill-loop-engineering-readiness-commands.js';
import { registerSkillVisibilityCommand } from './skill-visibility.js';
import { registerSliceCommands } from './slice-commands.js';
import { registerSliceIntegrateCommands } from './slice-integrate-commands.js';
import { registerSliceReviewCommands } from './slice-review-commands.js';
import { registerSmokeCommands } from './smoke-commands.js';
import { registerSopCommands } from './sop-commands.js';
import { registerStatusLineCommands } from './statusline-commands.js';
import { registerSubAgentCommands } from './sub-agent-commands.js';
import { registerSubAgentDispatchGuard } from './sub-agent-dispatch-guard.js';
import { registerSwarmCommands } from './swarm-commands.js';
import { registerTechCommands } from './tech-commands.js';
import { registerTestCommands } from './test-commands.js';
import { registerUnderstandCommands } from './understand-commands.js';
import { registerUpgradeCommands } from './upgrade-commands.js';
import { registerUserTouchpointCommands } from './user-touchpoint-commands.js';
import { registerVerdictAggregateCommands } from './verdict-aggregate-command.js';
import { registerWorkflowCommands } from './workflow-commands.js';
import { registerWorkflowPlanCommands } from './workflow-plan-commands.js';
import { registerWorkspaceCommands } from './workspace-commands.js';

// Bivariant alias so stronger-typed register functions remain assignable
// without forcing `(...args: unknown[])` parameterization on every call.
type RegisterFn = ((program: Command) => void) | ((program: Command, io: ProgramIO) => void);
type Registration = readonly [moduleName: string, register: RegisterFn];

const NON_AUTO: ReadonlySet<string> = new Set([
  'core-artifact-commands', 'capability-worker-config-sc-commands',
  'sub-agent-commands', 'workspace-commands', 'workflow-commands',
  'sop-commands', 'skill-visibility',
]);

const REGISTRATIONS: readonly Registration[] = [
  ['core-artifact-commands', registerCoreAndArtifactCommands],
  ['workflow-commands', registerWorkflowCommands],
  ['capability-worker-config-sc-commands', registerCapabilityWorkerConfigAndSCCommands],
  ['codegraph-commands', registerCodegraphCommands], ['openspec-commands', registerOpenSpecCommands],
  ['perf-commands', registerPerfCommands], ['preferences-commands', registerPreferencesCommands],
  ['project-commands', registerProjectCommands], ['prd-commands', registerPrdCommands],
  ['request-commands', registerRequestCommands], ['retrospective-commands', registerRetrospectiveCommands],
  ['scan-commands', registerScanCommands], ['slice-commands', registerSliceCommands],
  ['sop-commands', registerSopCommands], ['feedback-commands', registerFeedbackCommands],
  ['fork-commands', registerForkCommands], ['impact-commands', registerImpactCommands],
  ['smoke-commands', registerSmokeCommands], ['release-commands', registerReleaseCommands],
  ['changeset-commands', registerChangesetCommands],
  ['prd-blocks-commands', registerPrdBlocksCommands], ['user-touchpoint-commands', registerUserTouchpointCommands],
  ['slice-review-commands', registerSliceReviewCommands], ['qa-business-review-commands', registerQaBusinessReviewCommands],
  ['slice-integrate-commands', registerSliceIntegrateCommands], ['doc-commands', registerDocCommands],
  ['legacy-commands', registerLegacyCommands], ['role-commands', registerRoleCommands],
  ['complexity-commands', registerComplexityCommands], ['sub-agent-commands', registerSubAgentCommands],
  ['governance-classify-contract-commands', registerContractCommands],
  ['sub-agent-dispatch-guard', registerSubAgentDispatchGuard], ['gate-commands', registerGateCommands],
  ['hook-handle', registerHookHandleCommand], ['hooks-commands', registerHooksCommands],
  ['statusline-commands', registerStatusLineCommands], ['understand-commands', registerUnderstandCommands],
  ['workspace-commands', registerWorkspaceCommands], ['workflow-plan-commands', registerWorkflowPlanCommands],
  ['audit-commands', registerAuditCommands], ['final-review-commands', registerFinalReviewCommands],
  ['governance-classify-contract-commands', registerClassifyCommands], ['context-commands', registerContextCommands],
  ['skill-conformance-commands', registerSkillConformanceCommands],
  ['skill-loop-engineering-readiness-commands', registerSkillLoopEngineeringReadinessCommands],
  ['loop-commands', registerLoopCommands], ['loop-eval-commands', registerWorkflowEvalCommands],
  ['evolution-commands', registerEvolutionCommands], ['asset-commands', registerAssetCommands],
  ['bee-commands', registerBeeCommands], ['ecc-commands', registerEccCommands],
  ['upgrade-commands', registerUpgradeCommands], ['code-review-commands', registerCodeReviewCommands],
  ['security-audit-commands', registerSecurityAuditCommands], ['perf-audit-commands', registerPerfAuditCommands],
  ['verdict-aggregate-command', registerVerdictAggregateCommands], ['log-commands', registerLogCommands],
  ['qa-commands', registerQaCommands], ['test-commands', registerTestCommands],
  ['playwright-commands', registerPlaywrightCommands], ['code-commands', registerCodeCommands],
  ['mut-commands', registerMutCommands], ['fixture-commands', registerFixtureCommands],
  ['reviewer-commands', registerReviewerCommands], ['ide-commands', registerIdeCommands],
  ['observability-commands', registerObservabilityCommands], ['compact-command', registerCompactCommands],
  ['job-commands', registerJobCommands], ['sediment-commands', registerSedimentCommands],
  ['adapter-commands', registerAdapterCommands], ['runtime-commands', registerRuntimeCommands],
  ['adapter-commands-s2a', registerAdapterS2ACommands], ['polyrepo-commands', registerPolyrepoCommands],
];

function dispatchRegister(register: RegisterFn, program: Command, io: ProgramIO): void {
  if (register.length <= 1) {
    (register as (program: Command) => void)(program);
  } else {
    (register as (program: Command, io: ProgramIO) => void)(program, io);
  }
}

export function autoRegisterAllCommands(program: Command, io: ProgramIO): void {
  for (const [moduleName, register] of REGISTRATIONS) {
    if (!NON_AUTO.has(moduleName)) dispatchRegister(register, program, io);
  }
}
