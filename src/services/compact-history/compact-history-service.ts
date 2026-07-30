// src/services/compact-history/compact-history-service.ts
//
// Slice 2026-07-30-compact-visibility (slice 1/4). Pure-function
// reader for the .peaks/_runtime/<sessionId>/compact-history.jsonl
// file that auto-compact-orchestrator now appends to on every
// dispatch. The CLI surface `peaks compact history` and the
// statusline indicator both consume this service.
//
// The file is one JSON event per line. Malformed lines are
// surfaced as { kind: 'parse-error', line, raw } records so the
// caller (CLI / statusline) can warn without aborting the whole
// read.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface CompactHistoryEvent {
  readonly schemaVersion: 1;
  readonly ts: string;
  readonly target: 'main' | 'sub-agent' | 'worker';
  readonly mode: 'standard' | 'partial' | 'aggressive';
  readonly ide: string;
  readonly pathway: string;
  readonly beforeRatio: number;
  readonly redLine: boolean;
  readonly ok: boolean;
  readonly checkpointPath: string;
  readonly dispatchMessage: string;
}

export type CompactHistoryReadResult =
  | { readonly kind: 'file-missing'; readonly path: string }
  | { readonly kind: 'empty'; readonly path: string }
  | {
      readonly kind: 'ok';
      readonly path: string;
      readonly events: ReadonlyArray<CompactHistoryEvent>;
      readonly parseErrors: ReadonlyArray<{ readonly line: number; readonly raw: string }>;
    };

export function readCompactHistory(input: {
  readonly projectRoot: string;
  readonly sessionId: string;
}): CompactHistoryReadResult {
  const path = join(input.projectRoot, '.peaks', '_runtime', input.sessionId, 'compact-history.jsonl');
  if (!existsSync(path)) {
    return { kind: 'file-missing', path };
  }
  const raw = readFileSync(path, 'utf8');
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) {
    return { kind: 'empty', path };
  }
  const events: CompactHistoryEvent[] = [];
  const parseErrors: { line: number; raw: string }[] = [];
  lines.forEach((line, idx) => {
    try {
      const parsed = JSON.parse(line) as CompactHistoryEvent;
      if (typeof parsed.beforeRatio !== 'number' || typeof parsed.ts !== 'string') {
        parseErrors.push({ line: idx + 1, raw: line });
        return;
      }
      events.push(parsed);
    } catch {
      parseErrors.push({ line: idx + 1, raw: line });
    }
  });
  return { kind: 'ok', path, events, parseErrors };
}

export interface CompactHistorySummary {
  readonly totalCompacts: number;
  readonly lastTs: string | null;
  readonly lastBeforeRatio: number | null;
  readonly lastRedLine: boolean;
  readonly redLineCount: number;
  readonly failedCount: number;
}

export function summarizeCompactHistory(events: ReadonlyArray<CompactHistoryEvent>): CompactHistorySummary {
  if (events.length === 0) {
    return {
      totalCompacts: 0,
      lastTs: null,
      lastBeforeRatio: null,
      lastRedLine: false,
      redLineCount: 0,
      failedCount: 0,
    };
  }
  const last = events[events.length - 1]!;
  return {
    totalCompacts: events.length,
    lastTs: last.ts,
    lastBeforeRatio: last.beforeRatio,
    lastRedLine: last.redLine,
    redLineCount: events.filter((e) => e.redLine).length,
    failedCount: events.filter((e) => !e.ok).length,
  };
}
