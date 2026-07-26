/**
 * peaks-workflow — pipeline verification orchestrator (slimmed per rid-006).
 *
 * `verifyPipeline` resolves RD / QA evidence files for a given rid and
 * returns a structured `PipelineVerification` envelope. Type
 * declarations live in `pipeline-verify-types.ts`; private gate
 * helpers (`rdGatesForType`, `qaGatesForType`, `extractState`,
 * `findRequestFile`, the `_runtime/` prefix strip, the RD/QA handoff
 * state sets, and the RD/QA evidence path probes) live in
 * `pipeline-verify-gate-support.ts`. The re-export shim at the
 * bottom preserves the original public surface so existing import
 * paths compile unchanged.
 *
 * File budget: ≤ 400 lines (rid-006 split).
 */

import type { RequestType } from '../artifacts/artifact-prerequisites.js';
import { isRequestType } from '../artifacts/artifact-prerequisites.js';
import { readSkipState } from './workflow-state-store.js';
import { getSessionIdCanonical } from '../session/session-manager.js';
import { listUnpromotedFeedback } from '../feedback/feedback-promotion-service.js';
import type { PipelineGate, PipelineVerification } from './pipeline-verify-types.js';
import {
  QA_COMPLETE_STATES,
  RD_QA_HANDOFF_STATES,
  extractState,
  findRequestFile,
  qaGatesForType,
  rdGatesForType,
  resolveQaEvidencePaths,
  resolveRdEvidencePaths
} from './pipeline-verify-gate-support.js';

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

  // Check RD evidence files (under the change-id dir the RD request lives in).
  // v2.17.0 hard-kill — change-id axis removed as filesystem scope. The
  // canonical evidence location is now the session axis
  // `.peaks/_runtime/<sessionId>/<role>/...` (where `<sessionId>` is the
  // on-disk dir the request artifact lives in; for back-compat with the
  // legacy `_runtime/<sessionId>/` and `.peaks/<sessionId>/` layouts the
  // helper also probes those). When the legacy fallback fires, the gate
  // detail / nextActions surface the `DEPRECATION_LEGACY_PATH_USED`
  // warning so QA / TXT can nudge users to migrate via
  // `peaks workspace migrate`.
  // v2.18.1 bug #5 fix: when `resolvedChangeId` is empty (no RD/QA
  // artifact on disk yet), the canonical session id from the
  // binding-store is the preferred filesystem scope; falling through
  // to `options.rid` would make every missing-evidence path look like
  // a per-rid scope dir.
  const rdEvidenceDir = resolvedChangeId || options.sessionId || getSessionIdCanonical(options.projectRoot) || options.rid;
  const rdTracker = resolveRdEvidencePaths(
    rdGates,
    rdEvidenceDir,
    options.projectRoot,
    violations,
    nextActions,
    { anyEvidenceResolved: false, allResolvedPathsCanonical: true }
  );

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

  // Check QA evidence files.
  // v2.18.1 bug #5 fix: when no RD/QA artifact is on disk yet
  // (resolvedChangeId is empty), fall back to the current session id
  // from the binding-store instead of `rdEvidenceDir` (= the rid). The
  // session axis `.peaks/_runtime/<sessionId>/qa/...` is the canonical
  // v2.17.0 home; the legacy `_runtime/change/<sessionId>/qa/...` probe
  // should only fire for pre-v2.17.0 workspaces, not as a default for
  // new requests.
  const changeIdForResolver = resolvedChangeId || getSessionIdCanonical(options.projectRoot) || rdEvidenceDir;
  const qaTracker = resolveQaEvidencePaths(
    qaGates,
    options.projectRoot,
    rdEvidenceDir,
    changeIdForResolver,
    options.rid,
    violations,
    nextActions,
    rdTracker
  );
  const anyEvidenceResolved = qaTracker.anyEvidenceResolved;
  const allResolvedPathsCanonical = qaTracker.allResolvedPathsCanonical;

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
  try {
    const unpromoted = listUnpromotedFeedback({ projectRoot: options.projectRoot });
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

  // Slice 2026-06-28-code-mode-bypass-fix (defect #3): `true` when
  // every gate resolved on the canonical path; `false` when at least
  // one fell back to a legacy form. QA / TXT surface the value so the
  // user knows the legacy content must be moved into the canonical
  // location (the legacy `peaks workspace migrate-change-scope` helper
  // was removed in v2.19.0; use `peaks workspace migrate` to relocate
  // misplaced content).
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

// ─── verbatim re-export shim (rid-006) ────────────────────────────────────
// External callers import `PipelineGate` / `PipelineVerification` from
// this module. Re-export them under their original names so the call
// sites compile unchanged. The types moved to `pipeline-verify-types.ts`.

export type { PipelineGate, PipelineVerification } from './pipeline-verify-types.js';