import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { RequestType } from '../artifacts/artifact-prerequisites.js';
import { isRequestType } from '../artifacts/artifact-prerequisites.js';
import { showRequestArtifact } from '../artifacts/request-artifact-service.js';
import { resolveSecurityFindingsPath, resolvePerformanceFindingsPath } from './artifact-paths.js';
import { readSkipState } from './workflow-state-store.js';

export type PipelineGate = {
  name: string;
  description: string;
  passed: boolean;
  detail: string;
  /**
   * Slice 2026-06-13-peaks-workflow-skip: optional status that
   * distinguishes a gate that was BYPASSED via `peaks workflow skip`
   * from one that actually passed evaluation. When set, the gate
   * was NOT evaluated by `evaluateGate` — the user/CLI explicitly
   * marked it as skipped. The boolean `passed` is set to `true` so
   * existing consumers (which only check `passed`) treat a skipped
   * gate as "satisfied", but downstream consumers that need
   * audit-grade distinction (e.g. CI badges, dashboards) can read
   * `status` to tell pass / fail / skipped apart.
   *
   *   - omitted (default): not set, gate was evaluated; treat as legacy.
   *   - 'pass':          gate evaluated and passed.
   *   - 'fail':          gate evaluated and failed.
   *   - 'skipped':       gate was bypassed; never evaluated.
   */
  status?: 'pass' | 'fail' | 'skipped';
};

export type PipelineVerification = {
  rid: string;
  changeId: string;
  requestType: RequestType;
  complete: boolean;
  rdPhase: {
    invoked: boolean;
    state: string;
    gates: PipelineGate[];
  };
  qaPhase: {
    invoked: boolean;
    state: string;
    gates: PipelineGate[];
  };
  violations: string[];
  nextActions: string[];
  /** Form of the security/performance findings artifacts Gate C accepted
   * (slice 025). `'suffixed'` for the new per-rid form, `'legacy'` for the
   * pre-slice-025 non-suffixed form, `'none'` when neither was found. */
  acceptedForm?: 'suffixed' | 'legacy' | 'none';
  /** `gateC` is the pre-computed verdict string (AC7 dogfood shape). */
  gateC?: 'pass' | 'fail';
};

function extractState(markdown: string): string {
  for (const rawLine of markdown.split(/\r?\n/)) {
    const match = /^-\s*state:\s*(.+?)\s*$/.exec(rawLine.trim());
    if (match?.[1]) return match[1];
  }
  return 'unknown';
}

/**
 * As of slice 2026-06-05-change-id-as-unit-of-work, the file's durable
 * scope is the change-id (the `.peaks/<changeId>/` dir the file lives
 * in), NOT the session-id. We resolve the on-disk location via
 * `showRequestArtifact` (which scans all top-level dirs and returns the
 * actual dir the file was found in) instead of assuming
 * `.peaks/<sessionId>/<role>/requests/`.
 */
async function findRequestFile(projectRoot: string, role: string, rid: string): Promise<{ path: string; content: string; changeId: string } | null> {
  const artifact = await showRequestArtifact({ projectRoot, role: role as 'prd' | 'ui' | 'rd' | 'qa' | 'sc', requestId: rid });
  if (artifact === null) return null;
  return { path: artifact.path, content: artifact.content, changeId: artifact.changeId };
}

function rdGatesForType(requestType: RequestType): PipelineGate[] {
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

function qaGatesForType(requestType: RequestType): PipelineGate[] {
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

const RD_QA_HANDOFF_STATES = new Set(['qa-handoff', 'handed-off', 'implemented']);
const QA_COMPLETE_STATES = new Set(['verdict-issued']);

export async function verifyPipeline(options: {
  projectRoot: string;
  rid: string;
  /** Optional explicit change-id; when omitted, the RD/QA on-disk location
   * is resolved via showRequestArtifact (which scans all top-level dirs and
   * returns the actual change-id the file lives in). */
  changeId?: string;
  requestType?: string;
  /**
   * Slice 2026-06-13-peaks-workflow-skip: the session id under which
   * `peaks workflow skip` may have written a state file. When set,
   * `verifyPipeline` reads `.peaks/_runtime/<sessionId>/workflow-state/<rid>.json`
   * and marks matching gates as `status: 'skipped'` (bypassed). When
   * omitted, no skip state is consulted (preserves the legacy v0
   * behavior). The change-id hint and the on-disk resolved change-id
   * are NOT used for the state-file lookup — only the explicit
   * `sessionId` parameter is.
   */
  sessionId?: string;
}): Promise<PipelineVerification> {
  const requestType = isRequestType(options.requestType ?? '') ? options.requestType as RequestType : 'feature';
  const violations: string[] = [];
  const nextActions: string[] = [];

  const rdGates = rdGatesForType(requestType);
  const qaGates = qaGatesForType(requestType);

  // Slice 2026-06-13-peaks-workflow-skip: read the skip-state (if any)
  // and pre-mark matching gates as `status: 'skipped'`. We do this
  // BEFORE evaluating evidence files, so a skipped gate never
  // emits a "missing evidence" violation. The boolean `passed` is
  // set to `true` so legacy consumers (which only check `passed`)
  // treat skipped gates as satisfied; the new `status` field
  // distinguishes the bypass from an actual pass.
  const skippedGateNames = new Set<string>();
  if (options.sessionId !== undefined) {
    const skipState = readSkipState(options.projectRoot, options.sessionId, options.rid);
    if (skipState !== null) {
      for (const gateName of skipState.skippedGates) {
        if (gateName === 'QA' || gateName === 'qa-phase' || gateName === 'qa') {
          for (const g of qaGates) skippedGateNames.add(g.name);
        } else if (gateName === 'RD' || gateName === 'rd-phase' || gateName === 'rd') {
          for (const g of rdGates) skippedGateNames.add(g.name);
        } else {
          skippedGateNames.add(gateName);
        }
      }
      nextActions.push(
        `Skipped gates (via peaks workflow skip): [${skipState.skippedGates.join(', ')}] — reason: ${skipState.skipReason}`
      );
    }
  }
  function markIfSkipped(gate: PipelineGate): void {
    if (skippedGateNames.has(gate.name)) {
      gate.status = 'skipped';
      gate.passed = true;
      gate.detail = 'skipped via peaks workflow skip';
    }
  }

  // Resolve RD + QA on-disk locations via showRequestArtifact (the change-id
  // is whatever dir the file actually lives in, not the caller's session-id).
  const rdFile = await findRequestFile(options.projectRoot, 'rd', options.rid);
  let rdInvoked = false;
  let rdState = 'missing';
  // The resolved change-id is the on-disk location the file actually
  // lives in. The caller's `options.changeId` is a hint used for
  // path construction (nextActions strings), NOT for the resolved
  // changeId field — the on-disk location is the source of truth.
  let resolvedChangeId = '';

  if (rdFile) {
    rdInvoked = true;
    rdState = extractState(rdFile.content);
    rdGates[0]!.passed = true;
    rdGates[0]!.detail = `found at ${rdFile.path}`;
    resolvedChangeId = rdFile.changeId;
  } else {
    violations.push('RD phase skipped: peaks-rd was never invoked for this request (no RD request artifact found)');
    nextActions.push('Invoke Skill(skill="peaks-rd") with the request-id, then run unit tests + code review + security review');
    rdGates[0]!.detail = 'not found';
  }

  // Check RD evidence files (under the change-id dir the RD request lives in)
  const RD_EVIDENCE_FILE: Record<string, string> = {
    'tech-doc': 'tech-doc.md',
    'bug-analysis': 'bug-analysis.md',
    'code-review': 'code-review.md',
    'security-review': 'security-review.md'
  };
  // The evidence dir: prefer the on-disk changeId; fall back to the
  // caller's hint; final fallback to the requestId (back-compat for
  // pre-1.3.0 trees where the file lived under .peaks/<rid>/).
  const rdEvidenceDir = resolvedChangeId || options.changeId || options.rid;
  for (const gate of rdGates.slice(1)) {
    const fileName = RD_EVIDENCE_FILE[gate.name]!;
    const evidencePath = join(options.projectRoot, '.peaks', rdEvidenceDir, 'rd', fileName);
    if (existsSync(evidencePath)) {
      gate.passed = true;
      gate.detail = evidencePath;
    } else {
      gate.detail = `missing: ${evidencePath}`;
      violations.push(`RD evidence missing: ${gate.description} (${fileName})`);
      nextActions.push(`Create .peaks/${rdEvidenceDir}/rd/${fileName}`);
    }
  }

  // Check if RD reached qa-handoff
  if (rdInvoked && !RD_QA_HANDOFF_STATES.has(rdState)) {
    violations.push(`RD not ready for QA: state is "${rdState}" — must reach "qa-handoff" (unit tests, karpathy standards, code review, security review complete)`);
    nextActions.push(`Complete RD gates → peaks request transition ${options.rid} --role rd --state qa-handoff`);
  }

  // Check QA phase
  const qaFile = await findRequestFile(options.projectRoot, 'qa', options.rid);

  let qaInvoked = false;
  let qaState = 'missing';

  if (qaFile) {
    qaInvoked = true;
    qaState = extractState(qaFile.content);
    qaGates[0]!.passed = true;
    qaGates[0]!.detail = `found at ${qaFile.path}`;
    resolvedChangeId = qaFile.changeId || resolvedChangeId;
  } else {
    violations.push('QA phase skipped: peaks-qa was never invoked for this request (no QA request artifact found)');
    nextActions.push('Invoke Skill(skill="peaks-qa") with the request-id for functional/performance/security testing');
    qaGates[0]!.detail = 'not found';
  }

  // Check QA evidence files. For the security/performance findings
  // gates, the canonical form post-slice-025 is the per-rid suffixed
  // path; the legacy non-suffixed form is still accepted during the
  // 1-minor-release back-compat window. The path resolver
  // (artifact-paths.ts) decides which form to consume; we pass the
  // resolved change-id and the rid.
  const changeIdForResolver = resolvedChangeId || rdEvidenceDir;
  const QA_EVIDENCE_FILE: Record<string, string> = {
    'test-cases': `test-cases/${options.rid}.md`,
    'test-report': `test-reports/${options.rid}.md`,
    'security-findings': '',
    'performance-findings': ''
  };
  for (const gate of qaGates.slice(1)) {
    if (gate.name === 'security-findings' || gate.name === 'performance-findings') {
      const resolver = gate.name === 'security-findings' ? resolveSecurityFindingsPath : resolvePerformanceFindingsPath;
      const resolved = resolver({ projectRoot: options.projectRoot, changeId: changeIdForResolver, rid: options.rid });
      if (existsSync(resolved.path)) {
        gate.passed = true;
        gate.detail = resolved.path;
        if (resolved.form === 'legacy') {
          // 1-minor-release back-compat window. Surface the warning so
          // users know to migrate. Per PRD §Migration the form will be
          // rejected after the next minor bump.
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
    const evidencePath = join(options.projectRoot, '.peaks', rdEvidenceDir, 'qa', fileName);
    if (existsSync(evidencePath)) {
      gate.passed = true;
      gate.detail = evidencePath;
    } else {
      gate.detail = `missing: ${evidencePath}`;
      violations.push(`QA evidence missing: ${gate.description} (${fileName})`);
      nextActions.push(`Create .peaks/${rdEvidenceDir}/qa/${fileName}`);
    }
  }

  // Check if QA reached verdict-issued
  if (qaInvoked && !QA_COMPLETE_STATES.has(qaState)) {
    violations.push(`QA not complete: state is "${qaState}" — must reach "verdict-issued" (functional + performance + security checks done)`);
    nextActions.push(`Complete QA gates → peaks request transition ${options.rid} --role qa --state verdict-issued`);
  }

  // RD invoked without QA — check is moved to AFTER markIfSkipped
  // (slice 2026-06-13-peaks-workflow-skip) because the gate.status
  // values are only final after the post-process pass. We track the
  // decision with a placeholder here and resolve it below.
  const rdInvokedWithoutQaRaw = rdInvoked && !qaInvoked;

  // Slice 2026-06-13-peaks-workflow-skip: post-process. For any gate
  // the user marked as skipped, override the evaluation result. The
  // boolean `passed` is set to true so the gate counts as satisfied;
  // the new `status: 'skipped'` field signals the bypass to
  // downstream consumers. Violations and nextActions pushed for
  // skipped gates are filtered out (the user explicitly chose to
  // skip — the missing-evidence message is no longer actionable).
  for (const gate of [...rdGates, ...qaGates]) {
    if (skippedGateNames.has(gate.name)) {
      markIfSkipped(gate);
    }
  }
  if (skippedGateNames.size > 0) {
    const skippedViolations = new Set<string>();
    for (const gate of [...rdGates, ...qaGates]) {
      if (gate.status === 'skipped') {
        skippedViolations.add(`RD evidence missing: ${gate.description}`);
        skippedViolations.add(`QA evidence missing: ${gate.description}`);
      }
    }
    for (let i = violations.length - 1; i >= 0; i -= 1) {
      const v = violations[i]!;
      for (const sv of skippedViolations) {
        if (v.startsWith(sv)) {
          violations.splice(i, 1);
          break;
        }
      }
    }
  }

  // Resolve the "RD invoked without QA" check now that markIfSkipped
  // has run. The check is suppressed when every QA gate is skipped
  // (slice 2026-06-13-peaks-workflow-skip: the user explicitly chose
  // to skip the QA phase).
  if (rdInvokedWithoutQaRaw) {
    const allQaSkipped = qaGates.every((g) => g.status === 'skipped');
    if (!allQaSkipped) {
      violations.push('CRITICAL: peaks-rd was invoked but peaks-qa was NOT — QA functional/performance/security testing is mandatory after all RD work');
      nextActions.push('MUST invoke Skill(skill="peaks-qa") before declaring workflow complete');
    }
  }

  const allRdGatesPassed = rdGates.every((g) => g.passed);
  const allQaGatesPassed = qaGates.every((g) => g.passed);
  const complete = rdInvoked && qaInvoked && allRdGatesPassed && allQaGatesPassed
    && RD_QA_HANDOFF_STATES.has(rdState) && QA_COMPLETE_STATES.has(qaState);

  // Slice 025 — derive the `acceptedForm` and `gateC` verdict. The form is
  // 'suffixed' if both the security + perf gates passed via the new
  // per-rid path; 'legacy' if either was consumed via the legacy fallback;
  // 'none' if neither passed.
  const secGate = qaGates.find((g) => g.name === 'security-findings');
  const perfGate = qaGates.find((g) => g.name === 'performance-findings');
  const secForm: 'suffixed' | 'legacy' = secGate?.detail?.includes(`-${options.rid}.md`) ? 'suffixed' : 'legacy';
  const perfForm: 'suffixed' | 'legacy' = perfGate?.detail?.includes(`-${options.rid}.md`) ? 'suffixed' : 'legacy';
  const acceptedForm: 'suffixed' | 'legacy' | 'none' =
    !secGate?.passed && !perfGate?.passed
      ? 'none'
      : (secForm === 'suffixed' && perfForm === 'suffixed')
        ? 'suffixed'
        : (secForm === 'legacy' || perfForm === 'legacy')
          ? 'legacy'
          : 'suffixed';
  const gateC: 'pass' | 'fail' = allQaGatesPassed ? 'pass' : 'fail';

  return {
    rid: options.rid,
    changeId: resolvedChangeId,
    requestType,
    complete,
    rdPhase: { invoked: rdInvoked, state: rdState, gates: rdGates },
    qaPhase: { invoked: qaInvoked, state: qaState, gates: qaGates },
    violations,
    nextActions,
    acceptedForm,
    gateC
  };
}
