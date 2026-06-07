/**
 * G9.5 PreToolUse hook execution body.
 *
 * Wraps `peaks sub-agent-dispatch-guard` for LLM platform integration.
 * The hook reads the prompt size from the LLM platform's hook stdin
 * (Claude Code / Trae / etc.), invokes the guard CLI, and returns
 * `{allow: true/false, reason, suggest}` JSON to the LLM platform.
 *
 * The hook is registered via `peaks hooks install` in the LLM
 * platform's `settings.json` `PreToolUse` array. Only IDEs with
 * `IdeAdapter.promptSizeAware: true` get the hook installed.
 *
 * The hook layer is the **strictest** layer in the G9 chain (RL-30).
 * The CLI 兜底 layer (`peaks sub-agent dispatch --force`) can override
 * the 80% threshold; the hook layer CANNOT.
 */
import { spawnSync } from 'node:child_process';
import { evaluateHookGuard, type HookGuardResult } from '../cli/commands/sub-agent-dispatch-guard.js';

/**
 * Read the prompt size from the LLM platform's hook stdin. Different
 * LLMs send different payload shapes; we accept the most common:
 *   - Claude Code: `{"tool_name": "Bash", "tool_input": {"command": "..."}}`
 *   - Trae: `{"tool_name": "terminal", "tool_input": {"command": "..."}}`
 *
 * The hook reads the `command` (or `prompt`) field and computes the
 * byte length. If neither field is present, returns 0 (always passes).
 */
export function readPromptSizeFromHookStdin(stdin: unknown): number {
  if (stdin === null || typeof stdin !== 'object') {
    return 0;
  }
  const obj = stdin as Record<string, unknown>;
  const toolInput = obj.tool_input;
  if (toolInput === null || typeof toolInput !== 'object') {
    return 0;
  }
  const ti = toolInput as Record<string, unknown>;
  const candidates = ['command', 'prompt', 'text', 'input'];
  for (const key of candidates) {
    const v = ti[key];
    if (typeof v === 'string') {
      return Buffer.byteLength(v, 'utf8');
    }
  }
  return 0;
}

/**
 * Execute the hook guard via spawnSync. Returns the parsed result or
 * a fallback (allow: true) on subprocess failure.
 *
 * Prefer the in-process `evaluateHookGuard` (no subprocess) when the
 * hook is called from a TypeScript context. Use `runHookGuardSubprocess`
 * only when the hook needs to be invoked from a non-TypeScript caller
 * (e.g. a shell script that wraps the peaks CLI).
 */
export function runHookGuardSubprocess(prompt: string): HookGuardResult {
  const result = spawnSync('node', [
    process.argv[1] ?? 'peaks',
    'sub-agent-dispatch-guard',
    '--prompt', prompt,
    '--json'
  ], { encoding: 'utf8' });
  if (result.status !== 0) {
    // Fallback: allow (don't block the dispatch on a guard subprocess failure).
    return {
      schema: 'peaks-hook-guard/v1',
      allow: true,
      code: 'OK',
      reason: `guard subprocess failed (status ${result.status}); falling through`,
      suggest: null,
      tier: 'ok',
      ratio: 0,
      bytesUsed: 0,
      capacityBytes: 0,
      warnings: ['HOOK_GUARD_SUBPROCESS_FAILED']
    };
  }
  try {
    return JSON.parse(result.stdout) as HookGuardResult;
  } catch {
    return {
      schema: 'peaks-hook-guard/v1',
      allow: true,
      code: 'OK',
      reason: 'guard subprocess produced unparseable JSON; falling through',
      suggest: null,
      tier: 'ok',
      ratio: 0,
      bytesUsed: 0,
      capacityBytes: 0,
      warnings: ['HOOK_GUARD_SUBPROCESS_INVALID_JSON']
    };
  }
}

/**
 * Main entry point for the hook. Reads the LLM platform's stdin,
 * computes the prompt size, and returns the guard result. Used by
 * the LLM platform's hook JSON to decide whether to allow the tool
 * call.
 */
export function runHookGuard(stdin: unknown): HookGuardResult {
  const promptSize = readPromptSizeFromHookStdin(stdin);
  return evaluateHookGuard(promptSize);
}
