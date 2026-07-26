/**
 * peaks-workflow — internal support helpers for pipeline verification.
 *
 * Private helpers used by the slimmed `pipeline-verify-service.ts`
 * orchestrator. NOT publicly re-exported; not part of the public API
 * surface. Kept in a sibling file so the orchestrator can stay under
 * the 400-line file-size cap (rid-006 split).
 *
 * File budget: ≤ 400 lines (rid-006 split).
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { RequestType } from '../artifacts/artifact-prerequisites.js';
import { showRequestArtifact } from '../artifacts/request-artifact-service.js';
import { resolveSecurityFindingsPath, resolvePerformanceFindingsPath } from './artifact-paths.js';
import type { PipelineGate } from './pipeline-verify-types.js';

export function extractState(markdown: string): string {
  for (const rawLine of markdown.split(/\r?\n/)) {
    const match = /^-\s*state:\s*(.+?)\s*$/.exec(rawLine.trim());
    if (match?.[1]) return match[1];
  }
  return 'unknown';
}

/**
 * As of slice 2026-06-05-change-id-as-unit-of-work, the file's durable
 * scope is the change-id (the `.peaks/_runtime/<sessionId>/` dir the file lives
 * in), NOT the session-id. We resolve the on-disk location via
 * `showRequestArtifact` (which scans all top-level dirs and returns the
 * actual dir the file was found in) instead of assuming
 * `.peaks/_runtime/<sessionId>/<role>/requests/`.
 */
export async function findRequestFile(projectRoot: string, role: string, rid: string): Promise<{ path: string; content: string; sessionId: string } | null> {
  const artifact = await showRequestArtifact({ projectRoot, role: role as 'prd' | 'ui' | 'rd' | 'qa' | 'sc', requestId: rid });
  if (artifact === null) return null;
  // Slice 2026-06-28-code-mode-bypass-fix (defect #3): the legacy
  // `showRequestArtifact` returns the FULL SCOPE (`_runtime/<sid>`)
  // as `sessionId`, not just the trailing id segment. The canonical
  // evidence lookup needs only the bare id (`.peaks/_runtime/change/<id>/`).
  // When the scope starts with `_runtime/`, strip that prefix so the
  // path resolver builds the right canonical location.
  let sessionId = artifact.sessionId;
  if (sessionId.startsWith('_runtime/') || sessionId.startsWith('_runtime\\')) {
    sessionId = sessionId.replace(/^_runtime[\\/]/, '');
  }
  return { path: artifact.path, content: artifact.content, sessionId };
}

export function rdGatesForType(requestType: RequestType): PipelineGate[] {
  const gates: PipelineGate[] = [
    { name: 'rd-request-exists', description: 'RD request artifact created', passed: false, detail: '' }
  ];

  if (requestType === 'feature' || requestType === 'refactor') {
    gates.push({ name: 'tech-doc', description: 'Technical design doc', passed: false, detail: '' });
  }
  if (requestType === 'bugfix') {
    gates.push({ name: 'bug-analysis', description: 'Bug root-cause analysis', passed: false, detail: '' });
  }
  if (requestType !== 'docs' && requestType !== 'chore' && requestType !== 'config') {
    gates.push({ name: 'code-review', description: 'Code review evidence', passed: false, detail: '' });
  }
  if (requestType === 'feature' || requestType === 'refactor' || requestType === 'bugfix' || requestType === 'config') {
    gates.push({ name: 'security-review', description: 'Security review evidence', passed: false, detail: '' });
  }

  return gates;
}

export function qaGatesForType(requestType: RequestType): PipelineGate[] {
  const gates: PipelineGate[] = [
    { name: 'qa-request-exists', description: 'QA request artifact created', passed: false, detail: '' }
  ];

  if (requestType === 'feature' || requestType === 'refactor' || requestType === 'bugfix') {
    gates.push({ name: 'test-cases', description: 'QA test cases', passed: false, detail: '' });
    gates.push({ name: 'test-report', description: 'QA test report with execution results', passed: false, detail: '' });
  }
  if (requestType === 'feature' || requestType === 'refactor' || requestType === 'bugfix' || requestType === 'config') {
    gates.push({ name: 'security-findings', description: 'QA security findings', passed: false, detail: '' });
  }
  if (requestType === 'feature' || requestType === 'refactor') {
    gates.push({ name: 'performance-findings', description: 'QA performance findings', passed: false, detail: '' });
  }

  return gates;
}

export const RD_QA_HANDOFF_STATES = new Set(['qa-handoff', 'handed-off', 'implemented']);
export const QA_COMPLETE_STATES = new Set(['verdict-issued']);

/** Tracker for canonical-path compliance (slice 2026-06-28-code-mode-bypass-fix). */
export interface CanonicalPathTracker {
  anyEvidenceResolved: boolean;
  allResolvedPathsCanonical: boolean;
}

/** Resolve RD evidence files (tech-doc / bug-analysis / code-review / security-review)
 *  by probing canonical + legacy paths for each gate. Mutates the gate.passed /
 *  gate.detail fields in place and pushes violations / nextActions. Returns the
 *  updated tracker. Verbatim-move from `pipeline-verify-service.ts`. */
export function resolveRdEvidencePaths(
  gates: PipelineGate[],
  rdEvidenceDir: string,
  projectRoot: string,
  violations: string[],
  nextActions: string[],
  tracker: CanonicalPathTracker
): CanonicalPathTracker {
  const RD_EVIDENCE_FILE: Record<string, string> = {
    'tech-doc': 'tech-doc.md',
    'bug-analysis': 'bug-analysis.md',
    'code-review': 'code-review.md',
    'security-review': 'security-review.md'
  };
  let anyEvidenceResolved = tracker.anyEvidenceResolved;
  let allResolvedPathsCanonical = tracker.allResolvedPathsCanonical;
  for (const gate of gates.slice(1)) {
    const fileName = RD_EVIDENCE_FILE[gate.name]!;
    const canonicalPath = join(projectRoot, '.peaks', '_runtime', rdEvidenceDir, 'rd', fileName);
    const legacyMisplacedPath = join(projectRoot, '.peaks', rdEvidenceDir, 'rd', fileName);
    const legacyChangeAxisPath = join(projectRoot, '.peaks', '_runtime', 'change', rdEvidenceDir, 'rd', fileName);
    let resolvedPath: string | null = null;
    let usedLegacy = false;
    for (const candidate of [canonicalPath, legacyMisplacedPath, legacyChangeAxisPath]) {
      if (existsSync(candidate)) {
        resolvedPath = candidate;
        usedLegacy = candidate !== canonicalPath;
        break;
      }
    }
    if (resolvedPath !== null) {
      anyEvidenceResolved = true;
      if (usedLegacy) allResolvedPathsCanonical = false;
      gate.passed = true;
      gate.detail = resolvedPath + (usedLegacy ? ' [DEPRECATION_LEGACY_PATH_USED]' : '');
      if (usedLegacy) {
        violations.push(`DEPRECATION_LEGACY_PATH_USED: ${resolvedPath} — move the file into .peaks/_runtime/${rdEvidenceDir}/rd/ (the canonical location) so subsequent runs resolve on the canonical path. The legacy \`peaks workspace migrate-change-scope\` helper was removed in v2.19.0; use \`peaks workspace migrate\` to relocate misplaced content.`);
      }
    } else {
      gate.detail = `missing: ${canonicalPath}`;
      violations.push(`RD evidence missing: ${gate.description} (${fileName})`);
      nextActions.push(`Create .peaks/_runtime/${rdEvidenceDir}/rd/${fileName}`);
    }
  }
  return { anyEvidenceResolved, allResolvedPathsCanonical };
}

/** Resolve QA evidence files (test-cases / test-report / security-findings /
 *  performance-findings) by probing canonical + legacy paths for each gate.
 *  For security/perf findings, delegates to the artifact-paths resolver.
 *  Mutates the gate.passed / gate.detail fields in place and pushes
 *  violations / nextActions. Returns the updated tracker. Verbatim-move
 *  from `pipeline-verify-service.ts`. */
export function resolveQaEvidencePaths(
  gates: PipelineGate[],
  projectRoot: string,
  rdEvidenceDir: string,
  changeIdForResolver: string,
  rid: string,
  violations: string[],
  nextActions: string[],
  tracker: CanonicalPathTracker
): CanonicalPathTracker {
  const QA_EVIDENCE_FILE: Record<string, string> = {
    'test-cases': `test-cases/${rid}.md`,
    'test-report': `test-reports/${rid}.md`,
    'security-findings': '',
    'performance-findings': ''
  };
  let anyEvidenceResolved = tracker.anyEvidenceResolved;
  let allResolvedPathsCanonical = tracker.allResolvedPathsCanonical;
  for (const gate of gates.slice(1)) {
    if (gate.name === 'security-findings' || gate.name === 'performance-findings') {
      const resolver = gate.name === 'security-findings' ? resolveSecurityFindingsPath : resolvePerformanceFindingsPath;
      const resolved = resolver({ projectRoot, sessionId: changeIdForResolver, rid });
      if (existsSync(resolved.path)) {
        anyEvidenceResolved = true;
        if (resolved.form === 'legacy') allResolvedPathsCanonical = false;
        gate.passed = true;
        gate.detail = resolved.path;
        if (resolved.form === 'legacy') {
          violations.push(`QA evidence accepted in legacy form (will be rejected after next minor release): ${resolved.path} — re-run peaks workflow plan refresh to migrate`);
        }
      } else {
        gate.detail = `missing: ${resolved.path}`;
        violations.push(`QA evidence missing: ${gate.description} (${resolved.path})`);
        nextActions.push(`Create ${resolved.path} (or use the legacy non-suffixed form during the 1-minor-release back-compat window)`);
      }
      continue;
    }
    const fileName = QA_EVIDENCE_FILE[gate.name]!;
    const canonicalQaPath = join(projectRoot, '.peaks', '_runtime', rdEvidenceDir, 'qa', fileName);
    const legacyMisplacedQaPath = join(projectRoot, '.peaks', rdEvidenceDir, 'qa', fileName);
    const legacyChangeAxisQaPath = join(projectRoot, '.peaks', '_runtime', 'change', rdEvidenceDir, 'qa', fileName);
    let resolvedQaPath: string | null = null;
    let usedLegacyQa = false;
    for (const candidate of [canonicalQaPath, legacyMisplacedQaPath, legacyChangeAxisQaPath]) {
      if (existsSync(candidate)) {
        resolvedQaPath = candidate;
        usedLegacyQa = candidate !== canonicalQaPath;
        break;
      }
    }
    if (resolvedQaPath !== null) {
      anyEvidenceResolved = true;
      if (usedLegacyQa) allResolvedPathsCanonical = false;
      gate.passed = true;
      gate.detail = resolvedQaPath + (usedLegacyQa ? ' [DEPRECATION_LEGACY_PATH_USED]' : '');
      if (usedLegacyQa) {
        violations.push(`DEPRECATION_LEGACY_PATH_USED: ${resolvedQaPath} — move the file into .peaks/_runtime/${rdEvidenceDir}/qa/ (the canonical location) so subsequent runs resolve on the canonical path. The legacy \`peaks workspace migrate-change-scope\` helper was removed in v2.19.0; use \`peaks workspace migrate\` to relocate misplaced content.`);
      }
    } else {
      gate.detail = `missing: ${canonicalQaPath}`;
      violations.push(`QA evidence missing: ${gate.description} (${fileName})`);
      nextActions.push(`Create .peaks/_runtime/${rdEvidenceDir}/qa/${fileName}`);
    }
  }
  return { anyEvidenceResolved, allResolvedPathsCanonical };
}