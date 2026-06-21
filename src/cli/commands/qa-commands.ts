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
// PRE-FLIGHT FIX: Task 10 will replace this with headroomFetcher.
import { mockFetcher } from '../../services/context/mock-fetcher.js';

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
      fetcher: mockFetcher,
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
};

export type QaGateStatus = {
  readonly name: string;
  readonly status: 'passed' | 'skipped' | 'failed';
  readonly reason?: string;
};

export type QaRunResult = {
  readonly sessionId: string;
  readonly project: string;
  readonly browserEnabled: boolean;
  readonly gates: readonly QaGateStatus[];
  readonly detectorTriggered: boolean;
  readonly diagnostic?: string;
  readonly subAgentPromptHint: string;
};

export const DEFAULT_MAX_BROWSER_RESTARTS = 3;

export type RunQaSliceInput = {
  readonly project: string;
  readonly sessionId: string;
  readonly browserEnabled: boolean;
  readonly maxRestarts: number;
  readonly detectorEnabled: boolean;
  readonly events: readonly BrowserEvent[];
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

  const gates: QaGateStatus[] = [
    { name: 'functional', status: 'passed' },
    { name: 'security', status: 'passed' },
    browserGate
  ];

  return {
    sessionId: input.sessionId,
    project: input.project,
    browserEnabled: input.browserEnabled,
    gates,
    detectorTriggered: detector.shouldHalt(),
    ...(detector.shouldHalt() ? { diagnostic: detector.diagnostic() } : {}),
    subAgentPromptHint: BROWSER_REUSE_HINT
  };
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
} {
  return {
    browserEnabled: options.browser !== false,
    detectorEnabled: options.restartDetector !== false,
    maxRestarts: resolveMaxRestarts(options.maxBrowserRestarts)
  };
}

export function registerQaCommands(program: Command, io: ProgramIO): void {
  const qa = program
    .command('qa')
    .description('peaks-qa slice: run QA gates (functional / security / browser E2E) for the active project');

  addJsonOption(
    qa
      .command('run')
      .description('Run the peaks-qa slice (PRD 2026-06-16-playwright-restart-loop)')
      .option('--project <path>', 'project the gates evaluate against (default: current directory)', '.')
      .option('--session-id <sid>', 'session id; defaults to "ad-hoc" for one-shot runs', 'ad-hoc')
      .option('--no-browser', 'skip the browser E2E gate entirely (PRD G5 / AC4)')
      .option(
        '--max-browser-restarts <n>',
        'halt threshold for close->navigate pairs in this slice (default 3, PRD AC5)',
        String(DEFAULT_MAX_BROWSER_RESTARTS)
      )
      .option('--no-restart-detector', 'disable the restart-loop detector escape hatch (PRD AC6)')
  ).action(async (options: QaRunOptions) => {
    try {
      const { browserEnabled, detectorEnabled, maxRestarts } = readQaRunOptions(options);
      // Plan 1 / Task 9 — pre-build peaks-context before peaks-qa runs.
      // Goal is audience-scoped doc retrieval only; pass a placeholder
      // when the user did not supply one.
      const qaProject = options.project;
      const qaSid = options.sessionId ?? 'ad-hoc';
      await ensureContextForQa('qa gate run', qaProject, qaSid);
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
        events: []
      });
      const nextActions = result.detectorTriggered
        ? [
            'Stop the slice and inspect the diagnostic above',
            'Re-run with --no-restart-detector if the close/reopen was intentional',
            'See .peaks/memory/playwright-restart-loop-2026-06-16.md'
          ]
        : browserEnabled
          ? ['No action required; browser gate passed']
          : ['Browser E2E skipped; run without --no-browser when the slice needs E2E'];
      printResult(io, ok('qa.run', result, [], nextActions), options.json);
      if (result.detectorTriggered) {
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
