/**
 * v2.18.3 — re-export identity tests for the 4 file splits.
 *
 * Locks the verbatim-move re-export shim pattern: every function /
 * class / type that moved into a sibling module must be re-exported
 * from the original module as the SAME reference (not a re-implementation).
 * If a future refactor accidentally re-defines one of the moved symbols
 * in the original file, these tests will fail.
 */
import { describe, expect, test } from 'vitest';
import * as reqHelpers from '../../src/services/artifacts/request-artifact-state-helpers.js';
import * as reqService from '../../src/services/artifacts/request-artifact-service.js';
import * as sliceRunners from '../../src/services/slice/slice-decompose-runners.js';
import * as sliceService from '../../src/services/slice/slice-decompose-service.js';
import * as workflowResumeHelpers from '../../src/services/workflow/workflow-autonomous-resume-helpers.js';
import * as workflowService from '../../src/services/workflow/workflow-autonomous-service.js';
import * as workspaceMaterializer from '../../src/services/workspace/workspace-claude-settings-materializer.js';
import * as workspaceService from '../../src/services/workspace/workspace-service.js';

describe('v2.18.3 file-split re-export identity', () => {
  test('request-artifact-service re-exports state helpers (identity)', () => {
    expect(reqService.allowedStatesForRole).toBe(reqHelpers.allowedStatesForRole);
    expect(reqService.PrerequisitesNotSatisfiedError).toBe(reqHelpers.PrerequisitesNotSatisfiedError);
    expect(reqService.LintGateError).toBe(reqHelpers.LintGateError);
    expect(reqService.TypeSanityViolationError).toBe(reqHelpers.TypeSanityViolationError);
    expect(reqService.FileSizeViolationError).toBe(reqHelpers.FileSizeViolationError);
    expect(reqService.updateStatusBlock).toBe(reqHelpers.updateStatusBlock);
  });

  test('slice-decompose-service re-exports default runners (identity)', () => {
    expect(sliceService.defaultCodegraphRunner).toBe(sliceRunners.defaultCodegraphRunner);
    expect(sliceService.defaultUnderstandRunner).toBe(sliceRunners.defaultUnderstandRunner);
    expect(sliceService.defaultImportEdgeRunner).toBe(sliceRunners.defaultImportEdgeRunner);
  });

  test('workflow-autonomous-service re-exports resume helpers (identity)', () => {
    expect(workflowService.getResumeRequiredArtifacts).toBe(workflowResumeHelpers.getResumeRequiredArtifacts);
    expect(workflowService.getResumeArtifactsStatus).toBe(workflowResumeHelpers.getResumeArtifactsStatus);
    expect(workflowService.createResumePlan).toBe(workflowResumeHelpers.createResumePlan);
  });

  test('workspace-service re-exports claude-settings materializer (identity)', () => {
    expect(workspaceService.materializeClaudeSettingsLocal).toBe(workspaceMaterializer.materializeClaudeSettingsLocal);
  });
});
