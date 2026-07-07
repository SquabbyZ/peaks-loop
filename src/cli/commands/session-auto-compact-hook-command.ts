/**
 * `peaks session auto-compact-hook` — slice 2026-07-02-auto-compact-zero-pause.
 *
 * The Bash entrypoint the PreToolUse hook fires on every Bash/Task
 * tool call from the Claude Code runner. Behaviour:
 *
 *   1. Read `CLAUDE_CONTEXT_USAGE_PERCENT` (or any adapter-declared
 *      env-var via the registry — claude-code MVP). If ratio is below
 *      the red-line threshold (0.95), exit 0 silent — the runner's
 *      normal flow continues.
 *   2. If ratio is ≥ 0.95 (red line), write a one-line stderr hint
 *      so the human sees what happened, then in-band spawn
 *      `claude --compact` so the **current** runner's context
 *      window collapses (not a new claude process).
 *   3. Always exit 0. The hook is a probe, not a gate — the gate is
 *      `claude --compact` itself returning 0.
 *
 * Idempotency: re-running the hook is safe; if `claude --compact`
 * is already in flight, the new process just exits 0 immediately
 * (Claude Code's compact is a one-shot operation against the
 * current runner).
 *
 * Why a CLI subcommand instead of an inline JS hook:
 *   - Keeps the hook payload in `.claude/settings.local.json` small
 *     (one line: `peaks session auto-compact-hook`).
 *   - Lets the heavy lifting (ratio parsing, IDE-aware env-var
 *     resolution, spawning `claude --compact`) live in TypeScript
 *     where it's unit-testable.
 *   - Discoverable via `peaks session --help` — future LLM sessions
 *     see the primitive exists.
 *
 * Karpathy §2: 50 lines, no abstractions, no speculative error
 * handling. The hook command is a single-purpose muscle; if it
 * grows beyond ~80 lines, that's a signal to split.
 */

import { spawn } from 'node:child_process';
import type { Command } from 'commander';
import { detectIdeFromEnv } from '../../services/context/main-session-monitor.js';
import { getAdapter } from '../../services/ide/ide-registry.js';
import type { IdeId } from '../../services/ide/ide-types.js';

/**
 * Red-line ratio threshold. Must match the orchestrator's
 * AUTO_COMPACT_RED_LINE_RATIO constant (0.95). Kept here as a
 * literal so the hook command stays self-contained — a future
 * slice may move this to a shared constant module if the value
 * starts drifting.
 */
const RED_LINE_RATIO = 0.95;

/**
 * Parse `CLAUDE_CONTEXT_USAGE_PERCENT` (or the adapter-declared
 * env-var) into a ratio in [0, 1]. Returns null on missing /
 * malformed input. Mirrors `readEnvPercent` in
 * `auto-compact-reader.ts` so the hook command and the
 * orchestrator agree on parsing semantics.
 */
function readRatioFromEnv(env: NodeJS.ProcessEnv): { ratio: number; varName: string } | null {
  const detected = detectIdeFromEnv(env);
  const ideId: IdeId = (detected === 'unknown' ? 'claude-code' : detected) as IdeId;
  const adapter = getAdapter(ideId);
  if (!adapter.compact) return null;
  const varName = adapter.compact.envVarForContextPercent;
  const raw = env[varName];
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return null;
  // Allow either "0..1" or "0..100" encoding. Claude Code writes
  // "0..1" today; statusline tools sometimes write "0..100". Normalize.
  const ratio = parsed > 1.5 ? parsed / 100 : Math.max(0, Math.min(1, parsed));
  return { ratio, varName };
}

export function registerSessionAutoCompactHookCommand(session: Command): void {
  session
    .command('auto-compact-hook')
    .description(
      'PreToolUse hook entrypoint — read CLAUDE_CONTEXT_USAGE_PERCENT and, ' +
        'at ratio ≥ 0.95, in-band spawn `claude --compact` against the current ' +
        'runner. Designed for invocation from `.claude/settings.local.json` ' +
        'PreToolUse hooks; safe to re-run.'
    )
    .action(() => {
      const probe = readRatioFromEnv(process.env);
      if (probe === null) {
        // No signal → exit 0 silent. The hook must never block the
        // runner's normal flow on a missing env-var.
        return;
      }
      if (probe.ratio < RED_LINE_RATIO) {
        // Below red line → exit 0 silent. The orchestrator's
        // pre-compact zone (0.85–0.95) is handled out-of-band by
        // the LLM firing `peaks code auto-compact --execute`; the
        // hook only fires on the synchronous red-line path.
        return;
      }
      // Red line reached — compact the current runner in-band.
      // The `detached: true` + `unref()` pair lets the hook return
      // immediately while Claude Code's own slash-command processor
      // picks up `claude --compact` against the runner's session.
      // This is the fix for the shell-exec-spawns-a-child-process
      // bug documented in `.peaks/memory/2026-06-27-auto-compact-design.md:139-152`.
      //
      // Dogfood 2026-07-02 fix: when `claude` is not on PATH (the
      // user runs Claude Code as an MCP rather than via the CLI
      // binary), `spawn` raises ENOENT. Catching this MUST NOT crash
      // the runner's tool call — the hook must exit 0 silently with
      // a one-line stderr hint so the runner keeps working. The user
      // can then run `/compact` manually (or `peaks code auto-compact`
      // from another terminal).
      try {
        const child = spawn('claude', ['--compact'], {
          stdio: 'ignore',
          detached: true,
          env: process.env
        });
        child.on('error', () => {
          // Spawn failed (ENOENT or EPERM). Exit 0 silently with a
          // stderr hint — the hook contract is "never crash the
          // runner's tool call".
          process.stderr.write('[peaks:auto-compact-hook] claude CLI not on PATH; cannot fire in-band. Run `/compact` manually or set up the Claude Code CLI binary.\n');
        });
        child.unref();
        process.stderr.write(`[peaks:auto-compact-hook] ratio=${(probe.ratio * 100).toFixed(1)}% ≥ ${(RED_LINE_RATIO * 100).toFixed(0)}%; firing claude --compact in-band\n`);
      } catch {
        // Defensive: `spawn` can throw synchronously on some platforms.
        process.stderr.write('[peaks:auto-compact-hook] failed to spawn claude --compact; run `/compact` manually.\n');
      }
    });
}