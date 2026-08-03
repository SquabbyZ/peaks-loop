/**
 * Slice rid-024 — runtime probes: post-compact-detect / auto-compact /
 * context-now / gate-step-08 / emit-handoff.
 *
 * Extracted from code-commands.ts (rid-024 split).
 * Owns: 5 sub-commands that read or mutate runtime state.
 * Owns the `readActiveSid` helper (only used by these runtime probes).
 */

import type { Command } from 'commander';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import {
  detectPostCompactResume,
  formatPostCompactResumeLogLine
} from '../../services/code/post-compact-detector.js';
import { runAutoCompact } from '../../services/code/auto-compact-orchestrator.js';
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
          'checkpoint + convergence plan + auto-decisions log; ≥ 0.95 forces ' +
          'synchronous IDE-side compact. The LLM / runner keeps working with ' +
          'context < 95% without human intervention. pair with `peaks context ' +
          'now` (AC-1) which feeds the ratio into this command. rid-027 ' +
          'adds `--mode <mode>`: `standard` (0.85/0.95) or `partial` (0.70/0.85 ' +
          'for 24h long-run mode).'
      )
      .requiredOption('--project <path>', 'target project root')
      .option('--session-id <sid>', 'override session id (default: read from active presence)')
      .option('--in-flight-batch', 'defer if a sub-agent batch is in flight (D6.e)')
      .option('--force', 'force compact at any ratio (test seam)')
      .option('--bypass-red-line', 'skip the 95% red-line gate (test seam; never true in production)')
      .option('--mode <mode>', 'auto-compact mode (standard | partial). Default: standard. 24h mode auto-selects partial.', 'standard')
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
          mode: modeName
        });
        const code = result.code;
        const exitOk = result.ok || code === 'AUTO_COMPACT_SKIP' || code === 'AUTO_COMPACT_WAIT';
        // Adapt AutoCompactResult → ResultEnvelope so printResult's
        // generic accepts it. The orchestrator envelope carries
        // `data` on success-path and `nextActions` on the error
        // path; surface both directly to the user.
        const data = 'data' in result ? result.data : null;
        const nextActions = 'nextActions' in result ? result.nextActions : [];
        const envelope = result.ok
          ? ok(`code.auto-compact`, data ?? {}, [], [result.message, ...nextActions])
          : fail(`code.auto-compact`, code, result.message, data, [...nextActions]);
        printResult(io, envelope, opts.json);
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
          'v3.1.2: when --enforce-job-mode is set OR job-shape.json says isJob=true, ' +
          '≥0.85 emits action=auto-compact-now (MANDATORY, not advisory) and ' +
          '≥0.95 emits action=red-line (forced hook fires next turn).'
      )
      .requiredOption('--project <path>', 'target project root')
      .option('--session-id <sid>', 'override session id (default: read from active presence)')
      .option('--enforce-job-mode', 'v3.1.2: treat ≥0.85 as MANDATORY auto-compact (not advisory). Auto-enabled when job-shape.json says isJob=true.')
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
        const probe = readContextPercent({
          projectRoot: opts.project,
          sessionId: opts.sessionId ?? readActiveSid(opts.project) ?? 'unknown',
          env: process.env,
          promptSizeBytes
        });
        const ratioPct = (probe.ratio * 100).toFixed(1);
        let action: 'ok' | 'soft-warn' | 'auto-compact-now' | 'red-line' = 'ok';
        let next: string | null = null;
        if (probe.ratio >= 0.95) {
          action = isJobMode ? 'red-line' : 'red-line';
          next = 'peaks compact auto --execute';
        } else if (probe.ratio >= 0.85) {
          if (isJobMode) {
            action = 'auto-compact-now';
            next = 'peaks compact auto --execute';
          } else {
            action = 'soft-warn';
          }
        } else if (probe.ratio >= 0.5) {
          action = 'soft-warn';
        }
        const verdict =
          action === 'red-line' ? 'red-line'
            : action === 'auto-compact-now' ? 'pre-compact'
            : action === 'soft-warn' ? 'soft-warn'
            : 'ok';
        const jobModeNotice = isJobMode
          ? 'Job mode enforced: ≥0.85 is MANDATORY auto-compact (v3.1.2).'
          : 'Advisory mode (single-rid): ≥0.85 is recommended, not mandatory.';
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
            bytesPrompt: promptSizeBytes ?? null,
            capturedAt: probe.capturedAt
          }, [], [
            action === 'red-line'
              ? `RED LINE: ≥ 95%. Next: \`${next}\` (PreToolUse hook fires next turn).`
              : action === 'auto-compact-now'
                ? `Job-mode MANDATORY auto-compact. Code MUST call \`${next}\` WITHOUT confirmation.`
                : action === 'soft-warn'
                  ? isJobMode
                    ? `Job mode soft-warn (50–85%). Continue working; the next \`peaks compact auto\` will re-check.`
                    : `Soft warn (50–85%). Continue working; the next \`peaks compact auto\` will re-check.`
                  : `Below 50%. No action required.`,
            jobModeNotice
          ]),
          true
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
          'wake up cold.'
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
          }, [], result.nextSliceLine !== null ? [result.nextSliceLine] : []);
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
            'job-shape.json says isJob=false; single-rid mode (gate allows).'
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
            'Then re-run the Bash tool call.'
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
          'No job-shape.json AND no backup-regex match on prompt → allow (most prompts are not Job-shaped).'
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