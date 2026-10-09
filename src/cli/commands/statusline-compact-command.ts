// src/cli/commands/statusline-compact-command.ts
//
// `peaks statusline compact` — the single-line auto-compact indicator.
// Split out of `statusline-commands.ts`; the label, the JSON envelope and the
// option-merge order are unchanged.
//
// --session-id contract: the flag is registered on this subcommand but NOT on
// the default `peaks statusline` render path. It is the internal-supported
// surface for the QA / LLM layer (the integration test, the QA criteria, and
// any future peaks-loop-internal tool that wants to read a non-canonical
// session's compact state). The IDE consumer (Claude Code) does NOT need it —
// its primary-line path binds to the canonical session via
// `getSessionIdCanonical(projectRoot)`. The compact subcommand is the "I have a
// specific session id in mind" surface; the default render is the "use the
// canonical binding" surface.

import type { Command } from 'commander';
import { getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import {
  decideCompactStatusline,
  renderCompactStatusline
} from '../../services/compact-statusline/compact-statusline-service.js';
import { getSessionIdCanonical } from '../../services/session/session-manager.js';
import { resolveProjectRoot, type CompactOptions } from './statusline-command-shared.js';

export function runStatuslineCompact(
  io: ProgramIO,
  options: CompactOptions,
  command: Command
): void {
  // Re-resolve options via `command.optsWithGlobals()` (Commander 12.x
  // compatibility): when the parent `statusline` command has its own `--json`
  // registered AND the user types `peaks statusline compact --json`,
  // commander's parent-vs-child option parser can land `--json` on the parent
  // scope only. `optsWithGlobals()` merges parent + child options so the JSON
  // branch fires regardless of which scope commander assigned the flag to.
  // Verified by the `compact --json emits the documented envelope` test.
  const merged: CompactOptions = { ...options, ...command.optsWithGlobals?.() };
  try {
    const projectRoot = resolveProjectRoot(merged.project);
    const sid = merged.sessionId ?? getSessionIdCanonical(projectRoot) ?? null;
    // `--now` is passed through when present so deterministic lifecycle-window
    // checks stay in-range under full-suite concurrency. See `--now` doc on the
    // parent `statusline` command.
    const now = merged.now !== undefined ? Number(merged.now) : Date.now();
    const state = decideCompactStatusline({ projectRoot, sessionId: sid, now });
    const label = renderCompactStatusline(state);
    // For non-JSON mode we print the LABEL DIRECTLY to stdout (no envelope
    // wrapping) because the consumer is the IDE statusline, not a peaks-Loop
    // caller.
    if (merged.json === true) {
      printResult(io, ok('statusline.compact', { label, state }), merged.json);
    } else {
      process.stdout.write(`${label}\n`);
    }
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    printResult(
      io,
      fail('statusline.compact', 'STATUSLINE_COMPACT_FAILED', message, {}, [message]),
      merged.json ?? false
    );
    process.exitCode = 1;
  }
}
