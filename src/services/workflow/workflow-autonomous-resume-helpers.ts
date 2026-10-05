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
 * unchanged (verbatim move). The pure JSON / frontmatter content
 * validators now live in the sibling
 * `workflow-autonomous-resume-validation.ts` (B wave-3 file-size split).
 */

import {
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  statSync
} from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
// was removed with the change-id axis. The artifact under each
// resume helper now resolves the absolute path via the session-axis
// `getSessionDir` + an explicit role-relative segment; the
// `.peaks/_runtime/<sessionId>/<role>/...` string is no longer
// pre-built.
import { getSessionDir } from '../session/getSessionDir.js';
import type { AutonomousResumePlan } from './workflow-autonomous-types.js';
import { normalizePath } from '../../shared/path-utils.js';
import {
  extractMarkdownListSection,
  getCheckpointValidationRefs,
  getMarkdownBody,
  isValidResumeArtifact
} from './workflow-autonomous-resume-validation.js';

const MAX_RESUME_ARTIFACT_BYTES = 256_000;

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
  // returns role-relative sub-paths (e.g.
  // `rd/swarm/checkpoints/checkpoint-1.json`). The helper normalises
  // the path separators and strips any leading `/`; the `sessionId`
  // argument is preserved on the signature for backward call-site
  // compatibility but is no longer embedded in the path.
  return normalizePath(artifact).replace(/^\/+/, '');
}

function readResumeArtifact(
  artifactWorkspacePath: string,
  sessionId: string,
  artifact: string
): string | null {
  // the session-axis `getSessionDir(root, sessionId)`. The role/swarm
  // sub-path (e.g. `rd/swarm/checkpoints/checkpoint-1.json`) is
  // strictly a sub-root drill, not a top-level dir derivation.
  const sessionScopeRoot = getSessionDir(artifactWorkspacePath, sessionId);
  const normalizedArtifact = normalizePath(artifact).replace(/^\/+/, '');
  const artifactPath = resolve(sessionScopeRoot, normalizedArtifact);
  try {
    const artifactWorkspaceRealPath = realpathSync(artifactWorkspacePath);
    const artifactStat = lstatSync(artifactPath);
    if (
      artifactStat.isSymbolicLink() ||
      !artifactStat.isFile() ||
      artifactStat.size > MAX_RESUME_ARTIFACT_BYTES
    ) {
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
    if (
      !isInsidePath(allowedRootRealPath, artifactWorkspaceRealPath) ||
      !isInsidePath(artifactRealPath, allowedRootRealPath)
    ) {
      return null;
    }

    const fd = openSync(artifactPath, 'r');
    try {
      const openedStat = fstatSync(fd);
      const currentStat = statSync(artifactPath);
      if (
        !openedStat.isFile() ||
        openedStat.size > MAX_RESUME_ARTIFACT_BYTES ||
        openedStat.dev !== artifactStat.dev ||
        openedStat.ino !== artifactStat.ino ||
        openedStat.dev !== currentStat.dev ||
        openedStat.ino !== currentStat.ino
      ) {
        return null;
      }
      return readFully(fd, openedStat.size);
    } finally {
      closeSync(fd);
    }
  } catch {
    // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }
}

function isSafeEvidenceRef(ref: string): boolean {
  return (
    ref.toLowerCase() !== 'validation-report.md' &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(ref) &&
    !ref.includes('..')
  );
}

function evidenceRefsExist(
  artifactWorkspacePath: string,
  sessionId: string,
  refs: readonly string[]
): boolean {
  return refs.every(
    (ref) =>
      isSafeEvidenceRef(ref) &&
      readResumeArtifact(artifactWorkspacePath, sessionId, `rd/swarm/evidence/${ref}`) !== null
  );
}

function hasMatchingEvidenceRefs(
  artifactWorkspacePath: string,
  sessionId: string,
  validationReportContent: string,
  checkpointContent: string
): boolean {
  const expectedRefs = getCheckpointValidationRefs(checkpointContent);
  const actualRefs = extractMarkdownListSection(
    getMarkdownBody(validationReportContent),
    'Evidence refs:'
  );
  return (
    expectedRefs.length > 0 &&
    expectedRefs.length === actualRefs.length &&
    expectedRefs.every((expectedRef, index) => expectedRef === actualRefs[index]) &&
    evidenceRefsExist(artifactWorkspacePath, sessionId, expectedRefs)
  );
}

function getResumeArtifactsStatus(
  artifactWorkspacePath: string,
  requiredArtifacts: readonly string[],
  sessionId: string,
  goal: string
): ResumeArtifactsStatus {
  let hasInvalidArtifact = false;
  const artifactContents = new Map<string, string>();
  for (const artifact of requiredArtifacts) {
    // sessionId so `readResumeArtifact` can route through `getSessionDir`
    // rather than guessing from path segments. The prefix-strip is now
    // a simple `/` + backslash normaliser since descriptors are
    // role-relative.
    const content = readResumeArtifact(
      artifactWorkspacePath,
      sessionId,
      normalizeRoleRelativePath(artifact, sessionId)
    );
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
  if (
    !checkpointContent ||
    !validationReportContent ||
    !hasMatchingEvidenceRefs(
      artifactWorkspacePath,
      sessionId,
      validationReportContent,
      checkpointContent
    )
  ) {
    hasInvalidArtifact = true;
  }

  return hasInvalidArtifact ? 'invalid' : 'ready';
}

export function createResumePlan(sessionId: string, ready: boolean): AutonomousResumePlan {
  const requiredArtifacts = getResumeRequiredArtifacts(sessionId);

  return {
    status: ready ? 'ready' : 'preview',
    checkpoints: [
      'goal-package-created',
      'capabilities-planned',
      'rd-swarm-planned',
      'validation-evidence-required'
    ],
    requiredArtifacts,
    resumeInstructions: ready
      ? 'Before continuing, verify checkpoint artifacts, pending worker queue state, and validation evidence requirements.'
      : 'Resolve blocked planning reasons before relying on autonomous resume state.'
  };
}

export { getResumeArtifactsStatus };
