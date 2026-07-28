import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Command } from 'commander';

import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { getSessionIdCanonical } from '../../services/session/session-manager.js';
import { readRecords, type DispatchRecord } from '../../services/dispatch/dispatch-record-writer.js';
import { renderStatusLine, summarize, viewSubAgent } from '../../services/code/status-line-renderer.js';
import { getErrorMessage, type ProgramIO } from '../cli-helpers.js';

const DEFAULT_INTERVAL_MS = 10_000;
const DEFAULT_STALE_THRESHOLD_MS = 5 * 60 * 1000;
const TERMINAL_STATUSES = new Set<DispatchRecord['status']>([
  'done',
  'failed',
  'cancelled',
  'no-execution'
]);

type WatchOptions = {
  batchId?: string;
  intervalMs?: string;
  staleThresholdMs?: string;
  maxTicks?: string;
  project?: string;
  sessionId?: string;
  json?: boolean;
};

type WatchSnapshot = {
  readonly records: readonly DispatchRecord[];
  readonly line: string;
  readonly summary: ReturnType<typeof summarize>;
  readonly views: readonly ReturnType<typeof viewSubAgent>[];
  readonly stale: {
    readonly count: number;
    readonly thresholdSec: number;
    readonly customThresholdSec: number;
    readonly views: readonly ReturnType<typeof viewSubAgent>[];
  };
};

function parsePositiveMs(raw: string | undefined, fallback: number, flag: string): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${flag} must be a positive integer (got ${raw})`);
  }
  return value;
}

function parseMaxTicks(raw: string | undefined): number {
  if (raw === undefined) return Number.POSITIVE_INFINITY;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`--max-ticks must be a positive integer (got ${raw})`);
  }
  return value;
}

function findBatchRecords(projectRoot: string, sessionId: string, batchId: string): DispatchRecord[] {
  const sessionDir = resolve(projectRoot, '.peaks', '_sub_agents', sessionId);
  if (!existsSync(sessionDir)) return [];
  const paths = readdirSync(sessionDir)
    .filter((name) => /^dispatch-[^/\\]+\.json$/.test(name))
    .map((name) => join(sessionDir, name));
  return readRecords(paths).filter((record) => record.batchId === batchId);
}

function snapshot(
  records: readonly DispatchRecord[],
  batchId: string,
  staleThresholdMs: number,
  now: () => Date = () => new Date()
): WatchSnapshot {
  const prefix = `[peaks-heartbeat:${batchId}]`;
  const summary = summarize(records);
  const views = records.map((record) => viewSubAgent(record, now));
  const customThresholdSec = Math.floor(staleThresholdMs / 1000);
  const staleViews = views.filter((view) => view.lastBeatAgoSec !== null && view.lastBeatAgoSec > customThresholdSec);
  let line = renderStatusLine(prefix, records, now);
  if (staleThresholdMs > DEFAULT_STALE_THRESHOLD_MS) {
    line = line.replaceAll(' ⚠ stale', '');
  } else if (staleThresholdMs < DEFAULT_STALE_THRESHOLD_MS) {
    const staleRoles = new Set(staleViews.map((view) => view.role));
    if (staleRoles.size > 0 && !line.includes('⚠ stale')) {
      line += ` ⚠ stale (${[...staleRoles].join(', ')})`;
    }
  }
  return {
    records,
    line,
    summary,
    views,
    stale: {
      count: staleViews.length,
      thresholdSec: Math.floor(DEFAULT_STALE_THRESHOLD_MS / 1000),
      customThresholdSec,
      views: staleViews
    }
  };
}

function isTerminal(records: readonly DispatchRecord[]): boolean {
  return records.length > 0 && records.every((record) => TERMINAL_STATUSES.has(record.status));
}

function emit(io: ProgramIO, value: WatchSnapshot, json: boolean): void {
  if (json) {
    io.stdout(`${JSON.stringify({ ok: true, data: value })}\n`);
  } else {
    io.stdout(`${value.line}\n`);
  }
}

/** Register the independently runnable `peaks heartbeat watch` daemon. */
export function registerHeartbeatWatchCommand(parent: Command, io: ProgramIO): void {
  parent
    .command('watch')
    .description('Watch persisted sub-agent heartbeat records for one batch')
    .requiredOption('--batch-id <id>', 'batch id to watch')
    .option('--interval-ms <n>', `poll interval in milliseconds (default ${DEFAULT_INTERVAL_MS})`)
    .option('--stale-threshold-ms <n>', `stale threshold in milliseconds (default ${DEFAULT_STALE_THRESHOLD_MS})`)
    .option('--max-ticks <n>', 'stop after n ticks (test/diagnostic seam)')
    .option('--project <path>', 'project root (defaults to current directory)')
    .option('--session-id <id>', 'session id (defaults to the active binding)')
    .option('--json', 'emit one JSON envelope per poll tick')
    .action(async (options: WatchOptions) => {
      try {
        const intervalMs = parsePositiveMs(options.intervalMs, DEFAULT_INTERVAL_MS, '--interval-ms');
        const staleThresholdMs = parsePositiveMs(options.staleThresholdMs, DEFAULT_STALE_THRESHOLD_MS, '--stale-threshold-ms');
        const maxTicks = parseMaxTicks(options.maxTicks);
        const projectRoot = resolveCanonicalProjectRoot(options.project ?? process.cwd());
        const sessionId = options.sessionId ?? getSessionIdCanonical(projectRoot);
        if (!sessionId) throw new Error('no active session; pass --session-id');
        const tick = (): boolean => {
          const records = findBatchRecords(projectRoot, sessionId, options.batchId as string);
          const current = snapshot(records, options.batchId as string, staleThresholdMs);
          emit(io, current, options.json === true);
          return isTerminal(records);
        };
        if (tick()) return;
        let count = 1;
        await new Promise<void>((resolveWait, reject) => {
          const timer = setInterval(() => {
            try {
              count += 1;
              if (tick() || count >= maxTicks) {
                clearInterval(timer);
                resolveWait();
              }
            } catch (error: unknown) {
              clearInterval(timer);
              reject(error);
            }
          }, intervalMs);
          timer.unref?.();
        });
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        if (options.json === true) io.stdout(`${JSON.stringify({ ok: false, code: 'HEARTBEAT_WATCH_FAILED', message })}\n`);
        else io.stderr(`HEARTBEAT_WATCH_FAILED: ${message}\n`);
        process.exitCode = 1;
      }
    });
}

export const __test__ = {
  findBatchRecords,
  isTerminal,
  parsePositiveMs,
  snapshot
};

export { DEFAULT_INTERVAL_MS, DEFAULT_STALE_THRESHOLD_MS };
