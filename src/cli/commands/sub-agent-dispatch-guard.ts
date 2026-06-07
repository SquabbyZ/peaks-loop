/**
 * `peaks sub-agent-dispatch-guard` — G9.5 / RL-30 strict hook-only atom.
 *
 * This is the **second-layer** gate (PreToolUse hook) for the G9 forced
 * compression threshold. It re-validates the prompt size against the
 * threshold table in `src/services/context/threshold.ts` and returns
 * `{allow: true/false, reason, suggest}` JSON to the LLM platform.
 *
 * **NO `--force` flag is exposed at this layer** (RL-30 strict). The
 * hook is the strictest layer in the G9 chain. If the CLI is bypassed
 * (e.g. a user manually invokes the dispatch CLI with `--force` to
 * override the 80% threshold), the hook catches it and returns
 * `{allow: false}` regardless.
 *
 * This atom is **hidden from `peaks --help`** per dev-preference
 * "skill-first / CLI-auxiliary" + PB-2 byte-stable. It is registered
 * via the LLM platform's PreToolUse hook chain (e.g. Claude Code's
 * `settings.json` `PreToolUse` array) and is not a user-facing command.
 *
 * The `peaks hooks install` command reads `IdeAdapter.promptSizeAware`
 * to decide whether to register this hook for a given IDE.
 */
import { Command } from 'commander';
import { evaluatePromptSize, type ContextGuardDecision } from '../../services/context/context-guard.js';

export const HOOK_GUARD_RESULT_TYPE = 'peaks-hook-guard/v1' as const;

export interface HookGuardResult {
  readonly schema: typeof HOOK_GUARD_RESULT_TYPE;
  readonly allow: boolean;
  readonly code: ContextGuardDecision['code'];
  readonly reason: string;
  readonly suggest: string | null;
  readonly tier: ContextGuardDecision['evaluation']['tier'];
  readonly ratio: number;
  readonly bytesUsed: number;
  readonly capacityBytes: number;
  readonly warnings: readonly string[];
}

/**
 * Build the hook-guard result for a given prompt size. Pure function;
 * no IO. The CLI atom (registered below) calls this and prints JSON.
 *
 * Even if the caller passes `force = true` in the input (it shouldn't —
 * the hook CLI doesn't expose that flag), this function ignores it
 * and treats the prompt as if no override were available. This is the
 * RL-30 strict semantics.
 */
export function evaluateHookGuard(promptSize: number): HookGuardResult {
  // Intentionally pass `force: false` always. The hook layer is strict.
  const decision = evaluatePromptSize(promptSize, { force: false });
  return {
    schema: HOOK_GUARD_RESULT_TYPE,
    allow: decision.allow,
    code: decision.code,
    reason: decision.allow
      ? `prompt size ${promptSize} bytes within threshold (tier=${decision.evaluation.tier})`
      : `prompt size ${promptSize} bytes exceeds threshold (tier=${decision.evaluation.tier}, ratio=${decision.evaluation.ratio.toFixed(3)})`,
    suggest: decision.suggest,
    tier: decision.evaluation.tier,
    ratio: decision.evaluation.ratio,
    bytesUsed: decision.evaluation.bytesUsed,
    capacityBytes: decision.evaluation.capacityBytes,
    warnings: decision.warnings
  };
}

/**
 * Register the `peaks sub-agent-dispatch-guard` command. Intentionally
 * NOT registered in the main `peaks --help` quickstart (dev-preference
 * PB-2 byte-stable). The caller (the `peaks hooks install` flow) calls
 * this directly via the imported function; the CLI registration in
 * `src/cli/index.ts` uses a hidden command (no `description`, no help).
 */
export function registerSubAgentDispatchGuard(program: Command): void {
  program
    .command('sub-agent-dispatch-guard')
    .description('INTERNAL: PreToolUse hook guard (G9.5 / RL-30 strict)')
    .requiredOption('--prompt <text>', 'the prompt to validate (size in bytes is what gets checked)')
    .action((options: { prompt: string }) => {
      const promptSize = Buffer.byteLength(options.prompt, 'utf8');
      const result = evaluateHookGuard(promptSize);
      // Always exit 0 — the LLM platform reads `allow` from JSON.
      // The decision is encoded in `allow` / `code`, not the exit code.
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    });
}
