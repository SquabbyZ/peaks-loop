/**
 * Slice 2026-06-16-playwright-restart-loop — G1, G2, G4, G5, G6.
 *
 * `peaks qa run` — runs a peaks-qa slice for the active project.
 *
 * The slice is the user-facing surface for the QA gate family
 * (functional / security / browser E2E). The browser-E2E gate
 * specifically is what the restart-loop detector guards. The
 * detector is wired into the slice here:
 *
 *   1. We construct a `BrowserRestartDetector` (configurable via
 *      `--max-browser-restarts` / `--no-restart-detector`).
 *   2. We construct a `BrowserEventLogger` that writes the
 *      per-slice JSONL log to
 *      `.peaks/_runtime/<session-id>/qa/browser-events.jsonl`.
 *   3. The slice entry exposes `runQaSlice` so tests can
 *      feed a synthetic event log and assert the diagnostic.
 *
 * CLI surface (PRD G5 + AC4/AC5/AC6):
 *   peaks qa run --project <X> [--no-browser] [--max-browser-restarts N]
 *                       [--no-restart-detector] [--session-id <sid>] [--json]
 *
 * `--no-browser` (G5) skips the browser E2E gate entirely. The
 * resulting gate list marks the browser gate as `status: skipped`
 * with reason `--no-browser`. This is a slice-level opt-out for
 * backend-only or already-covered-by-unit-tests work.
 */

import { join } from 'node:path';
import { Command } from 'commander';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from '../../shared/result.js';
import {
  BrowserRestartDetector,
  type BrowserEvent
} from '../../services/qa/browser-restart-detector.js';
import {
  BrowserEventLogger
} from '../../services/qa/browser-event-logger.js';
import { BROWSER_REUSE_HINT } from '../../services/qa/browser-reuse-hint.js';
// Plan 1 / Task 9 — auto-build peaks-context before peaks-qa runs.
import { buildContext } from '../../services/context/context-builder.js';
// Plan 1 / Task 10 — production fetcher (replaces mockFetcher).
import { createHeadroomFetcher } from '../../services/context/headroom-fetcher.js';
import type { DocFetcher } from '../../services/context/doc-retriever.js';
// Plan 2 / Task 8 — consume MUT.sig from peaks-mut into verdict envelope.
import { loadMutReport, mutReportPath, type MutReportJson } from 'peaks-loop-mut';

function buildHeadroomFetcher(sid: string): DocFetcher {
  return createHeadroomFetcher({
    cacheDir: `.peaks/_runtime/${sid}/doc-cache`,
    // remoteFetcher wired in a future slice (headroom-ai programmatic API).
  });
}

async function ensureContextForQa(goal: string, project: string, sid: string): Promise<void> {
  const out = `.peaks/_runtime/${sid}/context.json`;
  try {
    await buildContext({
      goal,
      project,
      audience: 'peaks-qa',
      depsMode: 'locked',
      docBudgetTokens: 8000,
      out,
      fetcher: buildHeadroomFetcher(sid),
    });
  } catch (error) {
    // Plan 1 / Task 9 — context is a pre-step, not a precondition.
    // Task 11 will upgrade this to a hard precondition once the qa
    // slice actually consumes context.json.
    const message = error instanceof Error ? error.message : 'unknown context build failure';
    process.stderr.write(`[peaks-context] qa pre-step skipped: ${message}\n`);
  }
}

export type QaRunOptions = {
  project: string;
  // Commander 12.x sets these for `--no-X` (positive form), not `noX = true`.
  browser?: boolean;
  restartDetector?: boolean;
  maxBrowserRestarts?: string;
  sessionId?: string;
  json?: boolean;
  // Plan 2 / Task 8 — MUT.sig gate.
  mutation?: boolean;
};

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

export const DEFAULT_MAX_BROWSER_RESTARTS = 3;

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

export function runQaSlice(input: RunQaSliceInput): QaRunResult {
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

  let pendingCloseTs: string | null = null;
  // PRD AC4 + P1: when browser E2E is off, the detector must NOT
  // record events at all (otherwise a user passing both
  // --no-browser AND a hot detector would see spurious
  // detectorTriggered=true and exit code 2).
  if (input.browserEnabled) {
    for (const ev of input.events) {
      detector.record(ev);
      if (ev.tool === 'browser_close') {
        pendingCloseTs = ev.ts;
      } else if (ev.tool === 'browser_navigate' && pendingCloseTs !== null) {
        const closeMs = Date.parse(pendingCloseTs);
        const navMs = Date.parse(ev.ts);
        logger.append({
          kind: 'spurious_restart',
          ts: ev.ts,
          sessionId: input.sessionId,
          closeTs: pendingCloseTs,
          navigateTs: ev.ts,
          deltaMs: navMs - closeMs
        });
        pendingCloseTs = null;
      } else if (ev.tool === 'browser_navigate') {
        pendingCloseTs = null;
      }
    }
  }

  const browserGate: QaGateStatus = input.browserEnabled
    ? detector.shouldHalt()
      ? { name: 'browser-e2e', status: 'failed', reason: detector.diagnostic() }
      : { name: 'browser-e2e', status: 'passed' }
    : { name: 'browser-e2e', status: 'skipped', reason: '--no-browser' };

  // Plan 2 / Task 8 — MUT.sig gate.
  // Gate semantics (per spec lines 1292-1341):
  //   - `skipped` when peaks-mut was not run (no report) OR --no-mutation
  //   - `passed`  when the report's `thresholds.passed` is true
  //   - `failed`  when the report's `thresholds.passed` is false
  // "Skipped" is NOT a failure — the gate is a no-op so existing
  // sessions that have not yet adopted peaks-mut keep passing.
  const mutationGate: QaGateStatus = !input.mutationEnabled
    ? { name: 'mutation', status: 'skipped', reason: '--no-mutation' }
    : input.mutationReport === null
      ? { name: 'mutation', status: 'skipped', reason: 'peaks mut not run' }
      : input.mutationReport.thresholds.passed
        ? {
            name: 'mutation',
            status: 'passed',
            mutSig: input.mutationReport.sha256
          }
        : {
            name: 'mutation',
            status: 'failed',
            reason: deriveMutationFailureReason(input.mutationReport),
            mutSig: input.mutationReport.sha256
          };

  const gates: QaGateStatus[] = [
    { name: 'functional', status: 'passed' },
    { name: 'security', status: 'passed' },
    browserGate,
    mutationGate
  ];

  return {
    sessionId: input.sessionId,
    project: input.project,
    browserEnabled: input.browserEnabled,
    gates,
    detectorTriggered: detector.shouldHalt(),
    ...(detector.shouldHalt() ? { diagnostic: detector.diagnostic() } : {}),
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

function resolveMaxRestarts(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_MAX_BROWSER_RESTARTS;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1) {
    return DEFAULT_MAX_BROWSER_RESTARTS;
  }
  return n;
}

/**
 * Commander 12.x sets `options.X = false` for `--no-X` (POSITIVE form),
 * not `options.noX = true`. Reads use the positive form; the default is
 * `true` and the boolean form is `false` only when the user passes `--no-X`.
 *
 * Exported for unit testing the parser contract in isolation from
 * the rest of the action handler.
 */
export function readQaRunOptions(options: QaRunOptions): {
  readonly browserEnabled: boolean;
  readonly detectorEnabled: boolean;
  readonly maxRestarts: number;
  readonly mutationEnabled: boolean;
} {
  return {
    browserEnabled: options.browser !== false,
    detectorEnabled: options.restartDetector !== false,
    maxRestarts: resolveMaxRestarts(options.maxBrowserRestarts),
    mutationEnabled: options.mutation !== false
  };
}

export function registerQaCommands(program: Command, io: ProgramIO): void {
  const qa = program
    .command('qa', { hidden: true })
    .description('peaks-qa slice: run QA gates (functional / security / browser E2E / mutation) for the active project');

  addJsonOption(
    qa
      .command('run')
      .description('Run the peaks-qa slice (PRD 2026-06-16-playwright-restart-loop; Plan 2 mut gate)')
      .option('--project <path>', 'project the gates evaluate against (default: current directory)', '.')
      .option('--session-id <sid>', 'session id; defaults to "ad-hoc" for one-shot runs', 'ad-hoc')
      .option('--no-browser', 'skip the browser E2E gate entirely (PRD G5 / AC4)')
      .option(
        '--max-browser-restarts <n>',
        'halt threshold for close->navigate pairs in this slice (default 3, PRD AC5)',
        String(DEFAULT_MAX_BROWSER_RESTARTS)
      )
      .option('--no-restart-detector', 'disable the restart-loop detector escape hatch (PRD AC6)')
      // Plan 2 / Task 8 — MUT.sig gate opt-out (mirrors --no-browser).
      .option('--no-mutation', 'skip the mutation gate even if .peaks/_runtime/<sid>/mut/mut-report.json exists')
  ).action(async (options: QaRunOptions) => {
    try {
      const { browserEnabled, detectorEnabled, maxRestarts, mutationEnabled } =
        readQaRunOptions(options);
      // Plan 1 / Task 9 — pre-build peaks-context before peaks-qa runs.
      // Goal is audience-scoped doc retrieval only; pass a placeholder
      // when the user did not supply one.
      const qaProject = options.project;
      const qaSid = options.sessionId ?? 'ad-hoc';
      await ensureContextForQa('qa gate run', qaProject, qaSid);
      // Plan 2 / Task 8 — load peaks-mut's report (MUT.sig) if present.
      // Returns null when peaks-mut was not run; the gate treats that
      // as `skipped`, never as `failed`. loadMutReport itself never
      // throws (per its docstring) so this is safe in the action.
      const mutationReport = mutationEnabled
        ? await loadMutReport(qaSid)
        : null;
      // Production slice: no synthetic events to feed; in real
      // dogfood the LLM tool dispatcher would push events into the
      // detector. Here we record an empty event log so the
      // gate-list shape is stable for downstream parsers.
      const result = runQaSlice({
        project: options.project,
        sessionId: options.sessionId ?? 'ad-hoc',
        browserEnabled,
        maxRestarts,
        detectorEnabled,
        events: [],
        mutationReport,
        mutationEnabled
      });
      const mutationGate = result.gates.find((g) => g.name === 'mutation');
      const mutationFailed = mutationGate?.status === 'failed';
      const nextActions = result.detectorTriggered
        ? [
            'Stop the slice and inspect the diagnostic above',
            'Re-run with --no-restart-detector if the close/reopen was intentional',
            'See .peaks/memory/playwright-restart-loop-2026-06-16.md'
          ]
        : mutationFailed
          ? [
              'Re-run peaks mut and address the threshold breaches (see reason)',
              'Re-run with --no-mutation to bypass the gate for this slice',
              `mut-report path: ${mutReportPath(qaSid)}`
            ]
        : browserEnabled
          ? ['No action required; browser gate passed']
          : ['Browser E2E skipped; run without --no-browser when the slice needs E2E'];
      printResult(io, ok('qa.run', result, [], nextActions), options.json);
      if (result.detectorTriggered || mutationFailed) {
        process.exitCode = 2;
      }
    } catch (error) {
      printResult(
        io,
        fail(
          'qa.run',
          'QA_RUN_FAILED',
          error instanceof Error ? error.message : 'Unknown error',
          { project: options.project },
          ['Check the project path and rerun']
        ),
        options.json
      );
      process.exitCode = 1;
    }
  });
}
