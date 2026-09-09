/**
 * Slice 2026-06-24-test-tool-detection-injection.
 *
 * The Test Tool Detection block is prepended to every sub-agent prompt
 * dispatched by peaks-loop (both the single-dispatch chokepoint in
 * `src/cli/commands/dispatch-commands.ts` and the DAG-dispatch chokepoint
 * in `src/services/code/dag-orchestrator.ts`). It tells the sub-agent
 * to read `package.json#scripts.test` first and use the project-local
 * runner — never `npx <runner>` — so it cannot bypass the lockfile or
 * spawn a network-bound tool call.
 *
 * Why a static constant (not a per-call detector):
 *  1. Predictable byte budget — the block is part of PROMPT_LIMIT_BYTES
 *     accounting (see dispatch-commands.ts line 113), and the size must
 *     be stable across calls.
 *  2. I/O-free — dispatch is a hot path; reading package.json here would
 *     add a filesystem hit per dispatch and run before the LLM has any
 *     context to act on the result.
 *  3. LLM does runtime lookup — the block itself instructs the sub-agent
 *     to introspect `package.json#scripts.test` (or `peaks test --json`)
 *     at run time, so the LLM gets the resolved framework + argv with
 *     its full context. The dispatch CLI just primes the instruction.
 *
 * Why every sub-agent gets the block (Karpathy #2 Simplicity First):
 *  the rule is machine-injected, not a prompt ritual. The LLM cannot
 *  "remove the redundancy" of a test-tool-detection instruction because
 *  the dispatch CLI always prepends it. This is a guarantee, not a
 *  suggestion.
 *
 * 2026-09-10-dispatch-block-d (Option D): ONE block for EVERY role. The
 * runner-table EXAMPLES were dropped — they were never rules, and
 * `package.json#scripts.test` is the source of truth at run time — while
 * the one missing real rule is stated inline: PB-5, i.e. repo-defined
 * `test` / `test:*` scripts are the human/LLM direct path and are NOT
 * gated by the scope rule. The soft fallback ("only as a last resort, ask
 * the user before assuming a runner") and the Windows-aware note on
 * `peaks test <file>` are RETAINED — they are quality guidance, not
 * examples. No role split remains, so every role receives a byte-identical
 * block.
 */
export const TEST_TOOL_DETECTION_BLOCK = `## Test Tool Detection (mandatory)

Read \`package.json#scripts.test\` for the project's framework and use the project-local runner — do NOT invoke \`npx <runner>\`. If unsure, run \`peaks test --json\` first. Only as a last resort, ask the user before assuming a runner. \`peaks test <file>\` already resolves the local binary for you (Windows-aware).

## Test Scope (mandatory)

Any test command MUST be **scoped** to a single file or pattern; a bare \`./node_modules/.bin/vitest run\` is **refused** unless you prefix the explicit opt-in token \`PEAKS_FULL_TEST=1\` (CI / release verification only, never routine slice verification).

Repo-defined \`test\` / \`test:*\` scripts are the human/LLM direct path and are NOT gated by this scope rule (PB-5).`;

/**
 * Pure helper that returns the block. Exists as a function (not just an
 * exported constant) so future variants can take a runtime parameter
 * (e.g. projectRoot for context) without churning every call site.
 */
export function formatTestToolDetection(): string {
  return TEST_TOOL_DETECTION_BLOCK;
}

/**
 * Slice 2026-07-29-dispatch-stall-governance / S5 (AC-4.1 / AC-4.2) —
 * pure scope classifier. Returns a typed result so callers (the
 * dispatch prompt template, future test-runner bridges) can decide
 * whether the command is allowed, refused, or requires the explicit
 * opt-in.
 *
 *   - 'scoped'    — the command names a file/pattern after `run`
 *   - 'opt-in'    — the user/LLM set PEAKS_FULL_TEST=1 to override
 *   - 'refused'   — bare `vitest run` with no path and no opt-in
 *   - 'unsupported' — the command is not a vitest/jest/mocha run at
 *     all (the static block does not gate it; the caller decides)
 *
 * Pure: no I/O, no process spawn, no env reads. The dispatcher
 * passes `env` explicitly so the test seam can assert behavior
 * without mutating process.env.
 */
export type TestScopeClassification = 'scoped' | 'opt-in' | 'refused' | 'unsupported';

export interface TestScopeDecision {
  readonly classification: TestScopeClassification;
  readonly reason: string;
  readonly extractedPath: string | null;
}

export function classifyTestCommand(
  command: string,
  env: Readonly<Record<string, string | undefined>> = process.env
): TestScopeDecision {
  if (typeof command !== 'string') {
    return {
      classification: 'unsupported',
      reason: 'command is not a string',
      extractedPath: null
    };
  }
  const trimmed = command.trim();
  // Only vitest / jest / mocha runner invocations are in scope; other
  // commands (e.g. node, curl) are out of the scope-rule's reach
  // (PB-5: ordinary direct human project scripts are not gated).
  const lower = trimmed.toLowerCase();
  const isRunnerInvocation = /(?:\.\/node_modules\/\.bin\/|\b)(?:vitest|jest|mocha)\b/.test(lower);
  if (!isRunnerInvocation) {
    return {
      classification: 'unsupported',
      reason: 'command is not a vitest/jest/mocha runner invocation',
      extractedPath: null
    };
  }

  // Split into tokens. Quoted paths (e.g. "tests/unit/foo bar.test.ts")
  // are preserved as a single token by the simple `match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)`
  // approach; the static block does not need shell-level fidelity,
  // only the existence of at least one non-flag, non-runner path
  // token.
  const tokens = trimmed.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  // Find the runner token and look for arguments after it.
  const runnerIdx = tokens.findIndex((t) => /(^|\/)(vitest|jest|mocha)(\.cmd|\.exe)?$/.test(t.toLowerCase()));
  if (runnerIdx < 0) {
    return {
      classification: 'unsupported',
      reason: 'runner token not found in command',
      extractedPath: null
    };
  }
  const after = tokens.slice(runnerIdx + 1);
  // Strip flags (e.g. --config, --reporter, --coverage). A flag is
  // any token starting with `-`. The path we care about is the first
  // non-flag, non-runner, non-keyword token after the runner.
  const PATH_KEYWORDS = new Set(['run', 'watch', 'test', 'c', 'ci', 'r', 'reporter', 't', 'u', 'coverage']);
  const pathTokens: string[] = [];
  for (const tok of after) {
    if (tok.startsWith('-')) continue;
    if (PATH_KEYWORDS.has(tok.toLowerCase())) continue;
    pathTokens.push(tok);
  }
  if (pathTokens.length === 0) {
    // No path at all. The opt-in token flips this to 'opt-in'.
    if (env.PEAKS_FULL_TEST === '1' || env.PEAKS_FULL_TEST === 'true') {
      return {
        classification: 'opt-in',
        reason: 'bare run command with PEAKS_FULL_TEST=1 opt-in',
        extractedPath: null
      };
    }
    return {
      classification: 'refused',
      reason: 'bare runner invocation with no path filter and no PEAKS_FULL_TEST opt-in',
      extractedPath: null
    };
  }
  return {
    classification: 'scoped',
    reason: `runner invocation scoped to ${pathTokens.length} path token(s)`,
    extractedPath: pathTokens[0] ?? null
  };
}