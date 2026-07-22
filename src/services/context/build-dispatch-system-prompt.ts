/**
 * buildDispatchSystemPrompt — pure-function prompt composer for sub-agent dispatch.
 *
 * Slice 2026-07-22-orchestrator-memory-preflight (Task 5). The orchestrator
 * dispatch flow (`src/cli/commands/dispatch-commands.ts`) calls
 * `MemoryPreflightService.fetchBlock` and feeds the result into this builder
 * so the memory block, when available, is prepended BEFORE the task brief.
 *
 * Keeping the builder a pure function (no IO) makes the three acceptance
 * cases easy to test in isolation:
 *   1. returns the original prompt (sans memory block) when unavailable
 *   2. prepends the memory block when available
 *   3. never pushes the memory block below the task brief
 */
import type { MemoryPreflightResult } from './memory-preflight-service.js';

export interface DispatchPromptInput {
  taskTitle: string;
  taskBody: string;
  memoryBlock: MemoryPreflightResult;
}

/**
 * Compose the system-prompt body that the dispatch site prepends to
 * `formatTestToolDetection()\n\n`.
 *
 * Byte-identical degradation contract (slice 2026-07-22-orchestrator-memory-preflight
 * controller brief): when the memory block is unavailable, the caller does
 * `formatTestToolDetection()\n\n${taskBody}` — i.e. the final prompt is exactly
 * `${formatTestToolDetection()}\n\n${taskBody}`. Today's pre-change behavior
 * produced the same string from `src/cli/commands/dispatch-commands.ts:220`,
 * so the unavailable branch MUST return `taskBody` (NOT a `# title\n\n` wrap).
 *
 * Available branch prepends the memory block before the `## Task` heading so
 * `## Project memory …` always sits above the task brief (never pushed below
 * it).
 */
export function buildDispatchSystemPrompt(input: DispatchPromptInput): string {
  const { taskBody, memoryBlock } = input;
  if (memoryBlock.available === true && typeof memoryBlock.block === 'string') {
    return `${memoryBlock.block}\n## Task\n${taskBody}\n`;
  }
  return taskBody;
}
