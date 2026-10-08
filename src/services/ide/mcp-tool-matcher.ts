// src/services/ide/mcp-tool-matcher.ts
//
// The vendor-translation layer for MCP tool NAMES (spec §6.3, §13).
//
// An MCP tool's name is harness-specific AND channel-specific: the very same
// `peaks_status` tool is spelled one way when the server is registered directly
// and another way when it arrives through a plugin. A matcher hard-coded against
// one spelling keeps working on the channel it was written for and SILENTLY
// stops firing on the other — the failure mode is an enforcement layer that
// reports nothing because it never ran. So the spellings are declared by the
// adapter (`IdeAdapter.mcp`) and this module is the only place that turns a
// declaration into (a) a match against a concrete tool name and (b) the
// PreToolUse matcher written into the harness's settings.
//
// Vendor names do not belong here: every string below is either generic syntax
// or comes from the adapter. The isolation zone lives in `adapters/`.

import type { IdeAdapter, IdeMcpProfile } from './ide-types.js';

/** The placeholder an adapter's tool-name template uses for the bare tool id. */
export const TOOL_ID_PLACEHOLDER = '*';

/** A concrete tool name matched back to the adapter template that produced it. */
export interface McpToolMatch {
  /** The bare tool id — the part the template's placeholder stood for. */
  readonly toolId: string;
  /** The template that matched, so a caller can report which channel fired. */
  readonly template: string;
}

/** The declared profile, or an empty one for an adapter that opts out. */
export function mcpProfileOf(adapter: IdeAdapter): IdeMcpProfile | undefined {
  return adapter.mcp;
}

/** Every tool-name template the adapter declares, in declaration order. */
export function mcpToolNameTemplates(adapter: IdeAdapter): readonly string[] {
  return adapter.mcp?.toolNameTemplates ?? [];
}

/** Escape a literal segment so it cannot act as a pattern metacharacter. */
function escapeLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Split a template on its placeholder. A template must carry EXACTLY one
 * placeholder: zero would make the tool id unaddressable, and two would make the
 * captured id ambiguous. Both are adapter bugs, so they throw with the template
 * in the message rather than degrading to a matcher that matches nothing.
 */
function splitTemplate(template: string): readonly [string, string] {
  const parts = template.split(TOOL_ID_PLACEHOLDER);
  if (parts.length !== 2 || parts[0] === undefined || parts[1] === undefined) {
    throw new Error(
      `MCP tool-name template '${template}' must contain exactly one '${TOOL_ID_PLACEHOLDER}' placeholder.`
    );
  }
  return [parts[0], parts[1]];
}

/** The concrete harness tool name for a tool id under one template. */
export function mcpToolName(template: string, toolId: string): string {
  const [prefix, suffix] = splitTemplate(template);
  return `${prefix}${toolId}${suffix}`;
}

/**
 * The tool id a concrete name carries under one template, or `undefined`. The
 * template is anchored: an unanchored match would let a longer name smuggle the
 * id (and would make `matchMcpToolName` order-dependent).
 */
export function mcpToolIdFrom(template: string, toolName: string): string | undefined {
  const [prefix, suffix] = splitTemplate(template);
  const pattern = new RegExp(`^${escapeLiteral(prefix)}(.*)${escapeLiteral(suffix)}$`);
  const matched = pattern.exec(toolName);
  return matched?.[1];
}

/**
 * Match a concrete harness tool name against every template the adapter
 * declares, in declaration order. This is the ONE entry point the enforcement
 * branch uses, so "which channels are covered" is answered by the adapter alone.
 */
export function matchMcpToolName(adapter: IdeAdapter, toolName: string): McpToolMatch | undefined {
  for (const template of mcpToolNameTemplates(adapter)) {
    const toolId = mcpToolIdFrom(template, toolName);
    if (toolId !== undefined) return { toolId, template };
  }
  return undefined;
}

/**
 * The PreToolUse `matcher` source covering every declared channel, ready to be
 * joined into a hook entry's matcher field. `*` becomes `.*` and everything else
 * is escaped, so the source matches exactly the names the templates describe.
 */
export function mcpHookMatcher(adapter: IdeAdapter): string | undefined {
  const sources = mcpToolNameTemplates(adapter).map((template) => {
    const [prefix, suffix] = splitTemplate(template);
    return `${escapeLiteral(prefix)}.*${escapeLiteral(suffix)}`;
  });
  return sources.length === 0 ? undefined : sources.join('|');
}
