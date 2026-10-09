// src/cli/commands/qa-run-slice.ts
//
// The pure `peaks qa run` slice: the gate list, the restart detector wiring and
// the MUT.sig gate, with no commander and no I/O. Extracted from
// `qa-commands.ts`; the exported names, the gate order and every envelope field
// are unchanged.
//
// The browser-E2E gate is what the restart-loop detector guards, so the slice
// wires it here: it constructs a `BrowserRestartDetector` (configurable via
// `--max-browser-restarts` / `--no-restart-detector`) and a `BrowserEventLogger`
// that writes the per-slice JSONL log to
// `.peaks/_runtime/<session-id>/qa/browser-events.jsonl`.

import { join } from 'node:path';
import type { MutReportJson } from 'peaks-loop-mut';

import {
  BrowserRestartDetector,
  type BrowserEvent
} from '../../services/qa/browser-restart-detector.js';
import { BrowserEventLogger } from '../../services/qa/browser-event-logger.js';
import { BROWSER_REUSE_HINT } from '../../services/qa/browser-reuse-hint.js';
import { isUnsafePathInput } from '../../shared/path-safety.js';

export type QaGateStatus = {
  readonly name: string;
  readonly status: 'passed' | 'skipped' | 'failed';
  readonly reason?: string;
  /**
   * Plan 2 / Task 8 — when the gate consumes an artifact with a
   * deterministic signature, this field carries that signature for
   * downstream audit-trail consumers. Currently set only on the
   * `mutation` gate to MUT.sig (the `sha256` of mut-report.json).
   */
  readonly mutSig?: string;
};

export type QaRunResult = {
  readonly sessionId: string;
  readonly project: string;
  readonly browserEnabled: boolean;
  readonly gates: readonly QaGateStatus[];
  readonly detectorTriggered: boolean;
  readonly diagnostic?: string;
  readonly subAgentPromptHint: string;
  /**
   * Plan 2 / Task 8 — MUT.sig when peaks-mut ran in this session.
   * Undefined when peaks-mut was not run (no mut-report.json) or
   * the user passed --no-mutation.
   */
  readonly mutSig?: string;
};

export type RunQaSliceInput = {
  readonly project: string;
  readonly sessionId: string;
  readonly browserEnabled: boolean;
  readonly maxRestarts: number;
  readonly detectorEnabled: boolean;
  readonly events: readonly BrowserEvent[];
  // Plan 2 / Task 8 — pre-loaded mut-report.json (null = "not run");
  // the slice is pure, the CLI action handler does the I/O.
  readonly mutationReport: MutReportJson | null;
  // Plan 2 / Task 8 — when false, force the mutation gate to `skipped`
  // even if a report is present (mirrors --no-browser).
  readonly mutationEnabled: boolean;
};

export const DEFAULT_MAX_BROWSER_RESTARTS = 3;

export function runQaSlice(input: RunQaSliceInput): QaRunResult {
  // Sid axis: this is the join for `qa/browser-events.jsonl`. The `qa gate run`
  // action guards before calling in, but the function is exported for tests and
  // states its own contract at the join.
  if (isUnsafePathInput(input.sessionId)) {
    throw new Error(`Invalid session id: ${input.sessionId} (must be a single path segment)`);
  }
  const detector = new BrowserRestartDetector({
    maxRestarts: input.maxRestarts,
    enabled: input.detectorEnabled
  });
  const logPath = join(
    input.project,
    '.peaks',
    '_runtime',
    input.sessionId,
    'qa',
    'browser-events.jsonl'
  );
  const logger = new BrowserEventLogger({ filePath: logPath });

  // PRD AC4 + P1: when browser E2E is off, the detector must NOT record events
  // at all (otherwise a user passing both --no-browser AND a hot detector would
  // see spurious detectorTriggered=true and exit code 2).
  if (input.browserEnabled) {
    recordBrowserEvents(detector, logger, input.events, input.sessionId);
  }

  const gates: QaGateStatus[] = [
    { name: 'functional', status: 'passed' },
    { name: 'security', status: 'passed' },
    browserGateStatus(input.browserEnabled, detector),
    mutationGateStatus(input)
  ];
  const halt = detector.shouldHalt();

  return {
    sessionId: input.sessionId,
    project: input.project,
    browserEnabled: input.browserEnabled,
    gates,
    detectorTriggered: halt,
    ...(halt ? { diagnostic: detector.diagnostic() } : {}),
    subAgentPromptHint: BROWSER_REUSE_HINT,
    // Surface MUT.sig ONLY when the gate is actually evaluated
    // (mutation enabled AND a report was loaded). --no-mutation or
    // missing report -> undefined, so downstream consumers cannot
    // mistake a skipped gate for a chain-trail anchor.
    ...(input.mutationEnabled && input.mutationReport !== null
      ? { mutSig: input.mutationReport.sha256 }
      : {})
  };
}

/**
 * Feed one slice's events to the detector, logging a close→navigate pair as a
 * spurious restart. The pairing state is local to the run: a close with no
 * following navigate logs nothing, and a second navigate in a row clears it.
 */
function recordBrowserEvents(
  detector: BrowserRestartDetector,
  logger: BrowserEventLogger,
  events: readonly BrowserEvent[],
  sessionId: string
): void {
  let pendingCloseTs: string | null = null;
  for (const ev of events) {
    detector.record(ev);
    if (ev.tool === 'browser_close') {
      pendingCloseTs = ev.ts;
    } else if (ev.tool === 'browser_navigate' && pendingCloseTs !== null) {
      const deltaMs = Date.parse(ev.ts) - Date.parse(pendingCloseTs);
      logger.append({
        kind: 'spurious_restart',
        ts: ev.ts,
        sessionId,
        closeTs: pendingCloseTs,
        navigateTs: ev.ts,
        deltaMs
      });
      pendingCloseTs = null;
    } else if (ev.tool === 'browser_navigate') {
      pendingCloseTs = null;
    }
  }
}

function browserGateStatus(
  browserEnabled: boolean,
  detector: BrowserRestartDetector
): QaGateStatus {
  if (!browserEnabled) {
    return { name: 'browser-e2e', status: 'skipped', reason: '--no-browser' };
  }
  return detector.shouldHalt()
    ? { name: 'browser-e2e', status: 'failed', reason: detector.diagnostic() }
    : { name: 'browser-e2e', status: 'passed' };
}

/**
 * Plan 2 / Task 8 — MUT.sig gate.
 * Gate semantics (per spec lines 1292-1341):
 *   - `skipped` when peaks-mut was not run (no report) OR --no-mutation
 *   - `passed`  when the report's `thresholds.passed` is true
 *   - `failed`  when the report's `thresholds.passed` is false
 * "Skipped" is NOT a failure — the gate is a no-op so existing sessions that
 * have not yet adopted peaks-mut keep passing.
 */
function mutationGateStatus(input: RunQaSliceInput): QaGateStatus {
  if (!input.mutationEnabled) {
    return { name: 'mutation', status: 'skipped', reason: '--no-mutation' };
  }
  const report = input.mutationReport;
  if (report === null) {
    return { name: 'mutation', status: 'skipped', reason: 'peaks mut not run' };
  }
  return report.thresholds.passed
    ? { name: 'mutation', status: 'passed', mutSig: report.sha256 }
    : {
        name: 'mutation',
        status: 'failed',
        reason: deriveMutationFailureReason(report),
        mutSig: report.sha256
      };
}

/**
 * Plan 2 / Task 8 — pure helper that explains WHY the mutation gate
 * failed. Used only when the report's `thresholds.passed` is false.
 * Reads the threshold block from the report itself (already
 * CLI-computed by `buildMutReport`) so the message matches what
 * peaks-mut's CLI surface prints.
 */
function deriveMutationFailureReason(report: MutReportJson): string {
  const t = report.thresholds;
  const fragments: string[] = [];
  if (report.mutation.killRate < t.mutationKillRateMin) {
    fragments.push(
      `mutation kill rate ${report.mutation.killRate.toFixed(2)} < ${t.mutationKillRateMin.toFixed(2)}`
    );
  }
  if (report.assertions.weakRate > t.weakAssertionRateMax) {
    fragments.push(
      `weak assertion rate ${report.assertions.weakRate.toFixed(2)} > ${t.weakAssertionRateMax.toFixed(2)}`
    );
  }
  if (fragments.length === 0) {
    return `mutation thresholds failed (MUT.sig=${report.sha256})`;
  }
  return `${fragments.join('; ')} (MUT.sig=${report.sha256})`;
}
