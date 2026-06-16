/**
 * Slice 003-2026-06-16-hook-governance — single source of truth for the
 * peaks hook output contract. See `.claude/HOOKS.md` for the canonical doc.
 *
 * Three helpers, one job: enforce the stdout/stderr/exit-code discipline
 * that every peaks-managed hook command MUST follow. Centralising the
 * contract here lets us:
 *   1. Pin the contract in cross-platform tests (tests/unit/hooks/contract.test.ts).
 *   2. Add a new helper (e.g. emitAsk) without changing every call site.
 *   3. Stop hand-rolling the deny JSON in gate-commands.ts / hook-handle.ts,
 *      which historically drifted into "PreToolUse:Bash hook error" noise.
 *
 * The contract (intentionally redundant with the doc; the doc is for humans,
 * this is for the type checker):
 *
 *   emitHint(io, text)
 *     - Writes `text` to io.stderr with a trailing newline.
 *     - Does NOT write to io.stdout (the host reads stdout as the decision
 *       signal; a hint on stdout is interpreted as a malformed decision).
 *     - Does NOT set a non-zero process.exitCode. A hint is diagnostic only;
 *       it must not change the host's permission decision.
 *     - Empty `text` is a no-op (skips both the write and the trailing
 *       newline so we never pollute stderr with blank lines).
 *
 *   emitBlock(io, reason)
 *     - Builds the Claude-Code-shaped deny JSON:
 *         { "hookSpecificOutput": { "hookEventName": "PreToolUse",
 *                                   "permissionDecision": "deny",
 *                                   "permissionDecisionReason": <reason> } }
 *       JSON.stringify is the canonical escape for the reason; quotes,
 *       backslashes, and newlines inside the reason are preserved.
 *     - Writes the serialized JSON to io.stdout with a trailing newline.
 *     - Sets process.exitCode = 2. Claude Code treats exit-2 as the
 *       "block" signal (see [Fact-Forcing Gate] note in .claude/HOOKS.md);
 *       the JSON on stdout is the human-readable reason for the LLM.
 *     - Surfaces the reason to io.stderr so an operator running the
 *       hook command directly (or the LLM inspecting logs) can see
 *       WHY the tool was blocked, not just THAT it was blocked.
 *
 *   emitDecision(io, decision)
 *     - Writes the caller-provided decision JSON to io.stdout with a
 *       trailing newline and returns the serialized string. Used by
 *       IDE adapters that produce a different shape (e.g. Trae uses
 *       hookEventName='beforeToolCall' instead of 'PreToolUse'). The
 *       helper is intentionally shape-agnostic: the caller is the
 *       adapter's `formatDecisionResponse`, which already knows the
 *       IDE-specific shape.
 *     - Does NOT set a non-zero process.exitCode. The decision is
 *       communicated entirely via the stdout JSON; the host reads
 *       permissionDecision='deny' to block. Setting exit=2 on top
 *       of the JSON would be double-signaling.
 *
 * Platform notes:
 *   - The contract is platform-independent. The helpers write to ProgramIO
 *     (stdout / stderr) only; no path separators, no shell escaping, no
 *     line-ending variants. The cross-platform contract test pins this.
 *   - On win32, Node's process.stdout and process.stderr are binary-safe
 *     and UTF-8; do not introduce \r\n anywhere. The contract is LF.
 */

import type { ProgramIO } from '../../cli/cli-helpers.js';

/** Exit code the host treats as a hard block (Claude Code convention). */
export const HOOK_BLOCK_EXIT_CODE = 2;

/** Canonical Claude-Code hook event name. */
export const CLAUDE_CODE_HOOK_EVENT = 'PreToolUse';

/** Permissive decision shape — anything JSON-serialisable. */
export type DecisionShape = Record<string, unknown>;

/**
 * Hint — diagnostic, stderr-only, never affects the host decision.
 * Returns the bytes written to stderr (or '' for an empty hint).
 */
export function emitHint(io: ProgramIO, text: string): string {
  if (text.length === 0) {
    return '';
  }
  const line = text.endsWith('\n') ? text : `${text}\n`;
  io.stderr(line);
  return line;
}

/** Result of a block emission — the bytes written to stdout and the original reason. */
export type EmitBlockResult = { readonly stdout: string; readonly reason: string };

/**
 * Block — deny a tool call. Writes the Claude-Code-shaped deny JSON to
 * stdout, sets process.exitCode = 2, and surfaces the reason to stderr.
 */
export function emitBlock(io: ProgramIO, reason: string): EmitBlockResult {
  const safeReason = reason.length > 0 ? reason : 'denied by peaks';
  const payload: DecisionShape = {
    hookSpecificOutput: {
      hookEventName: CLAUDE_CODE_HOOK_EVENT,
      permissionDecision: 'deny',
      permissionDecisionReason: safeReason
    }
  };
  const serialized = JSON.stringify(payload);
  io.stdout(serialized);
  io.stdout('\n');
  io.stderr(`peaks: ${safeReason}\n`);
  process.exitCode = HOOK_BLOCK_EXIT_CODE;
  return { stdout: serialized, reason: safeReason };
}

/**
 * Decision — write a caller-built decision object to stdout. Returns the
 * serialized bytes so callers can log / assert on the exact string.
 *
 * Accepts either a plain object (canonical path; the helper does the
 * JSON.stringify) or a pre-serialized string (used by adapter dispatch
 * where `formatDecisionResponse` already serialized the IDE-shaped
 * envelope). The string form is the legacy escape hatch and should not
 * be used for new code.
 */
export function emitDecision(io: ProgramIO, decision: DecisionShape | string): string {
  const serialized = typeof decision === 'string' ? decision : JSON.stringify(decision);
  io.stdout(serialized);
  io.stdout('\n');
  return serialized;
}
