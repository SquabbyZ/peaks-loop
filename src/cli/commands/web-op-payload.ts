// src/cli/commands/web-op-payload.ts
//
// How one `peaks web` op's daemon payload becomes stdout: the per-verb wrap of
// the page-controlled fields, the human-mode renderer for `metrics`, and the
// printer that keeps the UNTRUSTED delimiters on their own lines. Split out of
// `web-commands.ts`; every branch and every byte cap is unchanged.

import type { ResultEnvelope } from 'peaks-loop-shared/result';

import { capText, MAX_TEXT_BYTES } from '../../services/web/bounded-output.js';
import { wrapUntrusted, WRAPPED_OPS } from '../../services/web/untrusted-envelope.js';
import type { WebOp } from '../../services/web/web-protocol.js';
import { printResult, type ProgramIO } from '../cli-helpers.js';
import { count, text } from './web-command-shared.js';

interface WrappedPayload {
  readonly data: Record<string, unknown>;
  /** Raw human-mode stdout, or `null` for verbs whose output is not page content. */
  readonly human: string | null;
}

/**
 * Wrap the page-controlled part of each verb's payload (AC4 / §6.2) and pick
 * the bytes that human mode prints verbatim. `shot` is unwrapped: its path and
 * byte count are ours, not the page's.
 */
export function wrapPageData(op: WebOp, raw: Record<string, unknown>): WrappedPayload {
  if (!WRAPPED_OPS.has(op)) {
    return { data: raw, human: null };
  }
  switch (op) {
    case 'open': {
      const title = wrapUntrusted(text(raw['title']));
      return { data: { url: wrapUntrusted(text(raw['url'])), title }, human: title };
    }
    case 'text': {
      const value = wrapUntrusted(text(raw['text']));
      return {
        data: {
          text: value,
          truncated: raw['truncated'] === true,
          droppedBytes: count(raw['droppedBytes'])
        },
        human: value
      };
    }
    case 'snap': {
      const snapshot = wrapUntrusted(text(raw['snapshot']));
      return {
        data: {
          snapshot,
          droppedNodes: count(raw['droppedNodes']),
          depthCapped: raw['depthCapped'] === true,
          nodeCapped: raw['nodeCapped'] === true,
          truncated: raw['truncated'] === true,
          droppedBytes: count(raw['droppedBytes'])
        },
        human: snapshot
      };
    }
    case 'click': {
      const result = wrapUntrusted(text(raw['result']));
      return { data: { result }, human: result };
    }
    case 'metrics': {
      // The rendered lines come from the daemon's payload, so they are capped
      // here as well as at the producer: this is the boundary that reaches
      // stdout, and the ceiling must hold whatever the daemon sends.
      const metrics = wrapUntrusted(capText(renderMetrics(raw), MAX_TEXT_BYTES).text);
      return { data: { metrics }, human: metrics };
    }
    default:
      return { data: raw, human: null };
  }
}

/**
 * Print the envelope. Failures and `--json` go through `printResult`; a
 * successful wrapped op in human mode prints its payload RAW, because the
 * UNTRUSTED delimiters must stay on their own lines (AC4) and AC2 measures the
 * byte count of exactly this stdout.
 */
export function emit<T>(
  io: ProgramIO,
  result: ResultEnvelope<T>,
  asJson: boolean,
  humanPayload: string | null
): void {
  if (!result.ok || asJson || humanPayload === null) {
    printResult(io, result, asJson);
    return;
  }
  io.stdout(humanPayload);
  for (const warning of result.warnings) {
    io.stderr(`warning: ${warning}`);
  }
}

/** `available: false` is reported as such — never as fabricated zeros (C4). */
function renderMetrics(raw: Record<string, unknown>): string {
  if (raw['available'] !== true) {
    return `available: false\nreason: ${text(raw['reason']) || 'unavailable'}`;
  }
  const values = (raw['values'] ?? {}) as Record<string, unknown>;
  const lines = Object.entries(values).map(([key, value]) => `${key}: ${String(value)}`);
  return lines.length > 0 ? lines.join('\n') : 'available: true';
}
