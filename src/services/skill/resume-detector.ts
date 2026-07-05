/**
 * Peaks-Loop Solo Step 0.7 — Resume-mode detector.
 *
 * Mirrors the classification table in
 * `skills/peaks-code/SKILL.md` "Peaks-Loop Step 0.7: Detect unfinished work
 * and offer resume". The function is a pure read of session artifacts;
 * it performs no side effects and is safe to call from hooks, scripts,
 * and skills.
 *
 * Two classification sources are merged:
 *   1. State-based (PRD / RD / QA request artifact `state:` field) →
 *      determines the *deepest completed gate*.
 *   2. File-presence ("Other resume triggers" table) → if a required
 *      artifact is missing for a gate that state says is complete, the
 *      classifier emits a `resume:<earlier-point>` verdict AND a
 *      `warnings[]` entry flagging the inconsistency.
 *
 * Primary vs. abandoned filter: when multiple RD/QA request artifacts
 * exist for the same session (the 8-slice governance pass leaves
 * `deferred`/`abandoned` artifacts alongside the active one), the
 * classifier filters out files whose `state: blocked` field is paired
 * with a `user-requested-abandon` transition note. The remaining
 * artifacts are sorted by filename (alphabetical) and the first is the
 * primary.
 *
 * Legacy path fallback: prefers the canonical
 * `.peaks/_runtime/<sid>/` layout introduced in slice
 * `2026-06-05-peaks-runtime-layer`; falls back to the pre-migration
 * `.peaks/_runtime/<sid>/` for one minor release so older trees do not show as
 * false "fresh". The `usedLegacyPath` field reports which path was
 * read.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type ResumeKind = 'fresh' | 'complete' | 'resume' | 'in-flight';

/**
 * Step at which the slice should resume. The values are stable strings
 * (not raw step numbers) so log output is greppable and a future
 * workflow reshuffle can keep the names but remap the steps.
 */
export type ResumePoint =
  | 'rd-planning'
  | 'rd-review-fanout'
  | 'rd-perf-baseline'
  | 'qa-test-cases'
  | 'qa-execution'
  | 'qa-validation'
  | 'txt-handoff';

/**
 * Mid-implementation RD/QA states. The skill body treats these as
 * "ask the user to confirm the in-flight gate" — there is no safe
 * auto-resume for a slice the LLM is currently driving.
 */
export type InFlightState = 'spec-locked' | 'implemented' | 'running' | 'blocked';

export type ResumeClassification = {
  kind: ResumeKind;
  /** Set when `kind === 'resume'`; the step that should be re-entered. */
  point: ResumePoint | null;
  /** Set when `kind === 'in-flight'`; the current non-terminal state. */
  state: InFlightState | null;
  /**
   * Files that the SKILL.md spec says should already exist for the
   * current gate but were not found. Informational — the LLM uses this
   * to decide what to produce next. Includes legacy-missing files when
   * the legacy path was read.
   */
  missingArtifacts: string[];
  /**
   * Inconsistencies between state and file presence (e.g. RD is
   * `state: qa-handoff` but `rd/code-review.md` is absent). The
   * classifier still emits a `resume:` verdict, but the warning is the
   * audit trail.
   */
  warnings: string[];
  /** Number of RD/QA requests filtered as `user-requested-abandon`. */
  abandonedRequestCount: number;
  /**
   * True when the canonical `.peaks/_runtime/<sid>/` path was absent
   * and the classifier fell back to `.peaks/_runtime/<sid>/`. Lets the SKILL.md
   * surface a one-time migration reminder to the user.
   */
  usedLegacyPath: boolean;
};

type RequestState = {
  filename: string;
  state: string;
  /** True when the request is `state: blocked` AND carries a `user-requested-abandon` transition note. */
  abandoned: boolean;
};

const MID_IMPL_RD_STATES: ReadonlySet<string> = new Set([
  'spec-locked',
  'implemented',
  'running',
  'blocked'
]);

/**
 * Classify a session's resume state. Pure function — does not write
 * files, does not call any peaks CLI.
 *
 * @param sid        The session id (e.g. `2026-06-06-session-22f08c`).
 * @param peaksRoot  The canonical peaks runtime root, i.e. the
 *                   directory containing `<sid>/` subdirs. For the
 *                   v1.3.2 layout this is `<repo>/.peaks/_runtime`.
 *                   The legacy `<repo>/.peaks` layout is also accepted
 *                   for one minor release (see `usedLegacyPath`).
 */
export function classifyResume(sid: string, peaksRoot: string): ResumeClassification {
  const resolved = resolveSessionDir(sid, peaksRoot);
  if (resolved === null) {
    return {
      kind: 'fresh',
      point: null,
      state: null,
      missingArtifacts: [],
      warnings: [],
      abandonedRequestCount: 0,
      usedLegacyPath: false
    };
  }
  const { sessionDir, usedLegacyPath } = resolved;

  const prdStates = readRequestStates(sessionDir, 'prd');
  const rdStatesRaw = readRequestStates(sessionDir, 'rd');
  const qaStatesRaw = readRequestStates(sessionDir, 'qa');

  // Filter abandoned (state=blocked + user-requested-abandon note).
  const abandonedRd = rdStatesRaw.filter((s) => s.abandoned);
  const abandonedQa = qaStatesRaw.filter((s) => s.abandoned);
  const abandonedCount = abandonedRd.length + abandonedQa.length;

  // Primary selection filter: when there are MULTIPLE RD/QA requests,
  // the abandoned ones are excluded from the candidate set so the
  // classifier surfaces the active slice, not the audit-only trail.
  // When there is only ONE request, the abandoned flag is informational
  // only — a single blocked RD with an abandoned note is still the
  // primary, because the user might want to unblock and continue.
  const rdStates =
    rdStatesRaw.length > 1 ? rdStatesRaw.filter((s) => !s.abandoned) : rdStatesRaw;
  const qaStates =
    qaStatesRaw.length > 1 ? qaStatesRaw.filter((s) => !s.abandoned) : qaStatesRaw;

  const primaryPrd = pickPrimary(prdStates);
  const primaryRd = pickPrimary(rdStates);
  const primaryQa = pickPrimary(qaStates);

  // Phase 1: TXT handoff present → workflow complete. Always wins.
  if (existsSync(join(sessionDir, 'txt', 'handoff.md'))) {
    return {
      kind: 'complete',
      point: null,
      state: null,
      missingArtifacts: [],
      warnings: [],
      abandonedRequestCount: abandonedCount,
      usedLegacyPath
    };
  }

  // Phase 2: every RD/QA request is abandoned (filtered out) AND
  // there were multiple to begin with. The slice is effectively
  // dead — return fresh so the user can start over without
  // re-attaching to the abandoned work.
  if (
    primaryRd === null &&
    primaryQa === null &&
    abandonedCount > 0 &&
    (rdStatesRaw.length > 1 || qaStatesRaw.length > 1)
  ) {
    return {
      kind: 'fresh',
      point: null,
      state: null,
      missingArtifacts: [],
      warnings: [],
      abandonedRequestCount: abandonedCount,
      usedLegacyPath
    };
  }

  // Phase 3: mid-implementation RD states (spec-locked / implemented /
  // running / blocked). Wins over the PRD-handed-off branch because
  // the slice IS in flight — the LLM should not be told to "re-run
  // the swarm" when an RD artifact is already mid-edit.
  if (primaryRd !== null && MID_IMPL_RD_STATES.has(primaryRd.state)) {
    return {
      kind: 'in-flight',
      point: null,
      state: primaryRd.state as InFlightState,
      missingArtifacts: [],
      warnings: [],
      abandonedRequestCount: abandonedCount,
      usedLegacyPath
    };
  }

  // Phase 4: terminal gates (QA verdict-issued / RD qa-handoff / PRD
  // handed-off, with file-presence overrides).
  const terminal = classifyTerminalGates(sessionDir, {
    primaryPrd,
    primaryRd,
    primaryQa,
    usedLegacyPath,
    abandonedCount
  });
  if (terminal !== null) return terminal;

  // Phase 5: PRD exists with a non-handed-off state — treat as
  // in-flight:spec-locked placeholder. The user can confirm whether
  // they want to advance the PRD or start fresh.
  if (primaryPrd !== null && primaryPrd.state.length > 0) {
    return {
      kind: 'in-flight',
      point: null,
      state: 'spec-locked',
      missingArtifacts: [],
      warnings: [],
      abandonedRequestCount: abandonedCount,
      usedLegacyPath
    };
  }

  return {
    kind: 'fresh',
    point: null,
    state: null,
    missingArtifacts: [],
    warnings: [],
    abandonedRequestCount: abandonedCount,
    usedLegacyPath
  };
}

function classifyTerminalGates(
  sessionDir: string,
  ctx: {
    primaryPrd: RequestState | null;
    primaryRd: RequestState | null;
    primaryQa: RequestState | null;
    usedLegacyPath: boolean;
    abandonedCount: number;
  }
): ResumeClassification | null {
  // QA verdict-issued → deepest gate is D. If the test-report is
  // missing the state is inconsistent; fall back to qa-execution.
  if (ctx.primaryQa !== null && ctx.primaryQa.state === 'verdict-issued') {
    const reportPath = join(sessionDir, 'qa', 'test-reports', ctx.primaryQa.filename);
    if (!existsSync(reportPath)) {
      return {
        kind: 'resume',
        point: 'qa-execution',
        state: null,
        missingArtifacts: [`qa/test-reports/${ctx.primaryQa.filename}`],
        warnings: [
          'inconsistent: qa verdict-issued but no qa/test-reports/<rid>.md; CLI gate should have blocked the transition'
        ],
        abandonedRequestCount: ctx.abandonedCount,
        usedLegacyPath: ctx.usedLegacyPath
      };
    }
    return {
      kind: 'resume',
      point: 'txt-handoff',
      state: null,
      missingArtifacts: ['txt/handoff.md'],
      warnings: [],
      abandonedRequestCount: ctx.abandonedCount,
      usedLegacyPath: ctx.usedLegacyPath
    };
  }

  // RD qa-handoff → deepest gate is C. If the review artifacts are
  // missing the state is inconsistent; fall back to rd-review-fanout.
  if (ctx.primaryRd !== null && ctx.primaryRd.state === 'qa-handoff') {
    const codeReviewPath = join(sessionDir, 'rd', 'code-review.md');
    const securityReviewPath = join(sessionDir, 'rd', 'security-review.md');
    const missing: string[] = [];
    if (!existsSync(codeReviewPath)) missing.push('rd/code-review.md');
    if (!existsSync(securityReviewPath)) missing.push('rd/security-review.md');
    if (missing.length > 0) {
      return {
        kind: 'resume',
        point: 'rd-review-fanout',
        state: null,
        missingArtifacts: missing,
        warnings: [
          'inconsistent: rd qa-handoff but review artifacts missing; CLI gate should have blocked the transition'
        ],
        abandonedRequestCount: ctx.abandonedCount,
        usedLegacyPath: ctx.usedLegacyPath
      };
    }
    return {
      kind: 'resume',
      point: 'qa-validation',
      state: null,
      missingArtifacts:
        ctx.primaryQa === null
          ? [`qa/test-cases/${ctx.primaryRd.filename}`]
          : [],
      warnings: [],
      abandonedRequestCount: ctx.abandonedCount,
      usedLegacyPath: ctx.usedLegacyPath
    };
  }

  // PRD handed-off → deepest gate is B. Walk "Other resume triggers"
  // in priority order: tech-doc > qa/test-cases > in-flight (swarm
  // converged, RD impl not yet started).
  if (ctx.primaryPrd !== null && ctx.primaryPrd.state === 'handed-off') {
    const missing: string[] = [];
    if (!existsSync(join(sessionDir, 'rd', 'tech-doc.md'))) {
      missing.push('rd/tech-doc.md');
    }
    // QA test-cases path: use the RD rid if present, else fall back
    // to the PRD rid. The rid is shared across roles.
    const qaCasesRid =
      ctx.primaryRd !== null
        ? ctx.primaryRd.filename
        : ctx.primaryPrd !== null
          ? ctx.primaryPrd.filename
          : null;
    if (qaCasesRid !== null) {
      const qaCasesPath = join(sessionDir, 'qa', 'test-cases', qaCasesRid);
      if (!existsSync(qaCasesPath)) {
        missing.push(`qa/test-cases/${qaCasesRid}`);
      }
    }
    if (missing.includes('rd/tech-doc.md')) {
      return {
        kind: 'resume',
        point: 'rd-planning',
        state: null,
        missingArtifacts: missing,
        warnings: [],
        abandonedRequestCount: ctx.abandonedCount,
        usedLegacyPath: ctx.usedLegacyPath
      };
    }
    if (missing.some((m) => m.startsWith('qa/test-cases/'))) {
      return {
        kind: 'resume',
        point: 'qa-test-cases',
        state: null,
        missingArtifacts: missing,
        warnings: [],
        abandonedRequestCount: ctx.abandonedCount,
        usedLegacyPath: ctx.usedLegacyPath
      };
    }
    // All post-PRD artifacts present. Either the RD is mid-impl
    // (handled upstream in Phase 3) or the swarm converged but the
    // implementation has not yet started. Report the latter as
    // in-flight:spec-locked so the user can confirm.
    return {
      kind: 'in-flight',
      point: null,
      state: 'spec-locked',
      missingArtifacts: [],
      warnings: [],
      abandonedRequestCount: ctx.abandonedCount,
      usedLegacyPath: ctx.usedLegacyPath
    };
  }

  return null;
}

/**
 * Resolve the session directory. Prefers the canonical
 * `.peaks/_runtime/<sid>/`; falls back to the legacy
 * `.peaks/_runtime/<sid>/` (one level up from the runtime root) for one
 * minor release. Returns `null` when neither path exists.
 */
function resolveSessionDir(sid: string, peaksRoot: string): { sessionDir: string; usedLegacyPath: boolean } | null {
  const canonical = join(peaksRoot, sid);
  if (existsSync(canonical)) {
    return { sessionDir: canonical, usedLegacyPath: false };
  }
  const legacy = join(peaksRoot, '..', sid);
  if (existsSync(legacy)) {
    return { sessionDir: legacy, usedLegacyPath: true };
  }
  return null;
}

function readRequestStates(sessionDir: string, role: 'prd' | 'rd' | 'qa'): RequestState[] {
  const dir = join(sessionDir, role, 'requests');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f): f is string => typeof f === 'string' && f.endsWith('.md'))
    .sort()
    .map((filename) => {
      const full = join(dir, filename);
      const content = readFileSync(full, 'utf8');
      return {
        filename,
        state: extractState(content),
        abandoned: hasAbandonedTransitionNote(content)
      };
    });
}

function extractState(content: string): string {
  const match = /^-\s*state:\s*(\S+)|^state:\s*(\S+)/m.exec(content);
  if (match === null) return '';
  const captured = match[1] ?? match[2] ?? '';
  return captured.trim();
}

function hasAbandonedTransitionNote(content: string): boolean {
  return /user-requested-abandon/.test(content);
}

function pickPrimary(states: RequestState[]): RequestState | null {
  if (states.length === 0) return null;
  return states[0] ?? null;
}
