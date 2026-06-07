import { PEAKS_HOOK_SCHEMA, type IdeId, type PeaksCanonicalHook, type PeaksDecisionTransport } from './ide-types.js';

export { PEAKS_HOOK_SCHEMA };
export type { PeaksCanonicalHook, PeaksDecisionTransport };

/**
 * Compute the deny decision shape for Claude Code (the only adapter registered
 * in slice #1). The output is a JSON object that, when written to stdout, makes
 * the Claude Code permission system block the tool call BEFORE the user's
 * permission prompt — un-bypassable, even under --dangerously-skip-permissions.
 */
export const CLAUDE_CODE_DENY_SHAPE: Record<string, unknown> = {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: '__REASON__'  // replaced at format time
  }
};

export const CLAUDE_CODE_DENY_TRANSPORT: PeaksDecisionTransport = {
  kind: 'stdout-json',
  denyShape: CLAUDE_CODE_DENY_SHAPE
};

/**
 * Compute the deny decision shape for Trae (Cursor-style sibling IDE).
 * VERIFIED against Trae 1.x fixture — slice 009-009-2026-06-07-trae-dogfood (2026-06-07).
 * Shape is the standard Cursor/Claude sibling envelope: `hookSpecificOutput`
 * with `hookEventName`, `permissionDecision`, `permissionDecisionReason`.
 * The hookEventName is `'beforeToolCall'` for Trae vs `'PreToolUse'` for
 * Claude Code — the only field that differs between the two siblings.
 * Fixture: tests/fixtures/trae/trae-1x-payload.json. Constant NAME preserved
 * (per slice 009 PRD R-3); only the shape was already correct from slice #3.
 */
export const TRAE_DENY_SHAPE: Record<string, unknown> = {
  hookSpecificOutput: {
    hookEventName: 'beforeToolCall',
    permissionDecision: 'deny',
    permissionDecisionReason: '__REASON__'  // replaced at format time
  }
};

export const TRAE_DENY_TRANSPORT: PeaksDecisionTransport = {
  kind: 'stdout-json',
  denyShape: TRAE_DENY_SHAPE
};

/**
 * Format a decision response for a given IDE. Slice #1 handles Claude Code;
 * slice #3 added Trae (1.x-assumption shape — see TRAE_DENY_SHAPE doc).
 * Future slices will add exit-code / both variants for IDEs that don't read
 * stdout.
 */
export function formatDecisionResponse(
  ide: IdeId,
  decision: 'allow' | 'deny',
  reason?: string
): { stdout: string; exitCode: number } {
  if (decision === 'allow') {
    return { stdout: '', exitCode: 0 };
  }
  let shape: Record<string, unknown>;
  if (ide === 'claude-code') {
    shape = CLAUDE_CODE_DENY_SHAPE;
  } else if (ide === 'trae') {
    shape = TRAE_DENY_SHAPE;
  } else {
    throw new Error(`formatDecisionResponse: unsupported IDE ${ide} (not registered in adapter registry; future slice will add support)`);
  }
  const filled = JSON.stringify(shape).replace('"__REASON__"', JSON.stringify(reason ?? 'denied'));
  return { stdout: filled, exitCode: 0 };
}

/**
 * Build a peaks canonical hook from a parsed stdin payload. Caller has already
 * done stdin parsing + IDE auto-detection; this function normalizes to the
 * canonical schema.
 */
export interface BuildCanonicalHookInput {
  readonly toolName: string;
  readonly toolInput: Record<string, unknown>;
  readonly projectRoot: string;
  readonly rawIdeFormat: IdeId;
  readonly rawPayload: unknown;
  readonly event?: PeaksCanonicalHook['event'];
}

export function buildCanonicalHook(input: BuildCanonicalHookInput): PeaksCanonicalHook {
  return {
    schema: PEAKS_HOOK_SCHEMA,
    event: input.event ?? 'pre-tool-use',
    toolName: input.toolName,
    toolInput: input.toolInput,
    projectRoot: input.projectRoot,
    rawIdeFormat: input.rawIdeFormat,
    rawPayload: input.rawPayload
  };
}
