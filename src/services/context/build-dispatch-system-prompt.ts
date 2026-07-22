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

export function buildDispatchSystemPrompt(input: DispatchPromptInput): string {
  const { taskTitle, taskBody, memoryBlock } = input;
  const head = `# ${taskTitle}\n\n`;
  if (memoryBlock.available === true && typeof memoryBlock.block === 'string') {
    return `${head}${memoryBlock.block}\n## Task\n${taskBody}\n`;
  }
  return `${head}## Task\n${taskBody}\n`;
}
