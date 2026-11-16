// src/services/mcp/context-tool.ts
//
// `peaks_context_compress`: build the resume summary an LLM can carry forward
// after folding older turns out of its working set.
//
// WHAT THIS IS, AND WHAT IT IS NOT — the distinction is the whole point.
//
// This is NOT a compaction. Nothing here rewrites a request, shrinks a context
// window, or reduces token billing; a Model Context Protocol tool returns a
// VALUE, and the value it returns is text. billion-context achieves real
// compression by sitting in the network path and rewriting the outgoing body,
// which peaks-loop is not positioned to do (see `writeMainSessionCompactIntent`'s
// own header: hooks can observe or veto, never initiate).
//
// What it DOES is give the model a bounded, factual statement of where the work
// stands, so that after it decides to drop older turns it is working from
// recorded facts instead of from recollection. The saving is in what the model
// no longer needs to re-read, not in what the API is billed.
//
// READ-ONLY, BY COMPOSITION. Every argv it runs is already in the whitelist for
// `peaks_status`; this tool adds no CLI command and no argv. Section §3.2 of the
// design permits a composite to arrange and reshape, and forbids it to CONCLUDE.
// So the reply carries the envelopes' own words — presence, gate, ratio, the
// request's state — and never a judgement about whether the work is going well.

import { buildArgv } from '../readonly-surface/argv-guard.js';
import type { McpToolDefinition } from './surface.js';
import {
  rejectedResult,
  runArgv,
  valuesForEntry,
  type ToolCallContext,
  type ToolCallResult
} from './tool-core.js';

/** Bound on how much of each source the summary quotes. */
const MAX_TEXT = 400;

/** The `data` object of a CLI envelope, or `null` when the shape is not one. */
function envelopeData(outcome: { readonly envelope?: unknown }): Record<string, unknown> | null {
  const envelope = outcome.envelope;
  if (typeof envelope !== 'object' || envelope === null) return null;
  const data = (envelope as Record<string, unknown>)['data'];
  return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null;
}

/** A field from `data`, stringified and bounded; `null` when absent. */
function field(data: Record<string, unknown> | null, key: string): string | null {
  if (data === null) return null;
  const value = data[key];
  if (typeof value === 'string') return value.slice(0, MAX_TEXT);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

/** A field nested one level under `data[parent]` — where `skill presence` keeps
 *  its `context` block (`{ ratioPct, action, mode }`). */
function nestedField(
  data: Record<string, unknown> | null,
  parent: string,
  key: string
): string | null {
  if (data === null) return null;
  const container = data[parent];
  if (typeof container !== 'object' || container === null) return null;
  return field(container as Record<string, unknown>, key);
}

/** The `skill presence` facts, from `data` and its nested `context` block. */
function presenceLines(data: Record<string, unknown> | null): string[] {
  const lines: string[] = [];
  const skill = field(data, 'skill');
  const gate = field(data, 'gate');
  // `skill presence` nests these under `data.context`; reading them off the top
  // level silently produced nothing, which is why the first live run of this
  // tool omitted the ratio entirely.
  const ratio = nestedField(data, 'context', 'ratioPct');
  const action = nestedField(data, 'context', 'action');
  if (skill !== null) lines.push(`- active skill: ${skill}`);
  if (gate !== null) lines.push(`- gate: ${gate}`);
  if (ratio !== null) lines.push(`- context used: ${ratio}`);
  if (action !== null && action !== 'none') lines.push(`- context action: ${action}`);
  return lines;
}

/** The `request show` facts. */
function requestLines(data: Record<string, unknown> | null): string[] {
  const lines: string[] = [];
  const requestId = field(data, 'requestId');
  const state = field(data, 'state');
  const path = field(data, 'path');
  if (requestId !== null) lines.push(`- request: ${requestId}`);
  if (state !== null) lines.push(`- request state: ${state}`);
  if (path !== null) lines.push(`- request artifact: ${path}`);
  return lines;
}

/** The summary lines one ran entry contributes. Never concludes — see the header. */
function linesForEntry(entryId: string, data: Record<string, unknown> | null): string[] {
  if (entryId === 'ctx-skill-presence') return presenceLines(data);
  if (entryId === 'ctx-request-show') return requestLines(data);
  return [];
}

export async function callContextCompressTool(
  tool: McpToolDefinition,
  args: Readonly<Record<string, unknown>>,
  context: ToolCallContext
): Promise<ToolCallResult> {
  const lines: string[] = [];
  let ran = 0;

  for (const entry of tool.entries) {
    const values = valuesForEntry(entry, args, context);
    if (values === undefined) continue;
    const built = buildArgv(entry, values);
    if (!built.ok) {
      return rejectedResult(entry, `Parameter ${built.param} was refused: ${built.message}`);
    }
    const outcome = await runArgv(entry.id, built.argv, context);
    if (outcome.failure !== undefined) {
      // A source that failed is REPORTED, never silently dropped: a summary
      // missing its request state reads as "there is no request".
      lines.push(`- ${entry.id}: unavailable (${outcome.failure.slice(0, MAX_TEXT)})`);
      continue;
    }
    ran += 1;
    lines.push(...linesForEntry(entry.id, envelopeData(outcome)));
  }

  if (ran === 0 && lines.length === 0) {
    const entry = tool.entries[0];
    return entry === undefined
      ? { content: [{ type: 'text', text: '{"reason":"no entry"}' }], isError: true }
      : rejectedResult(
          entry,
          'No source was runnable; supply a rid and role to include the request.'
        );
  }

  const body = [
    'Peaks-Loop resume summary (facts only; no judgement).',
    ...lines,
    '',
    'Use this in place of re-reading the turns it describes. Anything it does not',
    'state is NOT recorded here — read the artifact paths above rather than assume.'
  ].join('\n');

  return { content: [{ type: 'text', text: body }] };
}
