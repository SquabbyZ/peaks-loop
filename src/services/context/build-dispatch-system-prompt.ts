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
 * Slice 2026-07-29-worktree-l1: Layer 1 of the 3-layer worktree governance
 * defence. The block below is prepended to every sub-agent dispatch system
 * prompt so the LLM sees the superpowers-chain refusal BEFORE any task
 * content. The block mirrors the prose in
 * `skills/bee/peaks-rd/references/rd-sub-agent-dispatch.md` (and the
 * corresponding peaks-qa / peaks-ui templates); all 4 surfaces MUST stay
 * in lockstep — drift between them is the failure mode this slice closes.
 *
 * Why this lives here (and not just in markdown):
 * - The dispatch composer is the ONE place every dispatch prompt passes
 *   through. Adding the block here guarantees coverage even when the
 *   orchestrator synthesizes a prompt without reading the per-role
 *   template (the orchestrator may run peaks-rd on a different rid and
 *   reuse the task body verbatim).
 * - Pure-function design (slice 2026-07-22) makes the appended block
 *   trivially testable.
 *
 * Fallback note: until rid-L2-extended ships `peaks worktree spawn`, the
 * fallback path is `peaks worktree auth grant --rid <id> --reason <text>
 * --ttl <5m>` (already shipped). Update the prose once `spawn` lands.
 */
export const L1_WORKTREE_GOVERNANCE_BLOCK = `## Superpowers chain refusal (L1 worktree governance — locked 2026-07-29)

You MUST NOT follow the superpowers chain for worktree decisions:

- superpowers:brainstorming → superpowers:writing-plans →
  superpowers:subagent-driven-development → superpowers:using-git-worktrees

This chain ends with \`git worktree add\` (superpowers:using-git-worktrees SKILL.md line 96). It bypasses peaks-loop's L2 hook gate and L3 IDE \`permissions.deny\`. Even when L3 denies the terminal Skill, the chain has already taught you to use raw \`git worktree add\`, so L3 is not sufficient.

For worktree operations, use ONLY:

- \`peaks worktree spawn --rid <rid> --ttl <duration> --purpose <text>\` (after rid-L2-extended ships)
- until then: \`peaks worktree auth grant --rid <id> --reason <text> --ttl <5m>\`

The superpowers skills remain available as REFERENCE material for brainstorming / planning techniques, but MUST NOT be used as a workflow. peaks-rd's own PRD/RD artifacts (\`.peaks/_runtime/<sessionId>/rd/requests/<rid>.md\`) are authoritative.

If the upstream superpowers chain suggests raw \`git worktree add\`:

1. STOP
2. Re-author the plan as a peaks-rd artifact
3. Continue with \`peaks worktree spawn\` (or the auth-grant fallback)
`;

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
 *
 * Slice 2026-07-29-worktree-l1: every branch prepends the L1 worktree
 * governance block BEFORE the memory block / task body. The block is the
 * first thing the dispatched sub-agent sees, so the superpowers-chain
 * refusal is in scope before any task-specific prose arrives.
 */
export function buildDispatchSystemPrompt(input: DispatchPromptInput): string {
  const { taskBody, memoryBlock } = input;
  if (memoryBlock.available === true && typeof memoryBlock.block === 'string') {
    return `${L1_WORKTREE_GOVERNANCE_BLOCK}\n${memoryBlock.block}\n## Task\n${taskBody}\n`;
  }
  return `${L1_WORKTREE_GOVERNANCE_BLOCK}\n${taskBody}`;
}
