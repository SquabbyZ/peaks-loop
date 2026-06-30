/**
 * Workflow Autonomous Service -- resume artifact validation helpers.
 *
 * v2.18.3 file-split: this module is the extracted sub-tree of the
 * pre-split `workflow-autonomous-service.ts`. It hosts the resume-
 * validation pipeline (`getResumeRequiredArtifacts`,
 * `readResumeArtifact`, `stripChangeScopePrefix`, JSON / frontmatter
 * validation helpers, `getResumeArtifactsStatus`, and
 * `createResumePlan`). The high-level orchestrator
 * `createAutonomousWorkflowPlan` lives in the parent module and
 * imports from this sibling. Function signatures and behaviour are
 * unchanged (verbatim move).
 */

import { closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
// Slice 2026-06-29-change-id-root-removal: `buildArtifactRelativePath`
// was removed with the change-id axis. The artifact under each
// resume helper now resolves the absolute path via the session-axis
// `getSessionDir` + an explicit role-relative segment; the
// `.peaks/_runtime/<sessionId>/<role>/...` string is no longer
// pre-built.
import { getSessionDir } from '../session/getSessionDir.js';
import type { AutonomousResumePlan } from './workflow-autonomous-service.js';

const MAX_RESUME_ARTIFACT_BYTES = 256_000;

// Slice 2026-06-29-change-id-root-removal: return the bare role-relative
// sub-paths instead of `.peaks/_runtime/change/<id>/<role>/...` strings.
// `getResumeRequiredArtifacts` was previously consumed by callers that
// joined the descriptor with the on-disk session dir computed by
// `getSessionDir`. The new shape is the role-relative segment
// (`rd/swarm/checkpoints/checkpoint-1.json`); the scope dir is supplied
// by the caller. The `sessionId` parameter is kept on the signature so
// existing call sites compile unchanged, but it is no longer embedded
// in the returned strings.
export function getResumeRequiredArtifacts(_sessionId: string): string[] {
  return [
    'prd/autonomous-goal-package.json',
    'rd/swarm/autonomous-rd-plan.json',
    'rd/swarm/checkpoints/checkpoint-1.json',
    'rd/swarm/evidence/validation-report.md',
    'rd/swarm/resume-instructions.md'
  ];
}

type ResumeArtifactsStatus = 'ready' | 'missing' | 'invalid';

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInsidePath(childPath: string, parentPath: string): boolean {
  const relativePath = relative(parentPath, childPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function readFully(fd: number, size: number): string | null {
  const buffer = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const bytesRead = readSync(fd, buffer, offset, size - offset, offset);
    if (bytesRead === 0) {
      return null;
    }
    offset += bytesRead;
  }
  return buffer.toString('utf8');
}

function normalizeRoleRelativePath(artifact: string, _sessionId: string): string {
  // Slice 2026-06-29-change-id-root-removal: `getResumeRequiredArtifacts`
  // returns role-relative sub-paths (e.g.
  // `rd/swarm/checkpoints/checkpoint-1.json`). The helper normalises
  // the path separators and strips any leading `/`; the `sessionId`
  // argument is preserved on the signature for backward call-site
  // compatibility but is no longer embedded in the path.
  return artifact.replace(/\\/g, '/').replace(/^\/+/, '');
}

function readResumeArtifact(artifactWorkspacePath: string, sessionId: string, artifact: string): string | null {
  // Slice 2026-06-29-change-id-root-removal: on-disk home now lives under
  // the session-axis `getSessionDir(root, sessionId)`. The role/swarm
  // sub-path (e.g. `rd/swarm/checkpoints/checkpoint-1.json`) is
  // strictly a sub-root drill, not a top-level dir derivation.
  const sessionScopeRoot = getSessionDir(artifactWorkspacePath, sessionId);
  const normalizedArtifact = artifact.replace(/\\/g, '/').replace(/^\/+/, '');
  const artifactPath = resolve(sessionScopeRoot, normalizedArtifact);
  try {
    const artifactWorkspaceRealPath = realpathSync(artifactWorkspacePath);
    const artifactStat = lstatSync(artifactPath);
    if (artifactStat.isSymbolicLink() || !artifactStat.isFile() || artifactStat.size > MAX_RESUME_ARTIFACT_BYTES) {
      return null;
    }

    const sessionRootPath = sessionScopeRoot;
    const roleRootPath = resolve(sessionRootPath, normalizedArtifact.split('/')[0] ?? '');
    if (lstatSync(sessionRootPath).isSymbolicLink() || lstatSync(roleRootPath).isSymbolicLink()) {
      return null;
    }

    const roleSegment = normalizedArtifact.split('/')[0] ?? '';
    let allowedRootRealPath: string;
    if (roleSegment === 'rd') {
      const swarmRootPath = resolve(roleRootPath, 'swarm');
      if (lstatSync(swarmRootPath).isSymbolicLink()) {
        return null;
      }
      allowedRootRealPath = realpathSync(swarmRootPath);
    } else {
      allowedRootRealPath = realpathSync(roleRootPath);
    }

    const artifactRealPath = realpathSync(artifactPath);
    if (!isInsidePath(allowedRootRealPath, artifactWorkspaceRealPath) || !isInsidePath(artifactRealPath, allowedRootRealPath)) {
      return null;
    }

    const fd = openSync(artifactPath, 'r');
    try {
      const openedStat = fstatSync(fd);
      const currentStat = statSync(artifactPath);
      if (!openedStat.isFile() || openedStat.size > MAX_RESUME_ARTIFACT_BYTES || openedStat.dev !== artifactStat.dev || openedStat.ino !== artifactStat.ino || openedStat.dev !== currentStat.dev || openedStat.ino !== currentStat.ino) {
        return null;
      }
      return readFully(fd, openedStat.size);
    } finally {
      closeSync(fd);
    }
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }
}

type ResumeArtifactType = 'goal-package' | 'rd-plan' | 'checkpoint' | 'validation-report' | 'resume-instructions';

function getExpectedResumeArtifactType(artifact: string): ResumeArtifactType {
  if (artifact.endsWith('/autonomous-goal-package.json')) return 'goal-package';
  if (artifact.endsWith('/autonomous-rd-plan.json')) return 'rd-plan';
  if (artifact.endsWith('/checkpoint-1.json')) return 'checkpoint';
  if (artifact.endsWith('/validation-report.md')) return 'validation-report';
  return 'resume-instructions';
}

function hasStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && item.trim().length > 0);
}

function hasValidGoalPackageJson(parsed: Record<string, unknown>, goal: string): boolean {
  return parsed.goal === goal
    && typeof parsed.doneCondition === 'string'
    && parsed.doneCondition.trim().length > 0
    && typeof parsed.resumeCondition === 'string'
    && parsed.resumeCondition.trim().length > 0
    && hasStringArray(parsed.acceptanceCriteria);
}

function hasValidRdPlanJson(parsed: Record<string, unknown>): boolean {
  return parsed.workerQueueStatus === 'ready'
    && typeof parsed.taskCount === 'number'
    && Number.isInteger(parsed.taskCount)
    && parsed.taskCount > 0
    && parsed.reducerRequired === true;
}

function hasValidCheckpointJson(parsed: Record<string, unknown>): boolean {
  return parsed.checkpointId === 'checkpoint-1'
    && typeof parsed.createdAt === 'string'
    && parsed.createdAt.trim().length > 0
    && isObjectRecord(parsed.workerQueueState)
    && hasStringArray(parsed.validationRefs);
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(content);
    return isObjectRecord(parsed) ? parsed : null;
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }
}

function hasValidJsonMetadata(content: string, sessionId: string, artifactType: string, goal: string): boolean {
  const parsed = parseJsonObject(content);
  if (parsed === null || parsed.sessionId !== sessionId || parsed.artifactType !== artifactType || parsed.status !== 'ready') {
    return false;
  }

  if (artifactType === 'goal-package') return hasValidGoalPackageJson(parsed, goal);
  if (artifactType === 'rd-plan') return hasValidRdPlanJson(parsed);
  return artifactType === 'checkpoint' && hasValidCheckpointJson(parsed);
}

function parseFrontMatter(content: string): Record<string, string> | null {
  const lines = content.split(/\r?\n/);
  if (lines[0] !== '---') {
    return null;
  }

  const closingDelimiterIndex = lines.slice(1).findIndex((line) => line === '---');
  if (closingDelimiterIndex === -1) {
    return null;
  }

  const metadata = new Map<string, string>();
  for (const line of lines.slice(1, closingDelimiterIndex + 1)) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) {
      return null;
    }

    metadata.set(line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1).trim());
  }

  return Object.fromEntries(metadata);
}

function getMarkdownBody(content: string): string {
  const lines = content.split(/\r?\n/);
  const closingDelimiterIndex = lines.slice(1).findIndex((line) => line === '---');
  return closingDelimiterIndex === -1 ? '' : lines.slice(closingDelimiterIndex + 2).join('\n');
}

function hasValidationReportBody(body: string): boolean {
  return body.includes('Validation summary:')
    && body.includes('Checks:')
    && body.includes('Result: passed')
    && body.includes('Evidence refs:');
}

function hasResumeInstructionsBody(body: string): boolean {
  return body.includes('Resume steps:')
    && body.includes('Preconditions:')
    && body.includes('Blocked actions:')
    && body.includes('Next actions:');
}

function extractMarkdownListSection(body: string, heading: string): string[] {
  const lines = body.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line.trim() === heading);
  if (startIndex === -1) {
    return [];
  }

  const sectionLines = lines.slice(startIndex + 1);
  const nextHeadingIndex = sectionLines.findIndex((line) => /^[A-Z][A-Za-z ]+:$/.test(line.trim()));
  const sectionEndIndex = nextHeadingIndex + 1 || sectionLines.length;
  return sectionLines.slice(0, sectionEndIndex)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim())
    .filter((line) => line.length > 0);
}

function getCheckpointValidationRefs(checkpointContent: string): string[] {
  const parsed = parseJsonObject(checkpointContent);
  return parsed && hasStringArray(parsed.validationRefs) ? parsed.validationRefs : [];
}

function isSafeEvidenceRef(ref: string): boolean {
  return ref.toLowerCase() !== 'validation-report.md' && /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(ref) && !ref.includes('..');
}

function evidenceRefsExist(artifactWorkspacePath: string, sessionId: string, refs: readonly string[]): boolean {
  return refs.every((ref) => isSafeEvidenceRef(ref) && readResumeArtifact(artifactWorkspacePath, sessionId, `rd/swarm/evidence/${ref}`) !== null);
}

function hasMatchingEvidenceRefs(artifactWorkspacePath: string, sessionId: string, validationReportContent: string, checkpointContent: string): boolean {
  const expectedRefs = getCheckpointValidationRefs(checkpointContent);
  const actualRefs = extractMarkdownListSection(getMarkdownBody(validationReportContent), 'Evidence refs:');
  return expectedRefs.length > 0
    && expectedRefs.length === actualRefs.length
    && expectedRefs.every((expectedRef, index) => expectedRef === actualRefs[index])
    && evidenceRefsExist(artifactWorkspacePath, sessionId, expectedRefs);
}

function hasValidMarkdownMetadata(content: string, sessionId: string, artifactType: string): boolean {
  const metadata = parseFrontMatter(content);
  if (metadata === null || metadata.sessionId !== sessionId || metadata.artifactType !== artifactType || metadata.status !== 'passed') {
    return false;
  }

  const body = getMarkdownBody(content);
  return artifactType === 'validation-report' ? hasValidationReportBody(body) : hasResumeInstructionsBody(body);
}

function isValidResumeArtifact(artifact: string, content: string, sessionId: string, goal: string): boolean {
  if (!content.trim()) {
    return false;
  }

  const artifactType = getExpectedResumeArtifactType(artifact);
  return artifact.endsWith('.json')
    ? hasValidJsonMetadata(content, sessionId, artifactType, goal)
    : hasValidMarkdownMetadata(content, sessionId, artifactType);
}

function getResumeArtifactsStatus(artifactWorkspacePath: string, requiredArtifacts: readonly string[], sessionId: string, goal: string): ResumeArtifactsStatus {
  let hasInvalidArtifact = false;
  const artifactContents = new Map<string, string>();
  for (const artifact of requiredArtifacts) {
    // Slice 2026-06-29-change-id-root-removal: pass the explicit
    // sessionId so `readResumeArtifact` can route through `getSessionDir`
    // rather than guessing from path segments. The prefix-strip is now
    // a simple `/` + backslash normaliser since descriptors are
    // role-relative.
    const content = readResumeArtifact(artifactWorkspacePath, sessionId, normalizeRoleRelativePath(artifact, sessionId));
    if (content === null) {
      return 'missing';
    }

    artifactContents.set(artifact, content);
    if (!isValidResumeArtifact(artifact, content, sessionId, goal)) {
      hasInvalidArtifact = true;
    }
  }

  const checkpointContent = artifactContents.get('rd/swarm/checkpoints/checkpoint-1.json');
  const validationReportContent = artifactContents.get('rd/swarm/evidence/validation-report.md');
  if (!checkpointContent || !validationReportContent || !hasMatchingEvidenceRefs(artifactWorkspacePath, sessionId, validationReportContent, checkpointContent)) {
    hasInvalidArtifact = true;
  }

  return hasInvalidArtifact ? 'invalid' : 'ready';
}

export function createResumePlan(sessionId: string, ready: boolean): AutonomousResumePlan {
  const requiredArtifacts = getResumeRequiredArtifacts(sessionId);

  return {
    status: ready ? 'ready' : 'preview',
    checkpoints: ['goal-package-created', 'capabilities-planned', 'rd-swarm-planned', 'validation-evidence-required'],
    requiredArtifacts,
    resumeInstructions: ready
      ? 'Before continuing, verify checkpoint artifacts, pending worker queue state, and validation evidence requirements.'
      : 'Resolve blocked planning reasons before relying on autonomous resume state.'
  };
}

export { getResumeArtifactsStatus };
