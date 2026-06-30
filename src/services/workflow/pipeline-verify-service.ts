import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { RequestType } from '../artifacts/artifact-prerequisites.js';
import { isRequestType } from '../artifacts/artifact-prerequisites.js';
import { showRequestArtifact } from '../artifacts/request-artifact-service.js';
import { resolveSecurityFindingsPath, resolvePerformanceFindingsPath } from './artifact-paths.js';
import { readSkipState } from './workflow-state-store.js';
import { getSessionIdCanonical } from '../session/session-manager.js';
import { listUnpromotedFeedback } from '../feedback/feedback-promotion-service.js';

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
  sessionId: string;
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
  /**
   * Slice 002 (v2.15.0) AC-3: Gate H "feedback-promotion". Always
   * present (single-element array). Evaluates whether every
   * `metadata.type === 'feedback'` memory in `.peaks/memory/`
   * carries a promotion marker (comment OR sidecar). Failures
   * block the `complete` verdict via the `gateH` field below; the
   * pipeline only completes when every gate in this array passes.
   */
  feedbackPhase?: {
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
  /**
   * Slice 002 (v2.15.0) AC-3: Gate H verdict string. `'pass'` when
   * all feedback memories are promoted; `'fail'` when at least one
   * unpromoted feedback memory was found.
   */
  gateH?: 'pass' | 'fail';
  /**
   * Slice 2026-06-28-solo-mode-bypass-fix (defect #3): `true` when
   * every evidence file resolved on the canonical path
   * (`.peaks/_runtime/change/<sessionId>/...`). `false` when at least
   * one evidence file resolved via a legacy fallback (`.peaks/<sessionId>/...`
   * or `.peaks/_runtime/<sessionId>/...`). QA / TXT surface the value
   * so users know to move misplaced evidence into the canonical
   * location.
   *
   * Slice 2026-06-29-change-id-root-removal: the legacy
   * `peaks workspace migrate-change-scope` migration tool is gone;
   * users must now move misplaced content into the canonical
   * `.peaks/_runtime/change/<sessionId>/<role>/` dir manually (or via
   * `peaks workspace migrate`).
   */
  usedCanonicalPath?: boolean;
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
 * scope is the change-id (the `.peaks/_runtime/<sessionId>/` dir the file lives
 * in), NOT the session-id. We resolve the on-disk location via
 * `showRequestArtifact` (which scans all top-level dirs and returns the
 * actual dir the file was found in) instead of assuming
 * `.peaks/_runtime/<sessionId>/<role>/requests/`.
 */
async function findRequestFile(projectRoot: string, role: string, rid: string): Promise<{ path: string; content: string; sessionId: string } | null> {
  const artifact = await showRequestArtifact({ projectRoot, role: role as 'prd' | 'ui' | 'rd' | 'qa' | 'sc', requestId: rid });
  if (artifact === null) return null;
  // Slice 2026-06-28-solo-mode-bypass-fix (defect #3): the legacy
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
  /** Optional explicit session-id; when omitted, the RD/QA on-disk location
   * is resolved via showRequestArtifact (which scans all top-level dirs and
   * returns the actual session-id the file lives in). */
  sessionId?: string;
  requestType?: string;
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
  // lives in. The caller's `options.sessionId` is a hint used for
  // path construction (nextActions strings), NOT for the resolved
  // sessionId field — the on-disk location is the source of truth.
  let resolvedChangeId = '';

  if (rdFile) {
    rdInvoked = true;
    rdState = extractState(rdFile.content);
    rdGates[0]!.passed = true;
    rdGates[0]!.detail = `found at ${rdFile.path}`;
    resolvedChangeId = rdFile.sessionId;
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
  // Slice v2.17.0 hard-kill — change-id axis removed as filesystem
  // scope. The canonical evidence location is now the session axis
  // `.peaks/_runtime/<sessionId>/<role>/...` (where `<sessionId>` is
  // the on-disk dir the request artifact lives in; for back-compat
  // with the legacy `_runtime/<sessionId>/` and `.peaks/<sessionId>/`
  // layouts we also probe those). When the legacy fallback fires, the
  // gate detail / nextActions surface the `DEPRECATION_LEGACY_PATH_USED`
  // warning so QA / TXT can nudge users to migrate via
  // `peaks workspace migrate-change-scope --apply`.
  // v2.18.1 bug #5 fix: same session-axis fallback as the QA resolver
  // below. When `resolvedChangeId` is empty (no RD/QA artifact on disk
  // yet), the canonical session id from the binding-store is the
  // preferred filesystem scope; falling through to `options.rid` would
  // make every missing-evidence path look like a per-rid scope dir.
  const rdEvidenceDir = resolvedChangeId || options.sessionId || getSessionIdCanonical(options.projectRoot) || options.rid;
  // Slice 2026-06-28-solo-mode-bypass-fix (defect #3): track whether
  // every resolved evidence file landed on the canonical path. Drives
  // the `usedCanonicalPath` envelope field. The flag stays `true` if
  // no evidence file was resolved at all (nothing to be non-canonical
  // about); it flips to `false` if any file resolves via legacy.
  let anyEvidenceResolved = false;
  let allResolvedPathsCanonical = true;
  for (const gate of rdGates.slice(1)) {
    const fileName = RD_EVIDENCE_FILE[gate.name]!;
    // v2.17.0 canonical: session axis — `<sessionId>` is the on-disk
    // dir the request artifact was found in (matches the layout used
    // by `request-artifact-service.ts` for new artifacts).
    const canonicalPath = join(options.projectRoot, '.peaks', '_runtime', rdEvidenceDir, 'rd', fileName);
    const legacyMisplacedPath = join(options.projectRoot, '.peaks', rdEvidenceDir, 'rd', fileName);
    // Pre-v2.17.0 change-axis form: `.peaks/_runtime/change/<id>/rd/<file>`
    // — the v2.16.0 / v2.17.0-era canonical that v2.17.0 hard-killed.
    // Kept as a back-compat fallback for un-migrated workspaces.
    const legacyChangeAxisPath = join(options.projectRoot, '.peaks', '_runtime', 'change', rdEvidenceDir, 'rd', fileName);
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

  // Check if RD reached qa-handoff
  if (rdInvoked && !RD_QA_HANDOFF_STATES.has(rdState)) {
    violations.push(`RD not ready for QA: state is "${rdState}" — must reach "qa-handoff" (unit tests, karpathy-guidelines §1 Think / §2 Simplicity / §3 Surgical / §4 Goal-Driven, code review, security review complete)`);
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
    resolvedChangeId = qaFile.sessionId || resolvedChangeId;
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
  // v2.18.1 bug #5 fix: when no RD/QA artifact is on disk yet (resolvedChangeId
  // is empty), fall back to the current session id from the binding-store
  // instead of `rdEvidenceDir` (= the rid). The session axis
  // `.peaks/_runtime/<sessionId>/qa/...` is the canonical v2.17.0 home; the
  // legacy `_runtime/change/<sessionId>/qa/...` probe should only fire for
  // pre-v2.17.0 workspaces, not as a default for new requests. The slug in
  // the `sessionId` envelope field is preserved below for traceability.
  const changeIdForResolver = resolvedChangeId || getSessionIdCanonical(options.projectRoot) || rdEvidenceDir;
  const QA_EVIDENCE_FILE: Record<string, string> = {
    'test-cases': `test-cases/${options.rid}.md`,
    'test-report': `test-reports/${options.rid}.md`,
    'security-findings': '',
    'performance-findings': ''
  };
  for (const gate of qaGates.slice(1)) {
    if (gate.name === 'security-findings' || gate.name === 'performance-findings') {
      const resolver = gate.name === 'security-findings' ? resolveSecurityFindingsPath : resolvePerformanceFindingsPath;
      const resolved = resolver({ projectRoot: options.projectRoot, sessionId: changeIdForResolver, rid: options.rid });
      if (existsSync(resolved.path)) {
        anyEvidenceResolved = true;
        if (resolved.form === 'legacy') allResolvedPathsCanonical = false;
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
    // v2.17.0 canonical: session axis — `<sessionId>/qa/<file>`.
    const canonicalQaPath = join(options.projectRoot, '.peaks', '_runtime', rdEvidenceDir, 'qa', fileName);
    const legacyMisplacedQaPath = join(options.projectRoot, '.peaks', rdEvidenceDir, 'qa', fileName);
    // Pre-v2.17.0 change-axis form: kept as back-compat fallback.
    const legacyChangeAxisQaPath = join(options.projectRoot, '.peaks', '_runtime', 'change', rdEvidenceDir, 'qa', fileName);
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

  // Slice 002 (v2.15.0) AC-3 — Gate H "feedback-promotion". Scans
  // `.peaks/memory/*.md` for `metadata.type === 'feedback'` entries
  // without a promotion marker (HTML comment or `.promotion.json`
  // sidecar). When any unpromoted feedback is found, the gate fails
  // and the pipeline does not complete until the user promotes via
  // `peaks feedback promote <memory-file> --layer <A|B|C>`.
  //
  // The scan is intentionally non-throwing — a missing or unreadable
  // memory dir is treated as "no feedback found, gate passes" so
  // empty projects / pre-feedback-epoch projects don't false-positive.
  const feedbackGates: PipelineGate[] = [
    {
      name: 'feedback-promotion',
      description: 'Every feedback memory is promoted to at least one enforcement layer (sop / hooks / hard-floor)',
      passed: false,
      detail: ''
    }
  ];
  let unpromotedFeedbackCount = 0;
  try {
    const unpromoted = listUnpromotedFeedback({ projectRoot: options.projectRoot });
    unpromotedFeedbackCount = unpromoted.length;
    if (unpromoted.length === 0) {
      feedbackGates[0]!.passed = true;
      feedbackGates[0]!.detail = `0 unpromoted feedback memories in .peaks/memory/`;
    } else {
      feedbackGates[0]!.detail = `${unpromoted.length} unpromoted feedback memor${unpromoted.length === 1 ? 'y' : 'ies'}: ${unpromoted.map((u) => u.name).join(', ')}`;
      violations.push(`Gate H feedback-promotion FAILED: ${unpromoted.length} feedback memor${unpromoted.length === 1 ? 'y is' : 'ies are'} not yet promoted to an enforcement layer (${unpromoted.map((u) => u.name).join(', ')}). Run \`peaks feedback promote <memory-file> --layer <A|B|C>\` for each. See sops/feedback-promotion-sop.md.`);
      nextActions.push(`Run \`peaks feedback promote <memory-file> --layer <A|B|C>\` for each unpromoted feedback memory to satisfy Gate H.`);
    }
  } catch {
    // listUnpromotedFeedback swallows IO errors internally; the
    // outer catch is a belt-and-braces guard for unexpected
    // failures (e.g. permission denied). Treat as "no feedback" —
    // fail-open on gate infrastructure rather than blocking ship.
    feedbackGates[0]!.passed = true;
    feedbackGates[0]!.detail = 'feedback-promotion scan skipped (memory dir unreadable; treating as no feedback)';
  }
  const allFeedbackGatesPassed = feedbackGates.every((g) => g.passed);

  const allRdGatesPassed = rdGates.every((g) => g.passed);
  const allQaGatesPassed = qaGates.every((g) => g.passed);
  const complete = rdInvoked && qaInvoked && allRdGatesPassed && allQaGatesPassed && allFeedbackGatesPassed
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
  const gateH: 'pass' | 'fail' = allFeedbackGatesPassed ? 'pass' : 'fail';

  // Slice 2026-06-28-solo-mode-bypass-fix (defect #3): `true` when
  // every gate resolved on the canonical path; `false` when at least
  // one fell back to a legacy form. QA / TXT surface the value so the
  // user knows the legacy content must be moved into the canonical
  // location (the legacy `peaks workspace migrate-change-scope` helper
  // was removed in v2.19.0; use `peaks workspace migrate` to relocate
  // misplaced content).
  //
  // Implementation note: use the in-loop flag `allResolvedPathsCanonical`
  // (correctly updated by both the inline evidence loop AND the
  // artifact-paths resolver for security/performance findings), not a
  // string-scan over `gate.detail`. The string-scan approach misses the
  // artifact-paths legacy branch (it does NOT inject the
  // `DEPRECATION_LEGACY_PATH_USED` suffix into gate.detail).
  //
  // If NO evidence file resolved (e.g. all gates missing), the field is
  // `true` — there is nothing non-canonical to worry about. If every
  // resolved gate was skipped via `peaks workflow skip`, the field is
  // `true` — the user opted out of the canonical/legacy decision.
  const allGatesSkipped = [...rdGates, ...qaGates].every((g) => g.status === 'skipped');
  const usedCanonicalPath = !anyEvidenceResolved || allGatesSkipped || allResolvedPathsCanonical;

  return {
    rid: options.rid,
    sessionId: resolvedChangeId,
    requestType,
    complete,
    rdPhase: { invoked: rdInvoked, state: rdState, gates: rdGates },
    qaPhase: { invoked: qaInvoked, state: qaState, gates: qaGates },
    feedbackPhase: { gates: feedbackGates },
    violations,
    nextActions,
    acceptedForm,
    gateC,
    gateH,
    usedCanonicalPath
  };
}
