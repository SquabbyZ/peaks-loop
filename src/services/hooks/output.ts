/**
 * peaks hook output contract. See `.claude/HOOKS.md` for the canonical doc.
 *
 * Four helpers, one job: enforce the stdout/stderr/exit-code discipline
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
 *   emitResultDocument(io, envelope)
 *     - Writes the command's result envelope to io.stdout as ONE JSON
 *       document and its action lines to io.stderr as `next: ...`.
 *     - Carries NO root `decision` and NO hookSpecificOutput: the host
 *       OWNS the root `decision` key and accepts only {approve, block},
 *       and a pass-through grant would bypass the user's own permission
 *       prompt. Exit 0 is the pass-through signal.
 *     - Does NOT set process.exitCode.
 *
 * Platform notes:
 *   - The contract is platform-independent. The helpers write to ProgramIO
 *     (stdout / stderr) only; no path separators, no shell escaping, no
 *     line-ending variants. The cross-platform contract test pins this.
 *   - On win32, Node's process.stdout and process.stderr are binary-safe
 *     and UTF-8; do not introduce \r\n anywhere. The contract is LF.
 */

import type { ResultEnvelope } from 'peaks-loop-shared/result';

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

/**
 * Result document — a command's result envelope as ONE JSON document on
 * stdout, with its action lines on stderr.
 *
 * This is the hook-mode replacement for `printResult(io, envelope, false)`.
 * That printer is written for a human at a terminal: it flattens `data` to the
 * ROOT of stdout, then appends `next: ...` prose to the same stream. For a
 * command whose stdout IS the hook's decision channel, both halves are wrong.
 * A payload's own `decision` becomes a ROOT `decision` — a key the host OWNS,
 * with vocabulary {approve, block} — which is the "decision: Invalid option"
 * error the user saw on every Bash call; and the trailing prose makes stdout
 * unparseable as one document.
 *
 * The document emitted here is the SAME envelope `--json` already prints, so a
 * command has ONE machine shape in both modes and the shape cannot drift
 * between them. The prose moves to stderr, where a hint belongs and where the
 * host never reads a decision from.
 *
 * It deliberately does NOT carry a `hookSpecificOutput` allow decision: an
 * allow is a real permission GRANT that bypasses the user's own permission
 * prompt, and a gate that passes a call through has no opinion to give. Exit 0
 * is the pass-through signal.
 */
export function emitResultDocument<T>(io: ProgramIO, envelope: ResultEnvelope<T>): void {
  io.stdout(JSON.stringify(envelope, null, 2));
  for (const action of envelope.nextActions) {
    emitHint(io, `next: ${action}`);
  }
}
