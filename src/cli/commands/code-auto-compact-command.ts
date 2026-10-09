// `peaks code auto-compact` — the zero-human-intervention compact dispatch.
import type { Command } from 'commander';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail } from 'peaks-loop-shared/result';
import { runAutoCompact } from '../../services/code/auto-compact-orchestrator.js';
import type { AutoCompactMode } from '../../services/code/auto-compact-modes.js';
import { probeInFlightBatch } from '../../services/workflow/workflow-inflight-probe.js';
import { readActiveSid } from './code-runtime-session.js';
import { buildAutoCompactEnvelope } from './code-auto-compact-envelope.js';

const AUTO_COMPACT_DESCRIPTION =
  'v2.13.0 AC-4: zero-human-intervention auto-compact. Probes current ' +
  'context-fill % via the active IDE adapter; ≥ 0.85 writes a pre-compact ' +
  'checkpoint + convergence plan + auto-decisions log; ≥ 0.95 ASKS the ' +
  'harness to compact and reports that it is waiting for it — no ratio ' +
  'blocks sub-agent dispatch, because peaks-loop has no way to compact a ' +
  'running session and a gate nobody can satisfy gates nothing. The LLM / ' +
  'runner keeps working at any ratio without human intervention. Pair with `peaks code ' +
  'context-now` (AC-1), the read-only probe that reports the ratio this ' +
  'command acts on. This command is also fired by the installed ' +
  'PreToolUse hook, which passes `--project .` — without that argument ' +
  'the hook could never run at all. rid-027 ' +
  'adds `--mode <mode>`: `standard` (0.85/0.95) or `partial` (0.70/0.85 ' +
  'for 24h long-run mode).';

interface AutoCompactOpts {
  project: string;
  sessionId?: string;
  inFlightBatch?: boolean;
  force?: boolean;
  bypassRedLine?: boolean;
  mode?: string;
  json?: boolean;
}

/** The invalid-`--mode` branch, lifted verbatim out of the action body. */
function reportInvalidAutoCompactMode(io: ProgramIO, modeName: string, json?: boolean): void {
  printResult(
    io,
    fail(
      'code.auto-compact',
      'AUTO_COMPACT_INVALID_MODE',
      `Invalid --mode '${modeName}'. Valid values: standard | partial.`,
      null,
      ['Re-run with --mode standard or --mode partial.']
    ),
    json
  );
  process.exitCode = 1;
}

/**
 * The `runAutoCompact` input object, lifted verbatim: it reads only its two
 * parameters, so it has no ordering dependency on the call site.
 */
function buildAutoCompactInput(opts: AutoCompactOpts, modeName: AutoCompactMode) {
  // Slice 4.0.8 (D4d): production `inFlightBatch` MUST come from
  // the workflow graph probe. The legacy `--in-flight-batch`
  // boolean CLI flag is a TEST-ONLY seam (gated by
  // `PEAKS_TEST_SEAM === '1'`). When the env flag is unset
  // (the production case), we wire `probeInflightBatch` to the
  // canonical `workflow-inflight-probe.ts` service so the
  // production decision is graph-backed, not lease-age.
  const isTestSeam = process.env.PEAKS_TEST_SEAM === '1';
  return {
    projectRoot: opts.project,
    sessionId: opts.sessionId ?? readActiveSid(opts.project) ?? undefined,
    ...(isTestSeam && opts.inFlightBatch === true
      ? { inFlightBatch: { hasInFlightBatch: true } }
      : {}),
    ...(!isTestSeam
      ? {
          probeInflightBatch: () => {
            // Synchronous probe: the workflow-inflight-probe
            // service is pure / synchronous (no I/O). The
            // empty `graphs` array is the production CLI
            // default — callers that want a richer fixture
            // (e.g. `peaks session 24h-mode`) should hand-roll
            // a probe and pass it via the orchestrator's
            // input. When no graph is materialized, the
            // probe returns `inFlightBatch: false`, matching
            // the 4.0.7 zero-pause contract for stock
            // projects.
            const out = probeInFlightBatch({ now: new Date().toISOString(), graphs: [] });
            return out.inFlightBatch === true;
          }
        }
      : {}),
    force: opts.force === true,
    bypassRedLine: opts.bypassRedLine === true,
    // Forward the FLAG verbatim — `undefined` when the user named no
    // mode — so the orchestrator's fallback to the presence-derived
    // mode can actually run. Forwarding the validated `modeName` is
    // what disabled 24h → partial.
    mode: opts.mode === undefined ? undefined : modeName
  };
}

/** The catch branch, lifted verbatim out of the action body. */
function reportAutoCompactFailure(io: ProgramIO, err: unknown, json?: boolean): void {
  printResult(
    io,
    fail('code.auto-compact', 'AUTO_COMPACT_FAILED', getErrorMessage(err), null, [
      'Verify the project path + session id and try again'
    ]),
    json
  );
  process.exitCode = 1;
}

/** The action body, lifted to a module-level function so both it and the registrar fit in 50 lines. */
async function runAutoCompactAction(opts: AutoCompactOpts, io: ProgramIO): Promise<void> {
  try {
    const { isValidMode } = await import('../../services/code/auto-compact-modes.js');
    const modeName = opts.mode ?? 'standard';
    if (!isValidMode(modeName)) {
      reportInvalidAutoCompactMode(io, modeName, opts.json);
      return;
    }
    const result = await runAutoCompact(buildAutoCompactInput(opts, modeName));
    const code = result.code;
    const exitOk = result.ok || code === 'AUTO_COMPACT_SKIP' || code === 'AUTO_COMPACT_WAIT';
    // Adapt AutoCompactResult → ResultEnvelope so printResult's
    // generic accepts it. The orchestrator envelope carries
    // `data` on success-path and `nextActions` on the error
    // path; surface both directly to the user.
    printResult(io, buildAutoCompactEnvelope(result), opts.json);
    if (!exitOk) process.exitCode = 1;
  } catch (err) {
    reportAutoCompactFailure(io, err, opts.json);
  }
}

export function registerCodeAutoCompactCommand(code: Command, io: ProgramIO): void {
  addJsonOption(
    code
      .command('auto-compact')
      .description(AUTO_COMPACT_DESCRIPTION)
      .requiredOption('--project <path>', 'target project root')
      .option('--session-id <sid>', 'override session id (default: read from active presence)')
      .option('--in-flight-batch', 'defer if a sub-agent batch is in flight (D6.e)')
      .option('--force', 'force compact at any ratio (test seam)')
      // Accepted and inert. There is no longer a 95% gate to skip: peaks-loop
      // cannot compact a running session, so the red line never blocked
      // dispatch and `bypassRedLine` is read by nothing (slice
      // rather than deleted because it is a published CLI surface — deleting it
      // would make an existing caller fail on an unknown option, which is a
      // harder break than a no-op — and because the honest fix here is to stop
      // advertising it, not to change its meaning.
      .option(
        '--bypass-red-line',
        'no-op: the 95% red line no longer gates dispatch, so there is nothing to bypass (accepted for backward compatibility)'
      )
      // No commander default here, deliberately. A declared default makes
      // `opts.mode` permanently defined, which defeats the orchestrator's
      // `input.mode ?? resolveAutoCompactMode(projectRoot)` fallback and
      // silently disables "24h mode auto-selects partial" — the help text
      // below promises it. Absence must stay absent.
      .option(
        '--mode <mode>',
        'auto-compact mode (standard | partial). Default: standard. 24h mode auto-selects partial.'
      )
  ).action((opts: AutoCompactOpts) => runAutoCompactAction(opts, io));
}
