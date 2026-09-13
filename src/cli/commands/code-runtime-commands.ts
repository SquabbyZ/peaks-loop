/**
 * Slice rid-024 — runtime probes: post-compact-detect / auto-compact /
 * context-now / context-audit / gate-step-08 / emit-handoff.
 *
 * Extracted from code-commands.ts (rid-024 split).
 * Owns: 6 sub-commands that read or mutate runtime state.
 * Owns the `readActiveSid` helper (only used by these runtime probes).
 *
 * Slice 2026-09-10-context-audit-and-discipline added `context-audit`
 * (what fills the window, grouped by tool + short input key).
 */

import type { Command } from 'commander';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok, type ResultEnvelope } from 'peaks-loop-shared/result';
import {
  detectPostCompactResume,
  formatPostCompactResumeLogLine
} from '../../services/code/post-compact-detector.js';
import { runAutoCompact, type AutoCompactResult } from '../../services/code/auto-compact-orchestrator.js';
import { auditContext } from '../../services/context/context-audit.js';
import { syncHarnessWindowForProject } from '../../services/context/auto-compact-reader.js';
import { describeHarnessWindowSync, harnessWindowSyncWarning } from '../../services/context/harness-window-config.js';
import {
  describeHarnessWitness,
  readAndCompareHarnessWitness
} from '../../services/context/harness-context-witness.js';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { buildContextAuditHint } from '../../services/context/context-audit-hint.js';
import {
  evaluateStep08,
  STEP_08_BACKUP_REGEX
} from '../../services/code/step-08-gate.js';
import {
  evaluateEmitHandoff,
  JOB_NOT_INITIALIZED,
  JOB_REMAINING_BLOCKED
} from '../../services/code/emit-handoff.js';
import {
  readJobShapeDecision,
  JobShapeDecisionError
} from '../../services/code/job-shape-decision.js';
import { getSkillPresence } from '../../services/skills/skill-presence-service.js';
import { probeInFlightBatch } from '../../services/workflow/workflow-inflight-probe.js';
import { resolveOuterSessionId } from '../../services/session/binding-status-service.js';

/**
 * Adapt `runAutoCompact`'s domain result to a `ResultEnvelope`.
 *
 * Extracted and exported so the CHANNEL each fact chooses can be asserted
 * directly, without a real red-line probe.
 *
 * The harness-window CONFLICT ("peaks-loop divided this ratio by N but the
 * settings file pins M") is a fact about the STATE, not an instruction, so it
 * rides `warnings` — the very channel `peaks code context-now` already puts it
 * on, via the same `harnessWindowSyncWarning`. Before this, the shim hard-coded
 * `warnings: []`, so the identical fact reached a consumer as a sentence inside
 * `nextActions` on this command and as a `warnings` entry on the other one. One
 * fact, two shapes, depending on which of the two syncing commands a consumer
 * happened to read: two parsers for one mechanism.
 *
 * The prose description (`describeHarnessWindowSync`) stays in `nextActions` on
 * BOTH commands — that half is advice ("what to do about it") and both already
 * agree on it.
 */
export function buildAutoCompactEnvelope(result: AutoCompactResult): ResultEnvelope<unknown> {
  const data = 'data' in result ? result.data : null;
  const nextActions = 'nextActions' in result ? result.nextActions : [];
  const warning = harnessWindowSyncWarning(data?.harnessWindow ?? null);
  const warnings = warning === null ? [] : [warning];
  if (result.ok) {
    return ok('code.auto-compact', data ?? {}, warnings, [result.message, ...nextActions]);
  }
  // `fail()` hard-codes `warnings: []`, so the warning is spread back over it —
  // a refused write can disagree with the ratio just as easily on the failure
  // path, and the state does not become less true because the dispatch failed.
  return { ...fail('code.auto-compact', result.code, result.message, data, [...nextActions]), warnings };
}

export function registerCodeRuntimeCommands(code: Command, io: ProgramIO): void {
  addJsonOption(
    code
      .command('post-compact-detect')
      .description(
        'v2.11.0 D7: detect whether the current invocation is a same-day post-compact resume. ' +
          'Auto-resumes (no AskUserQuestion) when the most-recent checkpoint is from today, has a mode field, ' +
          'and the active skill is peaks-code. Falls through to the normal Step 0.7 flow otherwise.'
      )
      .requiredOption('--project <path>', 'target project root')
      .option('--session-id <sid>', 'override session id (default: read from active presence)')
      .option('--active-skill <skill>', 'override active skill (test seam; default: read from presence)')
  ).action(
    async (opts: { project: string; sessionId?: string; activeSkill?: string; json?: boolean }) => {
      try {
        const sessionId = opts.sessionId ?? readActiveSid(opts.project);
        if (sessionId === null) {
          printResult(
            io,
            fail('code.post-compact-detect', 'NO_ACTIVE_SESSION', 'no active session id; pass --session-id or set presence via `peaks skill presence:set peaks-code`', null, ['Re-run with --session-id <sid>']),
            opts.json
          );
          process.exitCode = 1;
          return;
        }
        const probe = await detectPostCompactResume({
          sessionId,
          projectRoot: opts.project,
          activeSkill: opts.activeSkill
        });
        const logLine = formatPostCompactResumeLogLine(probe);
        printResult(
          io,
          ok('code.post-compact-detect', { ...probe, logLine }, [...probe.warnings], [
            probe.shouldAutoResume
              ? `Post-compact match → auto-resume mode=${probe.mode ?? '?'} checkpoint=${probe.checkpointPath ?? '?'}`
              : `No auto-resume: ${probe.reason}`
          ]),
          opts.json
        );
      } catch (err) {
        printResult(
          io,
          fail('code.post-compact-detect', 'POST_COMPACT_DETECT_FAILED', getErrorMessage(err), null, ['Verify the project path and try again']),
          opts.json
        );
        process.exitCode = 1;
      }
    }
  );

  addJsonOption(
    code
      .command('auto-compact')
      .description(
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
          'for 24h long-run mode).'
      )
      .requiredOption('--project <path>', 'target project root')
      .option('--session-id <sid>', 'override session id (default: read from active presence)')
      .option('--in-flight-batch', 'defer if a sub-agent batch is in flight (D6.e)')
      .option('--force', 'force compact at any ratio (test seam)')
      // Accepted and inert. There is no longer a 95% gate to skip: peaks-loop
      // cannot compact a running session, so the red line never blocked
      // dispatch and `bypassRedLine` is read by nothing (slice
      // 2026-09-13-auto-compact-trigger-ownership, T3/A1). The flag is KEPT
      // rather than deleted because it is a published CLI surface — deleting it
      // would make an existing caller fail on an unknown option, which is a
      // harder break than a no-op — and because the honest fix here is to stop
      // advertising it, not to change its meaning.
      .option('--bypass-red-line', 'no-op: the 95% red line no longer gates dispatch, so there is nothing to bypass (accepted for backward compatibility)')
      // No commander default here, deliberately. A declared default makes
      // `opts.mode` permanently defined, which defeats the orchestrator's
      // `input.mode ?? resolveAutoCompactMode(projectRoot)` fallback and
      // silently disables "24h mode auto-selects partial" — the help text
      // below promises it. Absence must stay absent.
      .option('--mode <mode>', 'auto-compact mode (standard | partial). Default: standard. 24h mode auto-selects partial.')
  ).action(
    async (opts: {
      project: string;
      sessionId?: string;
      inFlightBatch?: boolean;
      force?: boolean;
      bypassRedLine?: boolean;
      mode?: string;
      json?: boolean;
    }) => {
      try {
        const { isValidMode } = await import('../../services/code/auto-compact-modes.js');
        const modeName = opts.mode ?? 'standard';
        if (!isValidMode(modeName)) {
          printResult(
            io,
            fail('code.auto-compact', 'AUTO_COMPACT_INVALID_MODE', `Invalid --mode '${modeName}'. Valid values: standard | partial.`, null, ['Re-run with --mode standard or --mode partial.']),
            opts.json
          );
          process.exitCode = 1;
          return;
        }
        // Slice 4.0.8 (D4d): production `inFlightBatch` MUST come from
        // the workflow graph probe. The legacy `--in-flight-batch`
        // boolean CLI flag is a TEST-ONLY seam (gated by
        // `PEAKS_TEST_SEAM === '1'`). When the env flag is unset
        // (the production case), we wire `probeInflightBatch` to the
        // canonical `workflow-inflight-probe.ts` service so the
        // production decision is graph-backed, not lease-age.
        const isTestSeam = process.env.PEAKS_TEST_SEAM === '1';
        const result = await runAutoCompact({
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
                },
              }
            : {}),
          force: opts.force === true,
          bypassRedLine: opts.bypassRedLine === true,
          // Forward the FLAG verbatim — `undefined` when the user named no
          // mode — so the orchestrator's fallback to the presence-derived
          // mode can actually run. Forwarding the validated `modeName` is
          // what disabled 24h → partial.
          mode: opts.mode === undefined ? undefined : modeName
        });
        const code = result.code;
        const exitOk = result.ok || code === 'AUTO_COMPACT_SKIP' || code === 'AUTO_COMPACT_WAIT';
        // Adapt AutoCompactResult → ResultEnvelope so printResult's
        // generic accepts it. The orchestrator envelope carries
        // `data` on success-path and `nextActions` on the error
        // path; surface both directly to the user.
        printResult(io, buildAutoCompactEnvelope(result), opts.json);
        if (!exitOk) process.exitCode = 1;
      } catch (err) {
        printResult(
          io,
          fail('code.auto-compact', 'AUTO_COMPACT_FAILED', getErrorMessage(err), null, [
            'Verify the project path + session id and try again'
          ]),
          opts.json
        );
        process.exitCode = 1;
      }
    }
  );

  addJsonOption(
    code
      .command('context-now')
      .description(
        'v2.13.0 AC-1: read the active IDE adapter\'s context-fill % ' +
          'without requiring the LLM to pass --prompt-size <bytes> manually. ' +
          'Adapter-driven (no hard-coded IDE names): Claude Code is the MVP ' +
          'implementation; trae / codex / cursor / qoder / tongyi-lingma / ' +
          'hermes / openclaw register their own env-var via IdeAdapter.compact. ' +
          'v3.1.2 / 2026-09-12: ≥0.85 emits action=auto-compact-now ' +
          '(MANDATORY in every mode — single-rid included) and ' +
          '≥0.95 emits action=red-line (the installed PreToolUse hook re-runs ' +
          'this command on the next Bash/Task tool call; nothing is blocked). ' +
          '--enforce-job-mode only changes the reported `jobMode` label; ' +
          'the thresholds are identical. ' +
          'Context-window override: set env PEAKS_CONTEXT_WINDOW_TOKENS=<positive int> ' +
          'or `peaks config set --key context.windowTokens --value <positive int>`; ' +
          'the JSON envelope reports the winning layer as capacitySource ' +
          '(env-override | config | model-heuristic | default).'
      )
      .requiredOption('--project <path>', 'target project root')
      .option('--session-id <sid>', 'override session id (default: read from active presence)')
      .option('--enforce-job-mode', 'v3.1.2: label the run as Job-shaped (jobMode=true). Auto-enabled when job-shape.json says isJob=true. Since 2026-09-12 the ≥0.85 MANDATORY auto-compact applies in single-rid mode too, so this flag no longer changes any action.')
      .option('--prompt-size <bytes>', 'override the bytes-from-env path; takes priority over env / statusline / transcript. Useful when CLAUDE_CONTEXT_USAGE_PERCENT is absent (e.g. Mac Claude Code).')
  ).action(
    async (opts: { project: string; sessionId?: string; enforceJobMode?: boolean; promptSize?: string; json?: boolean }) => {
      try {
        const { readContextPercent } = await import('../../services/context/auto-compact-reader.js');
        // rid-002: parse --prompt-size <bytes> defensively. CLI-layer
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
        const sessionId = opts.sessionId ?? readActiveSid(opts.project) ?? 'unknown';
        const outerSessionId = resolveOuterSessionId(opts.project, sessionId);
        const probe = readContextPercent({
          projectRoot: opts.project,
          sessionId,
          outerSessionId,
          env: process.env,
          promptSizeBytes
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
        // Slice 2026-09-13-auto-compact-trigger-ownership (T1 + T2): materialize
        // the window this probe just divided by into the harness's own settings,
        // so "85%" here and the harness's own trigger are one point on one
        // scale. Idempotent (no write when the value is already in force) and a
        // no-op when the probe carried no token window — peaks-loop never
        // invents a number it did not measure.
        const harnessWindow = syncHarnessWindowForProject({
          projectRoot: canonicalProjectRoot,
          env: process.env,
          tokens: probe.capacityTokens ?? null
        });
        // The machine half of 要告知. A refused write is not automatically a
        // non-event: the file may pin a window that disagrees with the one this
        // probe just divided by, and then the ratio above describes a trigger
        // the harness is not going to fire. `nextActions` carries the full
        // sentence; this one line rides `warnings` so a JSON consumer cannot
        // miss it either.
        const harnessWindowWarning = harnessWindowSyncWarning(harnessWindow);
        // Slice 2026-09-13-statusline-window-witness (AC2/AC3): the harness's
        // own number for the same quantity, captured by the statusline. This is
        // OBSERVATION ONLY — it never feeds `verdict` / `action` / any threshold
        // below. A wrong reading here must not be able to fire a compact.
        const harnessWitness = readAndCompareHarnessWitness({
          // The same promoted root as the harness-window write above, for the
          // same reason: the statusline resolves its root from the harness
          // payload (absolute), so a `--project .` from a hook would otherwise
          // look for the witness somewhere else and report `absent` forever.
          projectRoot: canonicalProjectRoot,
          sessionId,
          peaksRatio: probe.ratio,
          peaksTokens: probe.rawTokens ?? null,
          peaksWindowTokens: probe.capacityTokens ?? null,
          outerSessionId: outerSessionId ?? null
        });
        const witnessNotice = describeHarnessWitness(harnessWitness);
        const ratioPct = (probe.ratio * 100).toFixed(1);
        let action: 'ok' | 'soft-warn' | 'auto-compact-now' | 'red-line' = 'ok';
        let next: string | null = null;
        if (probe.ratio >= 0.95) {
          action = 'red-line';
          next = 'peaks code auto-compact';
        } else if (probe.ratio >= 0.85) {
          // Slice 2026-09-12-compact-band-policy (defect A): the
          // 0.85–0.95 band is MANDATORY auto-compact for single-rid
          // sessions too. It used to be downgraded to `soft-warn` here,
          // which contradicted this command's own help text, the
          // `pre-compact` action from `peaks skill presence`, the
          // peaks-code SKILL.md, and the 2026-07-27 user-calibrated
          // threshold policy — and left an LLM that follows the "single
          // source of truth" (`context-now`) never compacting in the
          // zone, violating the zero-pause contract.
          action = 'auto-compact-now';
          next = 'peaks code auto-compact';
        } else if (probe.ratio >= 0.5) {
          action = 'soft-warn';
        }
        const verdict =
          action === 'red-line' ? 'red-line'
            : action === 'auto-compact-now' ? 'pre-compact'
            : action === 'soft-warn' ? 'soft-warn'
            : 'ok';
        // Slice 2026-09-12-compact-band-policy: the two modes no longer
        // differ in behaviour ABOVE 0.50 — both auto-fire at ≥0.85 and
        // both red-line at ≥0.95 — so the old "advisory mode
        // (single-rid)" notice was a lie the moment the downgrade was
        // removed. Job mode's remaining difference is that its threshold
        // policy is recorded up front (`job-shape.json`), which the
        // `jobMode` field already reports. The notice now says only that.
        const gateModeNotice = isJobMode
          ? 'Job mode (job-shape.json isJob=true): the same ≥0.85 / ≥0.95 thresholds apply, and the decision is recorded in job-shape.json.'
          : 'Single-rid mode: the same ≥0.85 / ≥0.95 thresholds apply — ≥0.85 is MANDATORY auto-compact, not advisory.';
        printResult(
          io,
          ok('code.context-now', {
            ratio: probe.ratio,
            ratioPct: `${ratioPct}%`,
            verdict,
            action,
            next,
            jobMode: isJobMode,
            source: probe.source,
            ide: probe.ide,
            capacityBytes: probe.capacityBytes,
            rawBytes: probe.rawBytes ?? null,
            rawTokens: probe.rawTokens ?? null,
            capacityTokens: probe.capacityTokens ?? null,
            // Slice 2026-09-09-context-window-override: which layer produced
            // capacityTokens (env-override | config | model-heuristic |
            // default) — null for byte/percent sources, which have no window.
            capacitySource: probe.capacitySource ?? null,
            bytesPrompt: promptSizeBytes ?? null,
            capturedAt: probe.capturedAt,
            // Slice 2026-09-13-auto-compact-trigger-ownership: what the harness
            // window sync did on this probe. Reported rather than silent — the
            // harness tells a user who overrides the window only via
            // `/autocompact`, so peaks-loop must be the one that says it.
            harnessWindow,
            // Slice 2026-09-13-statusline-window-witness: the second scale.
            harnessWitness
          }, [
            ...(harnessWindowWarning === null ? [] : [harnessWindowWarning]),
            // AC3: the disagreement rides `warnings` — it is a fact about the
            // state, not an instruction — and it is one-way. Never an
            // AskUserQuestion (see .peaks/memory/auto-compact-threshold-policy.md).
            ...(witnessNotice === null ? [] : [witnessNotice])
          ], [
            action === 'red-line'
              ? `RED LINE: ≥ 95%. Next: \`${next}\` — peaks-loop asks the harness to compact and KEEPS WORKING (dispatch is not blocked); re-probe to confirm it landed.`
              : action === 'auto-compact-now'
                ? `MANDATORY auto-compact (≥85%, every mode). Code MUST call \`${next}\` WITHOUT confirmation.`
                : action === 'soft-warn'
                  ? `Soft warn (50–85%). Continue working; the next \`peaks code auto-compact\` will re-check.`
                  : `Below 50%. No action required.`,
            gateModeNotice,
            // Single wording, shared with `peaks code auto-compact` — see
            // `describeHarnessWindowSync`.
            describeHarnessWindowSync(harnessWindow),
            // AC3: the one-way hint that accompanies the `warnings` entry. Both
            // channels carry the SAME fact in the shape each is read for
            // (machine-readable warning vs human/LLM advice) — see
            // `harnessWindowSyncWarning` / `describeHarnessWindowSync` above for
            // the same split, and note this one never asks a question.
            ...(witnessNotice === null
              ? []
              : ['Re-probe with `peaks code context-now` to confirm; this is reported, not blocking.'])
          ]),
          // Slice 2026-09-13-auto-compact-trigger-ownership: was hard-coded
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
        printResult(
          io,
          fail('code.context-now', 'CONTEXT_NOW_FAILED', getErrorMessage(err), null, [
            'Verify the project path and try again'
          ]),
          opts.json
        );
        process.exitCode = 1;
      }
    }
  );

  // Slice 2026-09-10-context-audit-and-discipline (Slice A): visibility into
  // WHAT fills the orchestrator window. `context-now` returns a ratio; this
  // returns the grouped byte breakdown of tool results from the live
  // transcript. Read-only + fail-soft: an unavailable transcript reports
  // `available:false` with a reason and NEVER sets a non-zero exit code.
  addJsonOption(
    code
      .command('context-audit')
      .description(
        'Slice 2026-09-10 Slice A: report what fills the current session\'s ' +
          'context window, grouped by tool + short input key (command line / ' +
          'path tail / pattern), sorted by bytes. Locates the CURRENT session\'s ' +
          'IDE transcript through the active adapter\'s ' +
          '`compact.resolveTranscriptPath` (vendor-neutral); emits total bytes, ' +
          'entry count, and the top-N groups ' +
          '(`{tool, key, bytes, pctOfTotal, count}`). Read-only and fail-soft — ' +
          'a missing/oversized/corrupt transcript returns `available:false` ' +
          'with a reason and never blocks. Never dumps tool result content.'
      )
      .requiredOption('--project <path>', 'target project root')
      .option('--session-id <sid>', 'override session id (default: read from active presence)')
      .option('--top <n>', 'number of top entries to emit (default 15, max 100)', (value: string) => Number(value))
      .option('--transcript <path>', 'override the transcript jsonl path (test seam)')
  ).action(
    (opts: { project: string; sessionId?: string; top?: number; transcript?: string; json?: boolean }) => {
      try {
        // `resolveOuterSessionId` checks the env signal FIRST, so the peaks
        // session id is only a fallback lookup key — mirror context-now's
        // 'unknown' default so an unbound presence still resolves via env.
        const sessionId = opts.sessionId ?? readActiveSid(opts.project) ?? 'unknown';
        const outerSessionId = resolveOuterSessionId(opts.project, sessionId);
        const result = auditContext({
          outerSessionId: outerSessionId ?? null,
          ...(opts.top !== undefined ? { topN: opts.top } : {}),
          ...(opts.transcript !== undefined ? { transcriptPath: opts.transcript } : {}),
        });
        // Fail-soft contract: unavailability is DATA, not an error. The exit
        // code stays 0 so a `context-audit` call can never block a workflow.
        const nextActions = result.available
          ? [`${result.entryCount} tool result(s) across ${result.groupCount} group(s); showing top ${result.entries.length}.`]
          : [`context-audit unavailable: ${result.reason ?? 'unknown'} — continue without it (read-only probe).`];
        printResult(io, ok('code.context-audit', { ...result }, [], nextActions), opts.json);
      } catch (err) {
        printResult(
          io,
          ok('code.context-audit', {
            available: false,
            reason: `audit-failed: ${getErrorMessage(err)}`,
            transcriptPath: null,
            totalBytes: 0,
            entryCount: 0,
            groupCount: 0,
            topN: 0,
            entries: []
          }, [], ['context-audit is a read-only probe; continue without it.']),
          opts.json
        );
      }
    }
  );

  // v3.1.2 Step 0.8 — Mechanical PreToolUse gate.
  // Wire-installed by `peaks workspace init` (extends the existing hook
  // installer). Exit code is the load-bearing contract:
  //   exit 0 → allow (with structured stdout describing the decision)
  //   exit 2 → block (stderr contains the BLOCKED: ... reason)
  addJsonOption(
    code
      .command('gate-step-08')
      .description(
        'v3.1.2: PreToolUse gate for Step 0.8 — allow when job-shape.json exists; ' +
          'fail-closed backup regex when missing. Exit 0 = allow, exit 2 = block. ' +
          'When the decision says isJob=true AND progress.json exists, the stdout ' +
          'also carries `Next: slice #N+1 of M (<currentSlice>)` so the LLM cannot ' +
          'wake up cold. When the context ratio is ≥ 0.70 the stdout gains ONE more ' +
          'line naming the largest context consumer (audit cached ≥ 5 min; fail-soft).'
      )
      .requiredOption('--project <path>', 'target project root (the hook passes "." so resolveCanonicalProjectRoot promotes it to the git root)')
      .option('--session-id <sid>', 'override session id (default: read from active presence)')
      .option('--prompt <text>', 'explicit prompt text (default: read last-prompt.txt; stdin ignored)')
  ).action(
    (opts: { project: string; sessionId?: string; prompt?: string; json?: boolean }) => {
      try {
        const sessionId = opts.sessionId ?? readActiveSid(opts.project);
        if (sessionId === null) {
          // No session binding — treat as allow (single-rid mode). The
          // LLM has not yet anchored; we have nothing to gate against.
          const envelope = ok('code.gate-step-08', {
            allow: true,
            mode: 'no-session',
            decision: null,
            nextSlice: null
          }, [], [
            'No active session id; gate passes through (single-rid mode).'
          ]);
          printResult(io, envelope, opts.json);
          return;
        }
        // Slice 2026-09-10-three-fixes (Slice 2): proactive context-consumer
        // hint. Runs ONLY when the window is ≥ 0.70 full, caches the audit
        // result for ≥ 5 min so the transcript is scanned at most once per
        // TTL window, and is fail-soft (null → no extra line). It never
        // changes the exit code and never blocks.
        const hintLine = buildContextAuditHint({
          projectRoot: opts.project,
          sessionId,
          outerSessionId: resolveOuterSessionId(opts.project, sessionId)
        });
        const hintActions = hintLine === null ? [] : [hintLine];
        const evalInput: { projectRoot: string; sessionId: string; prompt?: string } = {
          projectRoot: opts.project,
          sessionId
        };
        if (opts.prompt !== undefined) evalInput.prompt = opts.prompt;
        const result = evaluateStep08(evalInput);
        const verdict = result.verdict;
        if (verdict.kind === 'allow-job') {
          const envelope = ok('code.gate-step-08', {
            allow: true,
            mode: 'job',
            decision: verdict.decision,
            progress: verdict.progress,
            nextSlice: result.nextSliceLine
          }, [], [...(result.nextSliceLine !== null ? [result.nextSliceLine] : []), ...hintActions]);
          printResult(io, envelope, opts.json);
          return;
        }
        if (verdict.kind === 'allow-single') {
          const envelope = ok('code.gate-step-08', {
            allow: true,
            mode: 'single',
            decision: null,
            nextSlice: null
          }, [], [
            'job-shape.json says isJob=false; single-rid mode (gate allows).',
            ...hintActions
          ]);
          printResult(io, envelope, opts.json);
          return;
        }
        // block-missing-decision
        if (verdict.promptHit) {
          // Block: backup regex hit. Exit code 2 is the load-bearing
          // signal for the PreToolUse hook.
          const blockMessage = 'BLOCKED: prompt looks Job-shaped but peaks code detect-job has not been called. Run `peaks code detect-job --is-job true ...` to record your Job-shape verdict, then retry.';
          const envelope = fail('code.gate-step-08', 'STEP_08_BLOCKED', blockMessage, {
            promptSource: verdict.promptSource,
            backupRegex: STEP_08_BACKUP_REGEX.toString()
          }, [
            'Run `peaks code detect-job --is-job true --rationale <text> --suggested-job-id <slug>` to record the Job-shape verdict.',
            'Then re-run the Bash tool call.',
            ...hintActions
          ]);
          io.stderr(`${blockMessage}\n`);
          printResult(io, envelope, opts.json);
          process.exitCode = 2;
          return;
        }
        // No decision + no regex hit → allow.
        const envelope = ok('code.gate-step-08', {
          allow: true,
          mode: 'undecided-no-regex-hit',
          decision: null,
          nextSlice: null,
          promptSource: verdict.promptSource
        }, [], [
          'No job-shape.json AND no backup-regex match on prompt → allow (most prompts are not Job-shaped).',
          ...hintActions
        ]);
        printResult(io, envelope, opts.json);
        return;
      } catch (err) {
        printResult(
          io,
          fail('code.gate-step-08', 'GATE_STEP_08_FAILED', getErrorMessage(err), null, [
            'Verify the project path and try again'
          ]),
          opts.json
        );
        process.exitCode = 1;
      }
    }
  );

  // v3.1.2 Step 11 / final handoff — Size-fear ban.
  // Refuses to emit a final handoff while a Job has remaining slices.
  addJsonOption(
    code
      .command('emit-handoff')
      .description(
        'v3.1.2 Step 11 size-fear ban: under Job mode, refuse to emit a final ' +
          'handoff while remaining > 0. Exit 0 = allow, exit 1 = block. Pass ' +
          '--force-under-job to override (requires explicit user approval).'
      )
      .requiredOption('--project <path>', 'target project root')
      .option('--session-id <sid>', 'override session id (default: read from active presence)')
      .option('--job-id <jid>', 'override job id (default: read from job-shape.json decision.suggestedJobId)')
      .option('--force-under-job', 'override the remaining>0 block (explicit user approval required)')
  ).action(
    (opts: { project: string; sessionId?: string; jobId?: string; forceUnderJob?: boolean; json?: boolean }) => {
      try {
        const sessionId = opts.sessionId ?? readActiveSid(opts.project);
        if (sessionId === null) {
          const envelope = ok('code.emit-handoff', { allow: true, mode: 'no-session' }, [], [
            'No active session id; gate passes through (single-rid mode).'
          ]);
          printResult(io, envelope, opts.json);
          return;
        }
        const evalInput: { projectRoot: string; sessionId: string; jobId?: string; forceUnderJob?: boolean } = {
          projectRoot: opts.project,
          sessionId
        };
        if (opts.jobId !== undefined) evalInput.jobId = opts.jobId;
        if (opts.forceUnderJob === true) evalInput.forceUnderJob = true;
        const verdict = evaluateEmitHandoff(evalInput);
        if (verdict.kind === 'allow-not-job') {
          const envelope = ok('code.emit-handoff', { allow: true, mode: 'single' }, [], [
            'job-shape.json says isJob=false (or absent); normal handoff allowed.'
          ]);
          printResult(io, envelope, opts.json);
          return;
        }
        if (verdict.kind === 'allow-done') {
          const envelope = ok('code.emit-handoff', { allow: true, mode: 'job-done', remaining: verdict.remaining }, [], [
            `Job is complete (remaining=0); handoff allowed.`
          ]);
          printResult(io, envelope, opts.json);
          return;
        }
        if (verdict.kind === 'allow-force-override') {
          const envelope = ok('code.emit-handoff', { allow: true, mode: 'job-force-override', remaining: verdict.remaining }, [], [
            `Job has ${verdict.remaining} remaining slices; --force-under-job override applied. Handoff allowed (explicit user approval).`
          ]);
          printResult(io, envelope, opts.json);
          return;
        }
        if (verdict.kind === 'block-not-initialized') {
          const envelope = fail('code.emit-handoff', JOB_NOT_INITIALIZED,
            `Job ${verdict.jobId} has no state.json; peaks job init was skipped.`,
            { jobId: verdict.jobId },
            [`Run \`peaks job init --job-id ${verdict.jobId} --slice-list <...>\` before emitting handoff.`]);
          printResult(io, envelope, opts.json);
          process.exitCode = 1;
          return;
        }
        // block-remaining
        const blockMessage = `BLOCKED: Job ${verdict.jobId} has ${verdict.remaining} remaining slices. Run \`peaks job status\`. Use --force-under-job only with explicit user approval.`;
        const envelope = fail('code.emit-handoff', JOB_REMAINING_BLOCKED,
          blockMessage,
          { jobId: verdict.jobId, remaining: verdict.remaining },
          [
            `Run \`peaks job status --job-id ${verdict.jobId}\` to see remaining slices.`,
            'Resume Step 0.81 (per-slice checkpoint loop) and continue until remaining === 0.',
            'Use --force-under-job only with explicit user approval (size-fear ban override).'
          ]);
        io.stderr(`${blockMessage}\n`);
        printResult(io, envelope, opts.json);
        process.exitCode = 1;
        return;
      } catch (err) {
        printResult(
          io,
          fail('code.emit-handoff', 'EMIT_HANDOFF_FAILED', getErrorMessage(err), null, [
            'Verify the project path and try again'
          ]),
          opts.json
        );
        process.exitCode = 1;
      }
    }
  );
}

// Local helper (was `readActiveSid` in code-commands.ts before rid-024 split).
// Only the 5 runtime probes above use it; keeping it local avoids the
// cross-file helper import.
function readActiveSid(projectRoot: string): string | null {
  try {
    const presence = getSkillPresence(projectRoot);
    if (presence === null || presence === undefined) return null;
    return presence.sessionId ?? null;
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }
}