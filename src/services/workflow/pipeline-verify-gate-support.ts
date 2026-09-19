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

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getPrerequisitesFor,
  prerequisiteBodyViolations,
  type ArtifactPrerequisite,
  type RequestType
} from '../artifacts/artifact-prerequisites.js';
import type {
  RequestArtifactRole,
  RequestArtifactState
} from '../artifacts/request-artifact-service.js';
import { showRequestArtifact } from '../artifacts/request-artifact-service.js';
import { readArtifactState } from '../artifacts/request-artifact-state-helpers.js';
import type { PipelineGate } from './pipeline-verify-types.js';

export function extractState(markdown: string): string {
  return readArtifactState(markdown) ?? 'unknown';
}

/**
 * As of slice 2026-06-05-change-id-as-unit-of-work, the file's durable
 * scope is the change-id (the `.peaks/_runtime/<sessionId>/` dir the file lives
 * in), NOT the session-id. We resolve the on-disk location via
 * `showRequestArtifact` (which scans all top-level dirs and returns the
 * actual dir the file was found in) instead of assuming
 * `.peaks/_runtime/<sessionId>/<role>/requests/`.
 */
export async function findRequestFile(
  projectRoot: string,
  role: string,
  rid: string
): Promise<{ path: string; content: string; sessionId: string } | null> {
  const artifact = await showRequestArtifact({
    projectRoot,
    role: role as 'prd' | 'ui' | 'rd' | 'qa' | 'sc',
    requestId: rid
  });
  if (artifact === null) return null;
  // Slice 2026-06-28-code-mode-bypass-fix (defect #3) used to strip a
  // `_runtime/` prefix here, because `showRequestArtifact` then returned the
  // FULL SCOPE (`_runtime/<sid>`) as `sessionId`. Repair R5 removed that
  // round-trip at its source: `readSummary` now builds the summary from the
  // already-resolved directory and the bare id, so `sessionId` is the bare id
  // and the prefix strip could never fire. It was removed by repair R7 rather
  // than left in place as dead code with a comment asserting a behaviour its
  // callee no longer has — an artifact claiming something the code does not do
  // is the defect class this line of work exists to remove.
  return { path: artifact.path, content: artifact.content, sessionId: artifact.sessionId };
}

/**
 * Where the CURRENT contract puts one gate's evidence.
 *
 * The contract is the `artifact-prerequisites.ts` table — the table
 * `peaks request transition` enforces and the one the peaks-qa prose
 * contract mirrors (`skills/bee/peaks-qa/references/qa-transition-gates.md`).
 * `probeName` is the location this checker probes today. The contract's
 * `relativePath` is returned first, then its accepted historical locations in
 * the table's own declared order — `legacyRelativePath`, then
 * `legacyRelativePaths` (the same composition `artifact-prerequisites.ts`' own
 * resolver performs, so a hit here and a hit there land on the same file).
 *
 * Returns `null` when the contract carries no prerequisite for that name at
 * all — the artifact was retired and no gate may fail on it.
 *
 * This lookup exists because hard-coding the paths here is what let
 * `verify-pipeline` fall a minor release behind the gate: it kept demanding
 * `rd/security-review.md` as mandatory after the table had demoted that file
 * to a `legacyRelativePath` fallback of `audit/security.md`, and it kept
 * demanding `qa/security-findings-<rid>.md` / `qa/performance-findings-<rid>.md`
 * after the v2.11.0 D1/D4 trim dropped them from `qa:verdict-issued`
 * altogether (rid 2026-09-14-verify-pipeline-contract-drift).
 */
/**
 * The prerequisite the contract carries for `probeName`, or null when it
 * carries none. `contractEvidencePaths` is this object's path projection; the
 * BODY contract (`mustContain` / `mustContainAny` / `headingMustContain`) rides
 * on the same object, which is why `contractBodyViolations` below consults it
 * instead of probing for the file's existence alone.
 */
export function contractPrerequisite(
  role: RequestArtifactRole,
  state: RequestArtifactState,
  requestType: RequestType,
  probeName: string
): ArtifactPrerequisite | null {
  for (const prereq of getPrerequisitesFor(role, state, requestType)) {
    const legacyPaths = [
      ...(prereq.legacyRelativePath !== undefined ? [prereq.legacyRelativePath] : []),
      ...(prereq.legacyRelativePaths ?? [])
    ];
    if (prereq.relativePath !== probeName && !legacyPaths.includes(probeName)) continue;
    return prereq;
  }
  return null;
}

export function contractEvidencePaths(
  role: RequestArtifactRole,
  state: RequestArtifactState,
  requestType: RequestType,
  probeName: string
): string[] | null {
  const prereq = contractPrerequisite(role, state, requestType, probeName);
  if (prereq === null) return null;
  const legacyPaths = [
    ...(prereq.legacyRelativePath !== undefined ? [prereq.legacyRelativePath] : []),
    ...(prereq.legacyRelativePaths ?? [])
  ];
  return [prereq.relativePath, ...legacyPaths.filter((legacy) => legacy !== prereq.relativePath)];
}

/**
 * The contract's BODY checks for the prerequisite named by `probeName`, applied
 * to the file that resolved. Empty when the name matches nothing in the table or
 * the table pins no body markers for it.
 *
 * `existsSync` alone made this checker laxer than the contract it claims to
 * derive from: it reported `prd-handoff passed = true` for a handoff carrying
 * `schemaVersion: 1` and no `sha256:` line — the exact file
 * `AUDIT_REQUIRES_HANDOFF` refuses at `rd:qa-handoff`. Deriving the *path* from
 * the table while dropping the table's *body* contract is the drift this module
 * exists to remove, so the check goes through the table's own implementation
 * (`prerequisiteBodyViolations`) rather than a second copy of the markers.
 */
function contractBodyViolations(
  role: RequestArtifactRole,
  state: RequestArtifactState,
  requestType: RequestType,
  probeName: string,
  absolutePath: string
): string[] {
  const prerequisite = contractPrerequisite(role, state, requestType, probeName);
  if (prerequisite === null) return [];
  return prerequisiteBodyViolations(prerequisite, readFileSync(absolutePath, 'utf8'));
}

export function rdGatesForType(requestType: RequestType): PipelineGate[] {
  const gates: PipelineGate[] = [
    {
      name: 'rd-request-exists',
      description: 'RD request artifact created',
      passed: false,
      detail: ''
    }
  ];

  // This slot used to pin a `tech-doc` gate to `rd/tech-doc.md`, an artifact
  // v2.11.0 Group A retired and the table no longer carries — so the gate
  // failed trees `peaks request transition` accepts (QA repair cycle 1). The
  // design / scope record the contract DOES name at `rd:qa-handoff` is
  // `prd/handoff.md`, so that is the gate: table-derived, like the others.
  // (`rd/tech-doc.md` still has two non-gate readers — final-review's evidence
  // budget and the resume detector. Neither is served by failing a compliant
  // slice.)
  if (contractEvidencePaths('rd', 'qa-handoff', requestType, 'prd/handoff.md') !== null) {
    gates.push({
      name: 'prd-handoff',
      description: 'PRD handoff capsule (approved scope + non-goals)',
      passed: false,
      detail: ''
    });
  }
  if (requestType === 'bugfix') {
    gates.push({
      name: 'bug-analysis',
      description: 'Bug root-cause analysis',
      passed: false,
      detail: ''
    });
  }
  if (requestType !== 'docs' && requestType !== 'chore' && requestType !== 'config') {
    gates.push({
      name: 'code-review',
      description: 'Code review evidence',
      passed: false,
      detail: ''
    });
  }
  if (
    requestType === 'feature' ||
    requestType === 'refactor' ||
    requestType === 'bugfix' ||
    requestType === 'config'
  ) {
    gates.push({
      name: 'security-review',
      description: 'Security review evidence',
      passed: false,
      detail: ''
    });
  }
  // The perf evidence the contract requires at `rd:qa-handoff` is `AUDIT_PERF`
  // — `audit/perf-<rid>.md`, with `audit/perf.md` and `rd/perf-baseline.md` as
  // its two declared legacy tiers (rid-scoped since slice
  // `2026-09-14-audit-artifact-rid-scoping`). This gate used to live on the QA
  // side as `performance-findings`, checking `qa/performance-findings-<rid>.md`
  // — a path the v2.11.0 D1/D4 trim dropped. Relocating the gate (rather than
  // deleting it) is what keeps AC3's control meaningful: perf evidence that is
  // genuinely absent must still fail.
  if (contractEvidencePaths('rd', 'qa-handoff', requestType, 'rd/perf-baseline.md') !== null) {
    gates.push({
      name: 'perf-baseline',
      description: 'Performance audit evidence',
      passed: false,
      detail: ''
    });
  }

  return gates;
}

export function qaGatesForType(requestType: RequestType): PipelineGate[] {
  const gates: PipelineGate[] = [
    {
      name: 'qa-request-exists',
      description: 'QA request artifact created',
      passed: false,
      detail: ''
    }
  ];

  if (requestType === 'feature' || requestType === 'refactor' || requestType === 'bugfix') {
    gates.push({ name: 'test-cases', description: 'QA test cases', passed: false, detail: '' });
    gates.push({
      name: 'test-report',
      description: 'QA test report with execution results',
      passed: false,
      detail: ''
    });
  }

  // The `security-findings` / `performance-findings` gates were removed here
  // (rid 2026-09-14-verify-pipeline-contract-drift). peaks-qa does not own
  // security review or performance review — `peaks-qa/SKILL.md` says so, and
  // the v2.11.0 D1/D4 trim dropped both from every `qa:verdict-issued` table.
  // The evidence they used to demand is now checked on the RD side, at the
  // paths the contract actually names (`audit/security-<rid>.md`,
  // `audit/perf-<rid>.md`; rid-scoped since slice
  // `2026-09-14-audit-artifact-rid-scoping`, with `audit/security.md` /
  // `audit/perf.md` and `rd/security-review.md` / `rd/perf-baseline.md` as the
  // declared legacy tiers behind them).

  return gates;
}

export const RD_QA_HANDOFF_STATES = new Set(['qa-handoff', 'handed-off', 'implemented']);
export const QA_COMPLETE_STATES = new Set(['verdict-issued']);

/** Tracker for canonical-path compliance (slice 2026-06-28-code-mode-bypass-fix). */
export interface CanonicalPathTracker {
  anyEvidenceResolved: boolean;
  allResolvedPathsCanonical: boolean;
}

/** Resolve RD evidence files (prd-handoff / bug-analysis / code-review / security-review / perf-baseline)
 *  by probing canonical + legacy paths for each gate. Mutates the gate.passed /
 *  gate.detail fields in place and pushes violations / nextActions. Returns the
 *  updated tracker. Verbatim-move from `pipeline-verify-service.ts`. */
export function resolveRdEvidencePaths(
  gates: PipelineGate[],
  rdEvidenceDir: string,
  projectRoot: string,
  rid: string,
  requestType: RequestType,
  violations: string[],
  nextActions: string[],
  tracker: CanonicalPathTracker
): CanonicalPathTracker {
  // The path each gate is about. The contract is consulted first — see
  // `contractEvidencePaths`; `rdGatesForType` only builds a gate when the
  // contract carries its prerequisite, so this is the name the gate stands
  // for, not a second path table.
  const RD_EVIDENCE_PROBE: Record<string, string> = {
    'prd-handoff': 'prd/handoff.md',
    'bug-analysis': 'rd/bug-analysis.md',
    'code-review': 'rd/code-review.md',
    'security-review': 'rd/security-review.md',
    'perf-baseline': 'rd/perf-baseline.md'
  };
  let anyEvidenceResolved = tracker.anyEvidenceResolved;
  let allResolvedPathsCanonical = tracker.allResolvedPathsCanonical;
  for (const gate of gates.slice(1)) {
    const probeName = RD_EVIDENCE_PROBE[gate.name]!;
    const relativePaths = (
      contractEvidencePaths('rd', 'qa-handoff', requestType, probeName) ?? [probeName]
    ).map((relative) => relative.replace('<rid>', rid));
    const primaryRelativePath = relativePaths[0]!;
    const canonicalPath = join(
      projectRoot,
      '.peaks',
      '_runtime',
      rdEvidenceDir,
      primaryRelativePath
    );
    // Two independent axes, kept apart because they mean different things:
    //   - `legacyRoot` — the file sits under a pre-F3 session home
    //     (`.peaks/<sid>/…` or `.peaks/_runtime/change/<sid>/…`). That is a
    //     misplaced write, and it is the DEPRECATION violation's subject.
    //   - `legacyForm` — the file sits under one of the contract's declared
    //     `legacyRelativePaths`. The contract accepts those on purpose ("a
    //     legacy hit must keep the gate open, or existing sessions would fail
    //     the transition on upgrade"), so this is reported through
    //     `acceptedForm` and is *not* a violation.
    const candidates: Array<{ path: string; legacyRoot: boolean; legacyForm: boolean }> = [];
    for (const relative of relativePaths) {
      const legacyForm = relative !== primaryRelativePath;
      for (const [root, legacyRoot] of [
        [join(projectRoot, '.peaks', '_runtime', rdEvidenceDir), false],
        [join(projectRoot, '.peaks', rdEvidenceDir), true],
        [join(projectRoot, '.peaks', '_runtime', 'change', rdEvidenceDir), true]
      ] as Array<[string, boolean]>) {
        candidates.push({ path: join(root, relative), legacyRoot, legacyForm });
      }
    }
    const hit = candidates.find((candidate) => existsSync(candidate.path));
    if (hit !== undefined) {
      anyEvidenceResolved = true;
      if (hit.legacyRoot) allResolvedPathsCanonical = false;
      // Existing is not the contract — the file must also satisfy the body
      // markers the table pins for this prereq (see `contractBodyViolations`).
      const bodyViolations = contractBodyViolations(
        'rd',
        'qa-handoff',
        requestType,
        probeName,
        hit.path
      );
      if (bodyViolations.length > 0) {
        gate.passed = false;
        gate.detail = `${hit.path} — ${bodyViolations.join('; ')}`;
        violations.push(
          `RD evidence does not satisfy the contract: ${gate.description} (${primaryRelativePath}) — ${bodyViolations.join('; ')}`
        );
        nextActions.push(
          `Fix .peaks/_runtime/${rdEvidenceDir}/${primaryRelativePath} to satisfy the contract: ${bodyViolations.join('; ')}`
        );
      } else {
        gate.passed = true;
        gate.detail =
          hit.path +
          (hit.legacyRoot ? ' [DEPRECATION_LEGACY_PATH_USED]' : '') +
          (hit.legacyForm ? ' [LEGACY_EVIDENCE_PATH]' : '');
      }
      if (hit.legacyRoot) {
        violations.push(
          `DEPRECATION_LEGACY_PATH_USED: ${hit.path} — move the file into .peaks/_runtime/${rdEvidenceDir}/${primaryRelativePath} (the canonical location) so subsequent runs resolve on the canonical path. The legacy \`peaks workspace migrate-change-scope\` helper was removed in v2.19.0; use \`peaks workspace migrate\` to relocate misplaced content.`
        );
      }
    } else {
      gate.detail = `missing: ${canonicalPath}`;
      violations.push(`RD evidence missing: ${gate.description} (${primaryRelativePath})`);
      nextActions.push(`Create .peaks/_runtime/${rdEvidenceDir}/${primaryRelativePath}`);
    }
  }
  return { anyEvidenceResolved, allResolvedPathsCanonical };
}

/** Resolve QA evidence files (test-cases / test-report) by probing canonical
 *  + legacy paths for each gate. Mutates the gate.passed / gate.detail fields
 *  in place and pushes violations / nextActions. Returns the updated tracker.
 *  Verbatim-move from `pipeline-verify-service.ts`.
 *
 *  The `security-findings` / `performance-findings` branches that used to live
 *  here are gone: those artifacts are not in any `qa:verdict-issued` table
 *  (v2.11.0 D1/D4), and the evidence they stood for is resolved on the RD side
 *  at the contract's own paths (`audit/security-<rid>.md`,
 *  `audit/perf-<rid>.md`). */
export function resolveQaEvidencePaths(
  gates: PipelineGate[],
  projectRoot: string,
  rdEvidenceDir: string,
  requestType: RequestType,
  rid: string,
  violations: string[],
  nextActions: string[],
  tracker: CanonicalPathTracker
): CanonicalPathTracker {
  const QA_EVIDENCE_PROBE: Record<string, string> = {
    'test-cases': 'qa/test-cases/<rid>.md',
    'test-report': 'qa/test-reports/<rid>.md'
  };
  let anyEvidenceResolved = tracker.anyEvidenceResolved;
  let allResolvedPathsCanonical = tracker.allResolvedPathsCanonical;
  for (const gate of gates.slice(1)) {
    const probeName = QA_EVIDENCE_PROBE[gate.name]!;
    const relativePaths = (
      contractEvidencePaths('qa', 'verdict-issued', requestType, probeName) ?? [probeName]
    ).map((relative) => relative.replace('<rid>', rid));
    const primaryRelativePath = relativePaths[0]!;
    const canonicalQaPath = join(
      projectRoot,
      '.peaks',
      '_runtime',
      rdEvidenceDir,
      primaryRelativePath
    );
    const candidates: Array<{ path: string; legacyRoot: boolean }> = [];
    for (const relative of relativePaths) {
      for (const [root, legacyRoot] of [
        [join(projectRoot, '.peaks', '_runtime', rdEvidenceDir), false],
        [join(projectRoot, '.peaks', rdEvidenceDir), true],
        [join(projectRoot, '.peaks', '_runtime', 'change', rdEvidenceDir), true]
      ] as Array<[string, boolean]>) {
        candidates.push({ path: join(root, relative), legacyRoot });
      }
    }
    const hit = candidates.find((candidate) => existsSync(candidate.path));
    if (hit !== undefined) {
      anyEvidenceResolved = true;
      if (hit.legacyRoot) allResolvedPathsCanonical = false;
      // Same contract check as the RD side: the `test-report` / `test-cases`
      // prereqs pin `## Test execution` / `## Test cases` / `test(`, and a
      // checker that only probed existence reported green on files the
      // `qa:verdict-issued` gate rejects.
      const bodyViolations = contractBodyViolations(
        'qa',
        'verdict-issued',
        requestType,
        probeName,
        hit.path
      );
      if (bodyViolations.length > 0) {
        gate.passed = false;
        gate.detail = `${hit.path} — ${bodyViolations.join('; ')}`;
        violations.push(
          `QA evidence does not satisfy the contract: ${gate.description} (${primaryRelativePath}) — ${bodyViolations.join('; ')}`
        );
        nextActions.push(
          `Fix .peaks/_runtime/${rdEvidenceDir}/${primaryRelativePath} to satisfy the contract: ${bodyViolations.join('; ')}`
        );
      } else {
        gate.passed = true;
        gate.detail = hit.path + (hit.legacyRoot ? ' [DEPRECATION_LEGACY_PATH_USED]' : '');
      }
      if (hit.legacyRoot) {
        violations.push(
          `DEPRECATION_LEGACY_PATH_USED: ${hit.path} — move the file into .peaks/_runtime/${rdEvidenceDir}/${primaryRelativePath} (the canonical location) so subsequent runs resolve on the canonical path. The legacy \`peaks workspace migrate-change-scope\` helper was removed in v2.19.0; use \`peaks workspace migrate\` to relocate misplaced content.`
        );
      }
    } else {
      gate.detail = `missing: ${canonicalQaPath}`;
      violations.push(`QA evidence missing: ${gate.description} (${primaryRelativePath})`);
      nextActions.push(`Create .peaks/_runtime/${rdEvidenceDir}/${primaryRelativePath}`);
    }
  }
  return { anyEvidenceResolved, allResolvedPathsCanonical };
}
