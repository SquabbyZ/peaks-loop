// src/services/compact-statusline/compact-statusline-service.ts
//
// Slice 2026-07-30-compact-visibility (slice 3/4). Pure helper
// for the 'peaks statusline compact' indicator. Reads
// .peaks/_runtime/<sessionId>/auto-compact-pending.json +
// compact-history.jsonl and decides the single-line text
// the LLM should embed in Claude Code's statusline.
//
// State machine:
//   - pending: a 'block' intent is sitting in
//     auto-compact-pending.json → 'compact pending (<ratio>)'
//   - redLine: pending.redLine === true → 'REDLINE 0.95'
//   - just-compacted: history has an event within the last
//     30 seconds → 'just compacted (<from>→<to>)'
//   - idle: nothing recent → '--'
//   - missing: no session binding or no orchestrator run yet
//     → '' (empty)

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface CompactStatuslineState {
  readonly kind: 'missing' | 'idle' | 'pending' | 'red-line' | 'just-compacted';
  readonly label: string;
  readonly detail?: string;
}

const JUST_COMPACTED_WINDOW_MS = 30_000;

export function decideCompactStatusline(input: {
  readonly projectRoot: string;
  readonly sessionId: string | null;
  readonly now: number;
}): CompactStatuslineState {
  if (input.sessionId === null) {
    return { kind: 'missing', label: '' };
  }
  const runtimeDir = join(input.projectRoot, '.peaks', '_runtime', input.sessionId);
  const pendingPath = join(runtimeDir, 'txt', 'auto-compact-pending.json');
  const historyPath = join(runtimeDir, 'compact-history.jsonl');

  // Priority 1: a pending compact intent.
  if (existsSync(pendingPath)) {
    try {
      const raw = readFileSync(pendingPath, 'utf8');
      const parsed = JSON.parse(raw) as { pending?: boolean; ratio?: number; redLine?: boolean };
      if (parsed.pending === true) {
        if (parsed.redLine === true) {
          return {
            kind: 'red-line',
            label: `REDLINE ${(parsed.ratio ?? 0).toFixed(2)}`,
            detail: pendingPath,
          };
        }
        return {
          kind: 'pending',
          label: `compact pending (${(parsed.ratio ?? 0).toFixed(2)})`,
          detail: pendingPath,
        };
      }
    } catch { /* fall through to history check */ }
  }

  // Priority 2: the most recent history event is within 30s.
  if (existsSync(historyPath)) {
    try {
      const mtimeMs = statSync(historyPath).mtimeMs;
      if (input.now - mtimeMs <= JUST_COMPACTED_WINDOW_MS) {
        const raw = readFileSync(historyPath, 'utf8');
        const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
        const last = lines[lines.length - 1];
        if (last !== undefined) {
          const parsed = JSON.parse(last) as { beforeRatio?: number; redLine?: boolean; ok?: boolean };
          const from = (parsed.beforeRatio ?? 0).toFixed(2);
          const to = (parsed.ok === false) ? 'failed' : '0.0?';
          return {
            kind: 'just-compacted',
            label: parsed.redLine === true
              ? `just compacted (REDLINE ${from}→?)`
              : `just compacted (${from}→${to})`,
            detail: historyPath,
          };
        }
      }
    } catch { /* fall through to idle */ }
  }

  return { kind: 'idle', label: '--' };
}

/**
 * Plain-text render: just the label. The LLM embeds this in
 * the Claude Code statusline. Pure: no side effects, no I/O
 * beyond the two file reads.
 */
export function renderCompactStatusline(state: CompactStatuslineState): string {
  return state.label;
}
