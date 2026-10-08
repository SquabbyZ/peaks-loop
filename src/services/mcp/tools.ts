// src/services/mcp/tools.ts
//
// `peaks_status`, and the table that routes a `tools/call` to its handler. The
// result shape, the argument-to-argv step and the outcome rendering live in
// `tool-core.ts`; the bounded memory tool lives in `memory-tool.ts`.
//
// The composite is a pipe with a shape, never a judge (spec §3.2): "a composite
// tool may arrange and reshape; it may not CONCLUDE." Each CLI envelope is
// embedded VERBATIM under the whitelist entry id that produced it, so the whole
// result is an identity transform of the calls it ran. A key is absent when its
// argv did not run — exactly "subset"; no branch fabricates a value no argv
// returned.

import { buildArgv } from '../readonly-surface/argv-guard.js';
import { callMemorySearchTool } from './memory-tool.js';
import type { McpToolDefinition } from './surface.js';
import {
  rejectedResult,
  resultOf,
  runArgv,
  valuesForEntry,
  type EntryOutcome,
  type ToolCallContext,
  type ToolCallResult
} from './tool-core.js';

/**
 * `peaks_status`: run every argv the caller supplied enough for, and return each
 * CLI envelope verbatim under the id of the whitelist entry that produced it.
 */
export async function callStatusTool(
  tool: McpToolDefinition,
  args: Readonly<Record<string, unknown>>,
  context: ToolCallContext
): Promise<ToolCallResult> {
  // Every argv is BUILT before any is run. Executing as we go meant a refused
  // placeholder left the earlier argv of the same call already executed — a
  // caller's malformed input would have reached the CLI's read path anyway.
  const plan: Array<{ id: string; argv: readonly string[] }> = [];
  for (const entry of tool.entries) {
    const values = valuesForEntry(entry, args, context);
    if (values === undefined) continue;
    const built = buildArgv(entry, values);
    if (!built.ok) {
      return rejectedResult(entry, `Parameter ${built.param} was refused: ${built.message}`);
    }
    plan.push({ id: entry.id, argv: built.argv });
  }
  const outcomes: EntryOutcome[] = [];
  for (const step of plan) {
    outcomes.push(await runArgv(step.id, step.argv, context));
  }
  return resultOf(outcomes);
}

type ToolHandler = (
  tool: McpToolDefinition,
  args: Readonly<Record<string, unknown>>,
  context: ToolCallContext
) => Promise<ToolCallResult>;

/**
 * Tool name -> handler, spelled out rather than derived. A tool the whitelist
 * declares but this table does not name cannot be served, and `missingHandlers`
 * below turns that into a refusal to start instead of a call that answers with
 * whatever the fallback branch happened to do.
 */
const TOOL_HANDLERS: Readonly<Record<string, ToolHandler>> = {
  peaks_status: callStatusTool,
  peaks_memory_search: callMemorySearchTool
};

/** Tools the surface declares that no handler can serve. Non-empty = refuse to start. */
export function missingHandlers(tools: readonly McpToolDefinition[]): readonly string[] {
  return tools.map((tool) => tool.name).filter((name) => !(name in TOOL_HANDLERS));
}

/** Route a `tools/call` to its handler, or `undefined` for a tool nobody serves. */
export function handlerFor(name: string): ToolHandler | undefined {
  return TOOL_HANDLERS[name];
}
