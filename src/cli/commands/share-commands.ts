/**
 * `peaks sub-agent share | shared-read | await` — G8.4 + 2.7.0 await barrier.
 *
 * Pulled out of `sub-agent-commands.ts` (slice 2026-06-23-audit-p0-split)
 * to honor the 800-line file cap. These three commands share the G8.4
 * dispatcher-mediated cross-sub-agent signal channel:
 *   - `share` writes a `<role>.<event>` entry (≤ 1KB soft warn, ≥ 64KB reject).
 *   - `shared-read` returns sibling entries (filtered by `--since` / `--key` glob).
 *   - `await` joins a batch barrier (slice 2.7.0 MVP, claude-code only).
 *
 * Not peer-to-peer — pseudo-swarm property 3 preserved.
 */
import type { Command } from 'commander';
import { resolve } from 'node:path';
import { fail, getErrorMessage, ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import {
  readSharedChannel,
  writeSharedEntry,
  SHARED_CHANNEL_SOFT_VALUE_WARN
} from 'peaks-loop-shared-channel';
import { writeLogEntry } from '../../services/log/logger.js';
import { getCurrentSessionId } from '../../services/skills/skill-presence-service.js';
import {
  AwaitOptions,
  ShareOptions,
  SharedReadOptions,
  summarizeBatchResults
} from './sub-agent-shared.js';
import type { DispatchRecord } from '../../services/dispatch/dispatch-record-writer.js';

/**
 * A `dispatch-*.json` candidate for `finalize --request-id`, as read off disk.
 * The record's own `createdAt` is carried as the recency key — NOT the file's
 * mtime, which any heartbeat or finalize rewrites, so a `done` record can look
 * newer than the `queued` one that superseded it. Keeping the key on the
 * candidate makes the selection rule a pure function of the records and
 * testable without a filesystem.
 */
export interface FinalizeCandidate {
  readonly recordPath: string;
  readonly requestId: string;
  readonly status: string;
  readonly createdAt: string;
}

/**
 * What `--request-id` actually did, reported in the envelope. N3: the branch
 * used to resolve silently and could not say WHY a record was or was not the
 * one finalized.
 */
export interface FinalizeSelection {
  readonly requestId: string;
  readonly rule: string;
  readonly matched: number;
  readonly chosen: string | null;
  readonly rejected: readonly {
    readonly recordPath: string;
    readonly status: string;
    readonly reason: string;
  }[];
}

/** The one selection rule `--request-id` and `--batch` now share. */
export const FINALIZE_SELECTION_RULE =
  'prefer status=queued; among those, newest by record createdAt (then filename); ' +
  'no queued match means nothing is finalized';

/**
 * N3 — pick the record `finalize --request-id` should act on.
 *
 * The branch this replaces `break`ed on the FIRST file whose record carried
 * the requestId and never looked at `status`. With a re-dispatched request
 * (this session holds six records for `2026-09-12-defect-remediation`) it
 * always resolved to the OLDEST one — the already-`done` RD record — so
 * finalizing reported success while the newer `queued` QA record stayed
 * queued forever. `--batch` never had that bug: it filters on `queued`.
 *
 * Both branches are now the same rule. Return `null` when nothing is queued:
 * a record that already left `queued` is precisely the one that must NOT be
 * re-finalized, so the caller reports the survivors instead of touching one.
 */
export function selectFinalizeTarget(
  candidates: readonly FinalizeCandidate[]
): FinalizeCandidate | null {
  const queued = candidates.filter(candidate => candidate.status === 'queued');
  if (queued.length === 0) return null;
  return [...queued].sort(
    (a, b) =>
      b.createdAt.localeCompare(a.createdAt) || b.recordPath.localeCompare(a.recordPath)
  )[0]!;
}

/** Why a candidate was not the chosen one — reported, never guessed at. */
export function describeFinalizeRejection(
  candidate: FinalizeCandidate,
  chosen: FinalizeCandidate | null
): string {
  if (candidate.status !== 'queued' || chosen === null) {
    return 'status is ' + candidate.status;
  }
  return 'superseded by the newer queued record ' + chosen.recordPath;
}

export function registerShareCommand(parent: Command, io: ProgramIO): void {
  addJsonOption(
    parent
      .command('share')
      .description(
        'G8.4: write a shared entry to the cross sub-agent shared channel. ' +
        'Dispatcher-mediated indirect signal: sub-agent A writes, dispatcher ' +
        'stores, sub-agent B (still in flight) reads via `peaks sub-agent ' +
        'shared-read`. Not peer-to-peer; pseudo-swarm property 3 preserved.'
      )
      .requiredOption('--batch <batchId>', 'batchId (from `peaks sub-agent dispatch` envelope)')
      .requiredOption('--key <k>', 'entry key (convention: "<role>.<event>")')
      .requiredOption('--value <json>', 'JSON object value (≤ 1KB soft warn, ≥ 64KB rejected)')
      .option('--from <role>', 'sub-agent role string; defaults to dispatch record role if available')
      .option('--request-id <rid>', 'request id (default: "unknown-rid")')
      .option('--session-id <sid>', 'session id (default: resolve from .peaks/_runtime/session.json; falls back to PEAKS_SESSION_ID env var; final fallback "unknown-sid")')
      .option('--project <path>', 'target project root (defaults to cwd)')
  ).action((options: ShareOptions) => {
    const asJson = options.json === true;
    if (!options.batch || !options.key || !options.value) {
      printResult(io, fail('sub-agent.share', 'MISSING_ARG', '--batch, --key, and --value are required', { ok: false } as never, [
        'Re-run with --batch <batchId> --key <key> --value <jsonObject>.'
      ]), asJson);
      process.exitCode = 1;
      return;
    }
    let parsedValue: Record<string, unknown>;
    try {
      const parsed = JSON.parse(options.value) as unknown;
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('value must be a JSON object');
      }
      parsedValue = parsed as Record<string, unknown>;
    } catch (err) {
      printResult(io, fail('sub-agent.share', 'INVALID_VALUE', `value must be a JSON object: ${getErrorMessage(err)}`, { ok: false } as never, [
        'Pass --value as a JSON object literal, e.g. --value \'{"reason":"x"}\'.'
      ]), asJson);
      process.exitCode = 1;
      return;
    }

    try {
      const projectRoot = options.project ?? process.cwd();
      // Slice 2026-06-26-unknown-sid-fallback-fix: see dispatch-commands.ts.
      const sid = options.sessionId
        ?? process.env.PEAKS_SESSION_ID
        ?? getCurrentSessionId(projectRoot)
        ?? 'unknown-sid';
      const rid = options.requestId ?? 'unknown-rid';
      const from = options.from ?? 'unknown-role';

      const result = writeSharedEntry({
        projectRoot,
        sid,
        rid,
        batchId: options.batch,
        key: options.key,
        from,
        value: parsedValue
      });

      if (!result.ok) {
        const code = result.code;
        printResult(io, fail('sub-agent.share', code, result.message, { ok: false, batchId: options.batch } as never, [
          code === 'VALUE_TOO_LARGE'
            ? 'Reduce value size; 1KB is a soft warning, 64KB is a hard reject.'
            : 'See error message; check --batch, --key, --value arguments.'
        ]), asJson);
        process.exitCode = 1;
        return;
      }

      const warnings: string[] = [];
      if (result.lastWriteWins) {
        warnings.push('LAST_WRITE_WINS');
      }
      if (result.softWarning) {
        warnings.push(`VALUE_SIZE_SOFT_WARN: ${result.entry.valueSize} > ${SHARED_CHANNEL_SOFT_VALUE_WARN} bytes`);
      }

      printResult(io, ok('sub-agent.share', {
        // Slice 2026-06-23-audit-4th #E1: envelopeVersion marker
        envelopeVersion: '2.1.0',
        ok: true,
        batchId: options.batch,
        entryKey: options.key,
        writtenAt: result.entry.at,
        channelSize: result.channelSize,
        lastWriteWins: result.lastWriteWins,
        valueSize: result.entry.valueSize
      }, warnings, [
        'Sub-agents in the same batch can read this entry via `peaks sub-agent shared-read --batch ' + options.batch + '`.'
      ]), asJson);
      // Slice 2026-06-23-audit-4th #B1: structured log on success.
      try {
        writeLogEntry({
          ts: new Date().toISOString(),
          level: 'info',
          command: 'sub-agent.share',
          msg: 'shared',
          sessionId: sid,
          batchId: options.batch,
          data: {
            batchId: options.batch,
            key: options.key,
            valueSize: result.entry.valueSize,
            lastWriteWins: result.lastWriteWins
          }
        });
      } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
        /* best-effort */
      }
    } catch (error: unknown) {
      const code = (error as { code?: string }).code ?? 'SHARE_ERROR';
      printResult(io, fail('sub-agent.share', code, getErrorMessage(error), { ok: false, batchId: options.batch } as never, [
        shareErrorNextActions(code)
      ]), asJson);
      process.exitCode = 1;
    }
  });
}

/**
 * Slice 2026-06-23-audit-3rd #9: branch on `error.code` so the LLM-side
 * runner gets an actionable hint instead of a generic "see error
 * message" fallback. Each branch names the most likely next step.
 */
function shareErrorNextActions(code: string): string {
  if (code === 'LOCK_TIMEOUT') {
    return 'A concurrent `peaks sub-agent share` is holding the channel lock for >5s; retry, or check for a crashed holder (the .lock file is reaped after 30s).';
  }
  if (code === 'RECORD_NOT_FOUND' || code === 'INVALID_RECORD_PATH') {
    return 'The dispatch record path is missing or outside .peaks/_sub_agents/. Re-run `peaks sub-agent dispatch <role>` to get a fresh record path, then use that here.';
  }
  return 'See error message; check that --batch matches the dispatch envelope and the value is a JSON object ≤ 64KB.';
}

export function registerSharedReadCommand(parent: Command, io: ProgramIO): void {
  addJsonOption(
    parent
      .command('shared-read')
      .description(
        'G8.4: read entries from the cross sub-agent shared channel. ' +
        'Returns sibling sub-agent status. Supports --since (ISO8601) ' +
        'and --key (glob pattern with * wildcard).'
      )
      .requiredOption('--batch <batchId>', 'batchId (from `peaks sub-agent dispatch` envelope)')
      .option('--since <iso>', 'only return entries written after this ISO8601 timestamp')
      .option('--key <pattern>', 'glob pattern, e.g. "rd.*" or "*.completed"')
      .option('--request-id <rid>', 'request id (default: "unknown-rid")')
      .option('--session-id <sid>', 'session id (default: resolve from .peaks/_runtime/session.json; falls back to PEAKS_SESSION_ID env var; final fallback "unknown-sid")')
      .option('--project <path>', 'target project root (defaults to cwd)')
  ).action((options: SharedReadOptions) => {
    const asJson = options.json === true;
    if (!options.batch) {
      printResult(io, fail('sub-agent.shared-read', 'MISSING_BATCH', '--batch is required', { ok: false } as never, [
        'Re-run with --batch <batchId>.'
      ]), asJson);
      process.exitCode = 1;
      return;
    }
    try {
      const projectRoot = options.project ?? process.cwd();
      // Slice 2026-06-26-unknown-sid-fallback-fix: see dispatch-commands.ts.
      const sid = options.sessionId
        ?? process.env.PEAKS_SESSION_ID
        ?? getCurrentSessionId(projectRoot)
        ?? 'unknown-sid';
      const rid = options.requestId ?? 'unknown-rid';
      const channel = readSharedChannel({
        projectRoot,
        sid,
        rid,
        batchId: options.batch,
        ...(options.since !== undefined ? { since: options.since } : {}),
        ...(options.key !== undefined ? { keyPattern: options.key } : {})
      });
      printResult(io, ok('sub-agent.shared-read', {
        // Slice 2026-06-23-audit-4th #E1: envelopeVersion marker
        envelopeVersion: '2.1.0',
        ok: true,
        batchId: options.batch,
        entries: channel.entries,
        totalEntries: Object.keys(channel.entries).length,
        channelSize: JSON.stringify(channel).length,
        updatedAt: channel.updatedAt
      }, [], [
        'Shared channel is dispatcher-mediated; do not attempt to read sibling dispatch records directly.'
      ]), asJson);
    } catch (error: unknown) {
      const code = (error as { code?: string }).code ?? 'SHARED_READ_ERROR';
      printResult(io, fail('sub-agent.shared-read', code, getErrorMessage(error), { ok: false, batchId: options.batch } as never, [
        sharedReadErrorNextActions(code)
      ]), asJson);
      process.exitCode = 1;
    }
  });
}

function sharedReadErrorNextActions(code: string): string {
  if (code === 'INVALID_BATCH_ID' || code === 'MISSING_BATCH') {
    return 'Pass --batch <batchId> exactly as returned by the `peaks sub-agent dispatch` envelope.';
  }
  return 'See error message; check that --batch matches the dispatch envelope (typo / wrong batch will return an empty channel, not an error).';
}

export function registerAwaitCommand(parent: Command, io: ProgramIO): void {
  addJsonOption(
    parent
      .command('await')
      .description(
        '2.7.0 slice-dag-dispatcher MVP: wait for a batch of dispatched sub-agents ' +
        'to finish (or hit --timeout). Returns one BatchResult per dispatch. ' +
        'For non-claude-code IDEs, the wait is delegated to the LLM (slice 1.3 will ' +
        'land real per-IDE joins).'
      )
      .requiredOption('--batch <batchId>', 'batchId from a dispatch envelope')
      .option('--timeout <ms>', 'optional cap on how long the join waits (ms; default 60000, max 120000)')
      .option('--project <path>', 'target project root (defaults to cwd)')
      .option('--session-id <sid>', 'override active session id (default: resolve from .peaks/_runtime/session.json; falls back to PEAKS_SESSION_ID env var; final fallback "unknown-sid")')
  ).action(async (options: AwaitOptions) => {
    const asJson = options.json === true;
    if (!options.batch) {
      printResult(io, fail('sub-agent.await', 'MISSING_BATCH', '--batch is required', { ok: false } as never, [
        'Re-run with --batch <batchId> from a dispatch envelope.'
      ]), asJson);
      process.exitCode = 1;
      return;
    }
    let timeoutMs: number | undefined;
    if (typeof options.timeout === 'string' && options.timeout.length > 0) {
      const n = Number.parseInt(options.timeout, 10);
      if (!Number.isInteger(n) || n <= 0) {
        printResult(io, fail('sub-agent.await', 'INVALID_TIMEOUT', `--timeout must be a positive integer ms (got ${options.timeout})`, { ok: false } as never, [
          'Pass an integer like --timeout 60000.'
        ]), asJson);
        process.exitCode = 1;
        return;
      }
      timeoutMs = n;
    }
    const projectRoot = options.project ?? process.cwd();
    // Slice 2026-06-26-unknown-sid-fallback-fix: see dispatch-commands.ts.
    const sid = options.sessionId
      ?? process.env.PEAKS_SESSION_ID
      ?? getCurrentSessionId(projectRoot)
      ?? 'unknown-sid';
    // Lazy-import IDE modules so `peaks sub-agent share` and
    // `peaks sub-agent shared-read` (the high-frequency G8.4 path) do not
    // pay for adapter resolution at module-load time. Slice
    // 2026-06-23-audit-p0-cleanup.
    const { detectInstalledIde } = await import('../../services/ide/ide-detector.js');
    const { getAdapter } = await import('../../services/ide/ide-registry.js');
    const ide = detectInstalledIde(projectRoot) ?? 'claude-code';
    const adapter = getAdapter(ide);
    const dispatcher = adapter.subAgentDispatcher;
    if (typeof dispatcher.awaitBatch !== 'function') {
      printResult(io, fail('sub-agent.await', 'IDE_NOT_SUPPORTED', `IDE ${ide} does not support awaitBatch (1.2 MVP only ships claude-code)`, { ok: false } as never, [
        'Switch to claude-code, or rely on LLM-side await for non-claude-code IDEs in slice 1.3.'
      ]), asJson);
      process.exitCode = 1;
      return;
    }
    // 1.2 MVP: we don't keep a separate record path index for DAG-dispatched
    // batches yet; the caller is expected to have a single shared record
    // directory. We pass the empty list — the MVP runner tracks outcomes
    // through its own contract-store writes; the dispatcher just signals
    // "ready to await" through the awaitBatch LRU queue (slice 1.3
    // upgrades to cross-process heartbeat polling).
    const input = {
      batchId: options.batch,
      dispatchCount: 1,
      recordPaths: [] as readonly string[],
      ...(timeoutMs !== undefined ? { timeoutMs } : {})
    };
    try {
      const results = await dispatcher.awaitBatch(input);
      const summary = summarizeBatchResults(results);
      printResult(io, ok('sub-agent.await', {
        // Slice 2026-06-23-audit-4th #E1: envelopeVersion marker
        envelopeVersion: '2.1.0',
        batchId: options.batch,
        ide: dispatcher.label,
        results,
        summary
      }, [], [
        'For trae / trae-cn / codex / cursor, results will report status=timeout with note=`awaitByLlm: <ide> 1.2 fallback`. The calling LLM holds the real await.'
      ]), asJson);
    } catch (error: unknown) {
      const code = (error as { code?: string }).code ?? 'AWAIT_ERROR';
      printResult(io, fail('sub-agent.await', code, getErrorMessage(error), { ok: false } as never, [
        awaitErrorNextActions(code)
      ]), asJson);
      process.exitCode = 1;
    }
  });
}

function awaitErrorNextActions(code: string): string {
  if (code === 'INVALID_TIMEOUT') {
    return 'Pass --timeout as a positive integer ms (e.g. --timeout 60000). 0 and non-numeric values are rejected.';
  }
  if (code === 'IDE_NOT_SUPPORTED') {
    return 'Switch to claude-code, or rely on LLM-side await for non-claude-code IDEs in slice 1.3.';
  }
  return 'See error message; check that --batch matches the dispatch envelope and --timeout is a positive integer ms.';
}

/**
 * Slice 2026-07-17-D21: peaks sub-agent finalize — LLM-side completion
 * signal. Without this, dispatch records stay queued forever.
 *
 * Contract:
 *   - LLM MUST call once per dispatched Task, in post-completion branch.
 *   - --all-stale bulk-marks every queued record for this session (crash recovery).
 */
export interface FinalizeOptions {
  batch?: string;
  requestId?: string;
  outcome?: string;
  error?: string;
  allStale?: boolean;
  project?: string;
  sessionId?: string;
  json?: boolean;
}

export function registerFinalizeCommand(parent: Command, io: ProgramIO): void {
  addJsonOption(
    parent
      .command('finalize')
      .description('D21: signal that a dispatched sub-agent has finished (success/failure/cancellation). Pass --all-stale for crash-recovery sweep.')
      .option('--batch <batchId>', 'batchId from dispatch envelope')
      .option('--request-id <rid>', 'requestId from dispatch envelope')
      .option('--outcome <state>', 'done | failed | cancelled (default: done)')
      .option('--error <msg>', 'error message (when --outcome=failed)')
      .option('--all-stale', 'bulk-mark every queued record for this session as done')
      .option('--project <path>', 'target project root (defaults to cwd)')
      .option('--session-id <sid>', 'override active session id')
  ).action((options: FinalizeOptions) => {
    void (async () => {
      const asJson = options.json === true;
      try {
        const projectRoot = resolve(options.project ?? process.cwd());
        const sessionId = options.sessionId ?? getCurrentSessionId(projectRoot) ?? 'unknown-sid';
        if (!options.allStale && !options.requestId && !options.batch) {
          printResult(io, fail('sub-agent.finalize', 'MISSING_TARGET', 'Pass --request-id or --batch (or --all-stale)', { ok: false } as never, ['Call finalize after each Task completes.']), asJson);
          process.exitCode = 1;
          return;
        }
        const outcome = (options.outcome ?? 'done') as 'done' | 'failed' | 'cancelled';
        const writerMod = await import('../../services/dispatch/dispatch-record-writer.js');
        const { readRecord, markCompleted, readActiveDispatchIndex } = writerMod;
        // map outcome -> (status, outcome)
        const outcomeMap: Record<string, { status: 'done' | 'failed' | 'cancelled'; outcome: 'success' | 'failed' | 'cancelled' }> = {
          done: { status: 'done', outcome: 'success' },
          failed: { status: 'failed', outcome: 'failed' },
          cancelled: { status: 'cancelled', outcome: 'cancelled' },
        };
        const mapped = outcomeMap[outcome] ?? outcomeMap['done']!;
        const finalized = [] as Array<{ recordPath: string; requestId: string; status: string }>;
        const skipped = [] as Array<{ recordPath: string; reason: string }>;
        const errors = [] as Array<{ recordPath: string; error: string }>;
        let selection: FinalizeSelection | null = null;
        /**
         * N2 — one unreadable record must not abort the sweep.
         *
         * Skipping `active-dispatches.json` and `batch-*.counter.json` by
         * FILENAME removed the two non-record files that happened to be in the
         * directory, but a single stale or foreign `dispatch-*.json` (an old
         * `version`, hand-edited JSON, a truncated write) still made
         * `readRecord` throw from OUTSIDE any try/catch — and the throw
         * escaped to the action's outer handler, so `--request-id` AND
         * `--batch` both died with `FINALIZE_ERROR` and exit 1 without
         * touching a single healthy record.
         *
         * A record that cannot be read is now reported in `errors[]` and
         * skipped; every other record is processed as before.
         */
        const tryReadRecord = (recordPath: string): DispatchRecord | null => {
          try {
            return readRecord(recordPath);
          } catch (e: unknown) {
            errors.push({ recordPath, error: getErrorMessage(e) });
            return null;
          }
        };
        const applyOutcome = (recordPath: string, rid: string): void => {
          markCompleted({ recordPath, now: () => new Date(), status: mapped.status, outcome: mapped.outcome, projectRoot });
          finalized.push({ recordPath, requestId: rid, status: mapped.status });
        };
        if (options.allStale) {
          const index = readActiveDispatchIndex(projectRoot, sessionId);
          for (const [recordPath, entry] of Object.entries(index)) {
            if (entry.status !== 'queued') { skipped.push({ recordPath, reason: 'status is ' + entry.status }); continue; }
            try { applyOutcome(recordPath, entry.requestId); }
            catch (e: unknown) { errors.push({ recordPath, error: getErrorMessage(e) }); }
          }
        } else if (options.requestId) {
          const fs2 = await import('node:fs');
          const path2 = await import('node:path');
          const dir = path2.resolve(projectRoot, '.peaks', '_sub_agents', sessionId);
          const candidates: FinalizeCandidate[] = [];
          if (fs2.existsSync(dir)) {
            for (const f of fs2.readdirSync(dir)) {
              // Only dispatch records are readable records. The session
              // directory also holds `active-dispatches.json` (an index)
              // and `batch-<uuid>.counter.json` (batch counters); neither
              // carries a `version` field, so `readRecord` on them throws
              // `Dispatch record version mismatch ... got undefined`. The
              // `--batch` branch below has always used this same filter.
              if (!f.startsWith('dispatch-') || !f.endsWith('.json')) continue;
              const p = path2.join(dir, f);
              const r = tryReadRecord(p);
              if (r === null || r.requestId !== options.requestId) continue;
              candidates.push({
                recordPath: p,
                requestId: r.requestId,
                status: r.status,
                createdAt: r.createdAt
              });
            }
          }
          if (candidates.length === 0) {
            printResult(io, fail('sub-agent.finalize', 'RECORD_NOT_FOUND', 'No dispatch record for requestId=' + options.requestId, { ok: false } as never, ['Check --request-id matches the dispatch envelope.']), asJson);
            process.exitCode = 1;
            return;
          }
          // N3: same rule as `--batch` — see `selectFinalizeTarget`.
          const chosen = selectFinalizeTarget(candidates);
          selection = {
            requestId: options.requestId,
            rule: FINALIZE_SELECTION_RULE,
            matched: candidates.length,
            chosen: chosen?.recordPath ?? null,
            rejected: candidates
              .filter(candidate => candidate !== chosen)
              .map(candidate => ({
                recordPath: candidate.recordPath,
                status: candidate.status,
                reason: describeFinalizeRejection(candidate, chosen)
              }))
          };
          for (const rejected of selection.rejected) {
            skipped.push({ recordPath: rejected.recordPath, reason: rejected.reason });
          }
          if (chosen !== null) {
            try { applyOutcome(chosen.recordPath, chosen.requestId); }
            catch (e: unknown) { errors.push({ recordPath: chosen.recordPath, error: getErrorMessage(e) }); }
          }
        } else {
          const fs2 = await import('node:fs');
          const path2 = await import('node:path');
          const dir = path2.resolve(projectRoot, '.peaks', '_sub_agents', sessionId);
          if (fs2.existsSync(dir)) {
            for (const f of fs2.readdirSync(dir)) {
              if (!f.startsWith('dispatch-') || !f.endsWith('.json')) continue;
              const p = path2.join(dir, f);
              const r = tryReadRecord(p);
              if (r === null) continue;
              if (r.batchId !== options.batch) continue;
              if (r.status !== 'queued') { skipped.push({ recordPath: p, reason: 'status is ' + r.status }); continue; }
              try { applyOutcome(p, r.requestId); }
              catch (e: unknown) { errors.push({ recordPath: p, error: getErrorMessage(e) }); }
            }
          }
        }
        const hints: string[] = [];
        if (errors.length > 0) {
          hints.push('Re-run after fixing; unreadable records are listed in errors[] and were skipped, not fatal.');
        } else if (finalized.length === 0 && skipped.length > 0) {
          hints.push('Nothing was finalized: every matching record had already left `queued`. See skipped[] for each record\'s status.');
        } else {
          hints.push('All targeted records transitioned out of queued.');
        }
        if (selection !== null) {
          hints.push(`--request-id selection (${selection.rule}): chose ${selection.chosen ?? '(none)'} of ${selection.matched} matching record(s); ${selection.rejected.length} rejected.`);
        }
        printResult(io, ok('sub-agent.finalize', { finalized, skipped, errors, selection, sessionId, outcome }, errors.length > 0 ? [errors.length + ' failed'] : [], hints), asJson);
        if (errors.length > 0) process.exitCode = 1;
      } catch (error: unknown) {
        printResult(io, fail('sub-agent.finalize', 'FINALIZE_ERROR', getErrorMessage(error), { ok: false } as never, ['Inspect the error.']), asJson);
        process.exitCode = 1;
      }
    })();
  });
}
