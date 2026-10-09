// `peaks code context-now` — the read-only context-fill probe the hooks and the
// skill runbooks treat as the single source of truth for the ratio.
import type { Command } from 'commander';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import {
  readJobShapeDecision,
  JobShapeDecisionError
} from '../../services/code/job-shape-decision.js';
import { resolveOuterSessionId } from '../../services/session/binding-status-service.js';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { readActiveSid } from './code-runtime-session.js';
import {
  buildContextNowData,
  buildContextNowNextActions,
  buildContextNowWarnings,
  readContextNowHarness,
  resolveContextNowDecision
} from './code-context-now-envelope.js';

const CONTEXT_NOW_DESCRIPTION =
  "v2.13.0 AC-1: read the active IDE adapter's context-fill % " +
  'without requiring the LLM to pass --prompt-size <bytes> manually. ' +
  'Adapter-driven (no hard-coded IDE names): Claude Code is the MVP ' +
  'implementation; trae / codex / cursor / qoder / tongyi-lingma / ' +
  'hermes / openclaw register their own env-var via IdeAdapter.compact. ' +
  "v3.1.2 / 2026-09-12: the mode's pre-compact line emits " +
  'action=auto-compact-now (MANDATORY, single-rid included) and ' +
  'the red line emits action=red-line (the installed PreToolUse hook re-runs ' +
  'this command on the next Bash/Task tool call; nothing is blocked). ' +
  '--enforce-job-mode only changes the reported `jobMode` label; ' +
  'the thresholds are identical. ' +
  'Context-window override: set env PEAKS_CONTEXT_WINDOW_TOKENS=<positive int> ' +
  'or `peaks config set --key context.windowTokens --value <positive int>`; ' +
  'the JSON envelope reports the winning layer as capacitySource ' +
  '(env-override | config | model-heuristic | default).';

interface ContextNowOpts {
  project: string;
  sessionId?: string;
  enforceJobMode?: boolean;
  promptSize?: string;
  json?: boolean;
}

/**
 * The two flags the action derives before any probe: the `--prompt-size`
 * override (guarded) and the Job-mode label. Pure in `opts` — no ordering
 * dependency on the call site.
 */
function resolveContextNowFlags(opts: ContextNowOpts): {
  promptSizeBytes: number | undefined;
  isJobMode: boolean;
} {
  // guard rejects non-finite / negative values; only finite
  // non-negative numbers reach the reader. Undefined → no override.
  let promptSizeBytes: number | undefined;
  if (opts.promptSize !== undefined) {
    const parsed = Number(opts.promptSize);
    if (Number.isFinite(parsed) && parsed >= 0) {
      promptSizeBytes = parsed;
    }
  }
  // v3.1.2: detect Job mode from job-shape.json when --enforce-job-mode
  // is not explicitly passed. The LLM is the source of truth for
  // whether the request is Job-shaped; the recorded decision is.
  let isJobMode = opts.enforceJobMode === true;
  if (!isJobMode) {
    try {
      const sessionIdForDecision = opts.sessionId ?? readActiveSid(opts.project);
      if (sessionIdForDecision !== null) {
        const record = readJobShapeDecision(opts.project, sessionIdForDecision);
        if (record.decision.isJob) isJobMode = true;
      }
    } catch (err) {
      if (!(err instanceof JobShapeDecisionError)) throw err;
      // missing/malformed decision file is fine — fall back to advisory.
    }
  }
  return { promptSizeBytes, isJobMode };
}

/** The catch branch, lifted verbatim out of the action body. */
function reportContextNowFailure(io: ProgramIO, err: unknown, json?: boolean): void {
  printResult(
    io,
    fail('code.context-now', 'CONTEXT_NOW_FAILED', getErrorMessage(err), null, [
      'Verify the project path and try again'
    ]),
    json
  );
  process.exitCode = 1;
}

/** The action body, lifted to a module-level function so both it and the registrar fit in 50 lines. */
async function runCodeContextNow(opts: ContextNowOpts, io: ProgramIO): Promise<void> {
  try {
    const { readContextPercent } = await import('../../services/context/auto-compact-reader.js');
    const flags = resolveContextNowFlags(opts);
    const sessionId = opts.sessionId ?? readActiveSid(opts.project) ?? 'unknown';
    const outerSessionId = resolveOuterSessionId(opts.project, sessionId);
    const probe = readContextPercent({
      projectRoot: opts.project,
      sessionId,
      outerSessionId,
      env: process.env,
      promptSizeBytes: flags.promptSizeBytes
    });
    // Promote `--project .` (what the PreToolUse hook passes) to the git
    // root ONCE, for both of the consumers below: the settings path the
    // harness window is written to, and the session directory the witness
    // is read from, must not depend on the caller's cwd — and an absolute
    // path is what the envelope then reports back to the operator. This
    // resolves through `git rev-parse --show-toplevel`, i.e. a whole
    // process spawn (measured 2026-09-14: med 111.8 ms per call on this
    // host), so calling it twice with the same argument charged the witness
    // read it precedes — 0.027 ms — roughly 4,000x its own cost.
    const canonicalProjectRoot = resolveCanonicalProjectRoot(opts.project);
    const harness = readContextNowHarness(canonicalProjectRoot, sessionId, outerSessionId, probe);
    const decision = resolveContextNowDecision(canonicalProjectRoot, probe.ratio, flags.isJobMode);
    printResult(
      io,
      ok(
        'code.context-now',
        buildContextNowData({
          probe,
          ratioPct: (probe.ratio * 100).toFixed(1),
          isJobMode: flags.isJobMode,
          promptSizeBytes: flags.promptSizeBytes,
          decision,
          harness
        }),
        buildContextNowWarnings(harness),
        buildContextNowNextActions(decision, harness)
      ),
      // `true`, which made the declared `--json` flag a no-op and left the
      // human with raw JSON and no `next:` lines — so a person running this
      // command could not see that peaks-loop had just written their
      // harness settings. The notices above (including the key, the value
      // and the rollback command) are `nextActions`, which `printResult`
      // prints as `next: …` lines ONLY in the non-JSON path. Honoring the
      // flag is what puts them in front of a human. See the consumer audit
      // in the slice's RD artifact: every in-repo caller (the PreToolUse
      // hooks, `orchestrator-can-do`, the skill runbooks) passes `--json`
      // explicitly, so their byte-for-byte output is unchanged.
      opts.json === true
    );
  } catch (err) {
    reportContextNowFailure(io, err, opts.json);
  }
}

export function registerCodeContextNowCommand(code: Command, io: ProgramIO): void {
  addJsonOption(
    code
      .command('context-now')
      .description(CONTEXT_NOW_DESCRIPTION)
      .requiredOption('--project <path>', 'target project root')
      .option('--session-id <sid>', 'override session id (default: read from active presence)')
      .option(
        '--enforce-job-mode',
        'v3.1.2: label the run as Job-shaped (jobMode=true). Auto-enabled when job-shape.json says isJob=true. Since 2026-09-12 the ≥0.85 MANDATORY auto-compact applies in single-rid mode too, so this flag no longer changes any action.'
      )
      .option(
        '--prompt-size <bytes>',
        'override the bytes-from-env path; takes priority over env / statusline / transcript. Useful when CLAUDE_CONTEXT_USAGE_PERCENT is absent (e.g. Mac Claude Code).'
      )
  ).action((opts: ContextNowOpts) => runCodeContextNow(opts, io));
}
