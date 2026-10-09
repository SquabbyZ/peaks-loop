// src/services/hooks/mcp-surface-gate.ts
//
// L3 for the read-only MCP surface: the pre-tool branch that covers MCP tool
// calls (spec §6.1, §6.2, §6.3).
//
// WHY IT IS ITS OWN MODULE. It shares an entry point with the Bash and worktree
// branches but nothing else: different surface (an MCP tool name, not a command
// text), different failure direction (fail-CLOSED, where the others fail open),
// and a different thing it polices. Keeping it beside them made the interceptor
// file carry three unrelated decisions; it lives here so the file that owns the
// hook's control flow stays the file that owns the hook's control flow.
//
// WHAT IT POLICES, AND WHAT IT DOES NOT. It does not second-guess what a tool
// would return. It answers one question: "is this MCP tool call one the proven
// surface declares?" It exists for DRIFT — a stale server process, a hand-edited
// harness config pointing somewhere else, a tool added to a config that was
// never proved read-only. The read-only proof itself is L2's job; this is the
// belt over it.
//
// FAIL-CLOSED, AND THE ASYMMETRY WITH THE BASH BRANCH IS DELIBERATE. The Bash
// branch guards command TEXT, where a false block interrupts real work, so it
// fails open. This branch guards CONFIG CONSISTENCY, where a false block costs
// one call that should have been consistent while a false allow costs a call
// that bypassed the chain. The costs are not the same size, so they do not share
// a direction — and they do not share a `catch` either.
//
// IT READS THE SURFACE AS DATA, NEVER AS CODE. The allowed tool names come from
// the generated whitelist artifact through its loader, so this branch keeps
// working when `src/services/mcp/` is deleted (spec §1) — which is also what
// `tests/unit/standards/no-mcp-source-import.test.ts` enforces mechanically.

import { getErrorMessage } from 'peaks-loop-shared/result';

import type { ProgramIO } from '../../cli/cli-helpers.js';
import { emitBlock } from './output.js';
import { getAdapter } from '../ide/ide-registry.js';
import type { IdeAdapter } from '../ide/ide-types.js';
import { detectIdeFromContext, parseClaudeShapeStdin } from '../ide/hook-translator.js';
import { matchMcpToolName } from '../ide/mcp-tool-matcher.js';
import { loadReadOnlyWhitelist, toolIdsOf } from '../readonly-surface/readonly-whitelist.js';

/** The tool names the proven surface declares. */
export type McpSurfaceLookup = () => readonly string[];

/** The production lookup. Injectable so a test can make it throw and watch the refusal. */
export function lookupAllowedMcpTools(): readonly string[] {
  return toolIdsOf(loadReadOnlyWhitelist());
}

/** The adapter whose harness sent this payload. */
export function detectAdapter(parsedStdin: unknown): IdeAdapter {
  const ide = detectIdeFromContext({ env: process.env, cwd: process.cwd(), parsedStdin });
  return getAdapter(ide);
}

/** The deny emission, in the shape the host already treats as a hard block. */
export function emitMcpDeny(io: ProgramIO, code: string, reason: string): void {
  emitBlock(
    io,
    `[mcp-surface-gate:${code}] ${reason}. Blocked by fail-closed policy — ` +
      'run the read-only command through the CLI instead, or add its argv to ' +
      'contracts/readonly-surface.json and regenerate the whitelist.'
  );
}

/**
 * Run the MCP branch over one parsed hook payload.
 *
 * @returns `true` when the call was BLOCKED (a deny has already been emitted).
 *          `false` means "this is not an MCP call for this surface" — every
 *          other tool name, and every harness declaring no MCP naming, lands
 *          there and keeps the allow/deny result it had before.
 */
export function handleMcpSurfaceGate(
  io: ProgramIO,
  parsedStdin: unknown,
  lookup: McpSurfaceLookup = lookupAllowedMcpTools,
  adapterOf: (payload: unknown) => IdeAdapter = detectAdapter
): boolean {
  let adapter: IdeAdapter;
  try {
    adapter = adapterOf(parsedStdin);
  } catch (error) {
    // Detection itself failed. Falling through would let the call pass
    // unchecked, which is the one outcome this branch exists to prevent.
    emitMcpDeny(
      io,
      'IDE_DETECTION_FAILED',
      `the harness could not be identified (${getErrorMessage(error)})`
    );
    return true;
  }
  const { toolName } = parseClaudeShapeStdin(parsedStdin);
  const match = toolName === undefined ? undefined : matchMcpToolName(adapter, toolName);
  if (match === undefined) return false;

  let allowed: readonly string[];
  try {
    allowed = lookup();
  } catch (error) {
    emitMcpDeny(
      io,
      'SURFACE_UNREADABLE',
      `the read-only surface could not be read (${getErrorMessage(error)})`
    );
    return true;
  }
  if (allowed.includes(match.toolId)) return false;
  emitMcpDeny(
    io,
    'NOT_IN_READONLY_SURFACE',
    `"${toolName}" is not one of the read-only tools this project declares (${allowed.join(', ') || 'none'})`
  );
  return true;
}
