// `peaks code auto-compact` — the zero-human-intervention compact dispatch.
import type { Command } from 'commander';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail } from 'peaks-loop-shared/result';
import { runAutoCompact } from '../../services/code/auto-compact-orchestrator.js';
import {
  normalizeAutoCompactMode,
  type AutoCompactProfile
} from '../../services/code/auto-compact-modes.js';
import { resolveAutoCompactProfile } from '../../services/code/auto-compact-profile.js';
import {
  probeInFlightBatch,
  type ProbeResult
} from '../../services/workflow/workflow-inflight-probe.js';
import { readDispatchLedgerFacts } from '../../services/dispatch/dispatch-ledger-reader.js';
import { readActiveSid } from './code-runtime-session.js';
import { buildAutoCompactEnvelope } from './code-auto-compact-envelope.js';
import {
  describeDeferral,
  withDeferralDetail,
  type DeferralDetail
} from './code-auto-compact-deferral.js';

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
  'adds `--mode <mode>`: `standard` (pre-compact 0.85 / red-line 0.95) ' +
  'or `eager` (pre-compact 0.70 / red-line 0.85 — fires earlier than ' +
  '`standard`). With no `--mode`, the project setting `autoCompactProfile` ' +
  'decides (default `standard`).';

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
      `Invalid --mode '${modeName}'. Valid values: standard | eager. The legacy alias 'partial' is also accepted and means 'eager'.`,
      null,
      ['Re-run with --mode standard or --mode eager.']
    ),
    json
  );
  process.exitCode = 1;
}

/**
 * The probe's last answer, kept so the envelope can report WHICH deferral it was.
 *
 * The decision reads a boolean; the REPORT of the decision needs the reason the
 * probe gave, and the probe is called from inside the orchestrator. This box is
 * where the answer lands on the way out. It carries no decision of its own.
 */
interface ProbeCapture {
  last: ProbeResult | null;
}

/**
 * The `runAutoCompact` input object, lifted verbatim: it reads only its two
 * parameters, so it has no ordering dependency on the call site.
 */
function buildAutoCompactInput(
  opts: AutoCompactOpts,
  modeName: AutoCompactProfile,
  capture: ProbeCapture
) {
  // The in-flight signal comes from the session's DISPATCH LEDGER — the
  // `active-dispatches.json` index and the dispatch records it names. The
  // workflow graphs never carried the fact (a dispatch node sits at
  // `prepared` and no writer stamps a heartbeat onto it), so a graph-backed
  // probe could only ever answer "no" and the deferral was unreachable.
  //
  // The legacy `--in-flight-batch` boolean CLI flag is a TEST-ONLY seam
  // (gated by `PEAKS_TEST_SEAM === '1'`). When the env flag is unset (the
  // production case), we wire `probeInflightBatch` to the canonical
  // `workflow-inflight-probe.ts` service fed by the ledger reader, so the
  // production decision is ledger-backed.
  const isTestSeam = process.env.PEAKS_TEST_SEAM === '1';
  const projectRoot = opts.project;
  return {
    projectRoot,
    sessionId: opts.sessionId ?? readActiveSid(opts.project) ?? undefined,
    ...(isTestSeam && opts.inFlightBatch === true
      ? { inFlightBatch: { hasInFlightBatch: true } }
      : {}),
    ...(!isTestSeam
      ? {
          probeInflightBatch: (sessionId: string) => {
            // Synchronous probe: the reader reads files and the
            // workflow-inflight-probe service is pure / synchronous
            // (no I/O). The reader gathers the ledger's facts and the
            // probe decides from them; the reader/probe boundary is
            // what keeps the decision testable on its own.
            const ledger = readDispatchLedgerFacts({ projectRoot, sessionId });
            const out = probeInFlightBatch({ now: new Date().toISOString(), ledger });
            // The whole answer is kept, not just its boolean: the deferral
            // reports WHICH deferral it was, and the reason is in here.
            capture.last = out;
            return out.inFlightBatch === true;
          }
        }
      : {}),
    force: opts.force === true,
    bypassRedLine: opts.bypassRedLine === true,
    // The profile is resolved ONCE, by the resolver, and handed down
    // explicitly: the CLI flag beats the project setting, and the project
    // setting beats the default. The orchestrator's own fallback reads the
    // same resolver, so the two cannot disagree about which profile is in
    // force.
    mode: modeName
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

/**
 * The deferral's detail — or null when this run did not defer.
 *
 * The code is the gate: `AUTO_COMPACT_WAIT` is the one the orchestrator returns
 * when the in-flight deferral applied. A run that skipped for another reason, or
 * that reached the red line (where the deferral does not apply), carries no
 * detail, because there was no deferral to describe.
 */
function deferralDetail(
  result: Awaited<ReturnType<typeof runAutoCompact>>,
  probe: ProbeResult | null
): DeferralDetail | null {
  if (result.code !== 'AUTO_COMPACT_WAIT') return null;
  if (probe === null) return null;
  return describeDeferral(probe);
}

/** The action body, lifted to a module-level function so both it and the registrar fit in 50 lines. */
async function runAutoCompactAction(opts: AutoCompactOpts, io: ProgramIO): Promise<void> {
  try {
    // `--mode` is normalized ONCE, here: the legacy alias `partial` becomes
    // `eager` before anything is stored, reported or logged, so the alias
    // never reaches the runtime state.
    const cliMode = opts.mode === undefined ? null : normalizeAutoCompactMode(opts.mode);
    if (opts.mode !== undefined && cliMode === null) {
      reportInvalidAutoCompactMode(io, opts.mode, opts.json);
      return;
    }
    const selection = resolveAutoCompactProfile({ projectRoot: opts.project, cliMode });
    const capture: ProbeCapture = { last: null };
    const result = await runAutoCompact(buildAutoCompactInput(opts, selection.profile, capture));
    const code = result.code;
    const exitOk = result.ok || code === 'AUTO_COMPACT_SKIP' || code === 'AUTO_COMPACT_WAIT';
    // Adapt AutoCompactResult → ResultEnvelope so printResult's
    // generic accepts it. The orchestrator envelope carries
    // `data` on success-path and `nextActions` on the error
    // path; surface both directly to the user.
    const envelope = buildAutoCompactEnvelope(result);
    printResult(io, withDeferralDetail(envelope, deferralDetail(result, capture.last)), opts.json);
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
      // `opts.mode` permanently defined, which would defeat the resolver's
      // "project setting → default" fallback — the help text below promises
      // that the project setting decides when no `--mode` is named.
      // Absence must stay absent.
      .option(
        '--mode <mode>',
        'auto-compact mode for THIS call: standard | eager (the legacy alias `partial` is accepted and means `eager`). Default: the project setting `autoCompactProfile`, else standard.'
      )
  ).action((opts: AutoCompactOpts) => runAutoCompactAction(opts, io));
}
