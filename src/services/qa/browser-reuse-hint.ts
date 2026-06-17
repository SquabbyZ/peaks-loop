/**
 * Slice 2026-06-16-playwright-restart-loop — G2.
 *
 * The browser-context reuse hint is appended to the sub-agent prompt
 * whenever a peaks-qa-dispatched sub-agent (peaks-ui or general-purpose
 * with a browser-E2E role) is invoked. The hint tells the model to
 * keep one browser tab alive across the QA slice and to NOT call
 * `browser_close` between steps.
 *
 * The constant lives here so both the dispatch CLI
 * (`src/cli/commands/sub-agent-commands.ts`) and any future
 * SKILL.md / dispatch table can reference the SAME string. Drift
 * between "the detector knows X" and "the dispatch prompt says X"
 * is the most common bug in this slice, so a single source of
 * truth is non-negotiable.
 */
export const BROWSER_REUSE_HINT =
  'reuse existing browser tab; do NOT call mcp__playwright__browser_close between steps within this slice — closing and re-opening the tab repeatedly is a restart loop and will be halted by the slice guard';

export const BROWSER_RESTART_LOOP_MEMORY_PATH =
  '.peaks/memory/playwright-restart-loop-2026-06-16.md';
