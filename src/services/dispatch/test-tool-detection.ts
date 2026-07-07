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
 */
export const TEST_TOOL_DETECTION_BLOCK = `## Test Tool Detection (mandatory)

Before running any test, read \`package.json#scripts.test\` to identify the project's test framework. Use the project-local runner — do NOT invoke \`npx <runner>\`:

- **vitest** → \`./node_modules/.bin/vitest run <file>\` (or \`pnpm test -- <file>\`)
- **jest**   → \`./node_modules/.bin/jest <file>\`   (or \`pnpm test -- <file>\`)
- **mocha**  → \`./node_modules/.bin/mocha <file>\`  (or \`pnpm test -- <file>\`)

If unsure which framework the consumer project uses, run \`peaks test --json\` first to introspect the resolved framework + argv. Only as a last resort, ask the user before assuming a runner. The CLI command \`peaks test <file>\` already resolves the local binary for you (Windows-aware).`;

/**
 * Pure helper that returns the block. Exists as a function (not just an
 * exported constant) so future variants can take a runtime parameter
 * (e.g. projectRoot for context) without churning every call site.
 */
export function formatTestToolDetection(): string {
  return TEST_TOOL_DETECTION_BLOCK;
}
