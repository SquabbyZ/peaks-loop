// src/services/mcp/memory-tool.ts
//
// `peaks_memory_search`: one argv, a bounded reply (§7.1).
//
// It answers "is there anything, and what is it called" — never "what does it
// say". The raw CLI output is measured in megabytes, so the reply is bounded
// twice over: a hard ceiling on how many matches come back, and a truncated
// excerpt per match. Both are on §3.2's allowed list for a composite tool
// (field selection and truncation), and neither concludes anything: the count,
// the names and the first characters are all the CLI's.

import { buildArgv } from '../readonly-surface/argv-guard.js';
import type { McpToolDefinition } from './surface.js';
import {
  MEMORY_EXCERPT_CHARS,
  MEMORY_MAX_RETURNED,
  rejectedResult,
  resultOf,
  runArgv,
  valuesForEntry,
  type ToolCallContext,
  type ToolCallResult
} from './tool-core.js';

/** Project one raw CLI match down to the fields §7.1 allows, with a bounded excerpt. */
function boundMatch(raw: unknown): Record<string, unknown> {
  const match = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const description = typeof match['description'] === 'string' ? match['description'] : '';
  return {
    name: match['name'],
    kind: match['kind'],
    excerpt: description.slice(0, MEMORY_EXCERPT_CHARS)
  };
}

export async function callMemorySearchTool(
  tool: McpToolDefinition,
  args: Readonly<Record<string, unknown>>,
  context: ToolCallContext
): Promise<ToolCallResult> {
  const entry = tool.entries[0];
  if (entry === undefined) {
    return { content: [{ type: 'text', text: '{"reason":"no entry"}' }], isError: true };
  }
  const values = valuesForEntry(entry, args, context);
  if (values === undefined) {
    return rejectedResult(entry, 'A search query is required.');
  }
  const built = buildArgv(entry, values);
  if (!built.ok) {
    return rejectedResult(entry, `Parameter ${built.param} was refused: ${built.message}`);
  }
  const outcome = await runArgv(entry.id, built.argv, context);
  if (outcome.failure !== undefined) return resultOf([outcome]);

  const envelope = outcome.envelope;
  const record =
    typeof envelope === 'object' && envelope !== null ? (envelope as Record<string, unknown>) : {};
  const matches = record['matches'];
  if (!Array.isArray(matches)) {
    // No `matches` array is not "nothing matched" — it is a shape this tool does
    // not understand, and reporting it as empty is the failure §9 rule 3 names.
    const argv = outcome.execution.argv.join(' ');
    return resultOf([
      { ...outcome, failure: `peaks memory search returned no matches array: peaks ${argv}` }
    ]);
  }
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          query: record['query'],
          total: record['total'],
          matches: matches.slice(0, MEMORY_MAX_RETURNED).map(boundMatch)
        })
      }
    ]
  };
}
