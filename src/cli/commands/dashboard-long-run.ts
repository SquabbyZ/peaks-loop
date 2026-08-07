import type { Command } from 'commander';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { read24hState } from '../../services/24h-mode/index.js';
import { getErrorMessage, type ProgramIO } from '../cli-helpers.js';

const SINCE_PATTERN = /^(\d+)([smhd])$/i;
const WINDOW_CAP_HOURS = 24;
const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const WINDOW_CAP_MS = WINDOW_CAP_HOURS * MS_PER_HOUR;

type ParseResult = { ok: true; ms: number } | { ok: false; error: string };

function parseSince(raw: string | undefined): ParseResult {
  if (!raw) return { ok: false, error: '--since is required (e.g. 24h, 8h, 30m)' };
  const match = SINCE_PATTERN.exec(raw);
  if (!match) return { ok: false, error: `--since must match <n><s|m|h|d> (got ${raw})` };
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 0) return { ok: false, error: `--since must be a non-negative integer (got ${raw})` };
  const unit = (match[2] ?? 'h').toLowerCase();
  const multiplier = unit === 'd' ? MS_PER_DAY : unit === 'h' ? MS_PER_HOUR : unit === 'm' ? MS_PER_MINUTE : MS_PER_SECOND;
  return { ok: true, ms: Math.min(WINDOW_CAP_MS, value * multiplier) };
}

function readSlices(projectRoot: string, sessionId: string): number {
  const path = join(projectRoot, '.peaks', '_runtime', sessionId, 'metrics', 'slices.jsonl');
  if (!existsSync(path)) return 0;
  try {
    return readFileSync(path, 'utf8').split('\n').filter((line) => line.trim().length > 0).length;
  } catch {
    return 0;
  }
}

function readLastCheckpointAgeMs(snapshot: { lastCheckpointAt: string | null }): number | null {
  if (!snapshot.lastCheckpointAt) return null;
  const ts = Date.parse(snapshot.lastCheckpointAt);
  return Number.isFinite(ts) ? Math.max(0, Date.now() - ts) : null;
}

type Boundary = { key: 'empty' | 'cap' | 'valid'; message: string };
function boundaryLabel(raw: string): Boundary {
  if (raw === '0h' || raw === '0m' || raw === '0s' || raw === '0d') {
    return { key: 'empty', message: 'since=0 produces an empty window' };
  }
  const match = SINCE_PATTERN.exec(raw);
  if (!match) return { key: 'valid', message: 'unparseable' };
  const value = Number(match[1]);
  const unit = (match[2] ?? 'h').toLowerCase();
  const multiplier = unit === 'd' ? MS_PER_DAY : unit === 'h' ? MS_PER_HOUR : unit === 'm' ? MS_PER_MINUTE : MS_PER_SECOND;
  if (value * multiplier > WINDOW_CAP_MS) {
    return { key: 'cap', message: 'since>24h is capped to the 24h window' };
  }
  return { key: 'valid', message: 'within window' };
}

export function registerDashboardLongRunCommand(dashboard: Command, io: ProgramIO): void {
  dashboard
    .command('long-run')
    .description('24h long-run indicator dashboard (read-only) for the active 24h state')
    .option('--since <duration>', 'time window (e.g. 24h, 8h, 30m); capped at 24h')
    .option('--project <path>', 'project root (defaults to current directory)')
    .option('--session-id <sessionId>', 'explicit session id')
    .option('--json', 'emit machine-readable JSON')
    .action(async (options: { since?: string; project?: string; sessionId?: string; json?: boolean }) => {
      const projectRoot = resolveCanonicalProjectRoot(options.project ?? process.cwd());
      const parsed = parseSince(options.since);
      if (!parsed.ok) {
        io.stdout((options.json === true
          ? JSON.stringify({ ok: false, code: 'INVALID_SINCE', message: parsed.error })
          : `${parsed.error}\n`) + '\n');
        process.exitCode = 1;
        return;
      }
      const sid = options.sessionId ?? (await (async () => {
        const { getSessionIdCanonical } = await import('../../services/session/session-manager.js');
        return getSessionIdCanonical(projectRoot);
      })());
      if (!sid) {
        io.stdout((options.json === true
          ? JSON.stringify({ ok: false, code: 'NO_ACTIVE_SESSION', message: 'no --session-id and no canonical binding' })
          : 'NO_ACTIVE_SESSION: no --session-id and no canonical binding\n'));
        process.exitCode = 1;
        return;
      }
      const boundary = boundaryLabel(options.since ?? '');
      try {
        const snapshot = read24hState(projectRoot, sid);
        const sliceCount = readSlices(projectRoot, sid);
        const checkpointAgeMs = readLastCheckpointAgeMs(snapshot);
        const checkpointFrequency = snapshot.checkpoints > 0 && snapshot.enteredAt
          ? Math.max(1, Math.round((Date.now() - Date.parse(snapshot.enteredAt)) / snapshot.checkpoints / MS_PER_MINUTE))
          : null;
        const indicators = {
          dispatchCount: sliceCount,
          autoCompactCount: snapshot.autoCompactCount,
          monotonicTriggerCount: snapshot.monotonicGuards,
          subAgentFailureCount: Object.values(snapshot.attempts).reduce((a, b) => a + b, 0),
          checkpointFrequency
        };
        const payload = {
          ok: true,
          data: {
            sessionId: sid,
            since: options.since ?? null,
            sinceMs: parsed.ms,
            sinceCapped: parsed.ms === WINDOW_CAP_MS && boundary.key === 'cap',
            boundary: boundary.key,
            snapshot: { state: snapshot.state, enteredAt: snapshot.enteredAt, lastCheckpointAt: snapshot.lastCheckpointAt },
            indicators,
            checkpointAgeMs
          }
        };
        io.stdout((options.json === true ? JSON.stringify(payload) : JSON.stringify(payload.data, null, 2)) + '\n');
      } catch (error) {
        io.stdout((options.json === true
          ? JSON.stringify({ ok: false, code: 'LONG_RUN_READ_FAILED', message: getErrorMessage(error) })
          : `LONG_RUN_READ_FAILED: ${getErrorMessage(error)}\n`) + '\n');
        process.exitCode = 1;
      }
    });
}

export const DASHBOARD_LONG_RUN_CONSTANTS = { WINDOW_CAP_HOURS, WINDOW_CAP_MS } as const;
export const __test__ = { parseSince, boundaryLabel };
