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
import type { ContextPercentProbe } from './auto-compact-types.js';

export interface DispatchPromptInput {
  taskTitle: string;
  taskBody: string;
  memoryBlock: MemoryPreflightResult;
  /**
   * Slice 2026-07-29-context-evaluation-accuracy: the live
   * context-fill probe. When provided, the composer prepends
   * a `## Context window` block with the authoritative ratio so
   * the dispatched sub-agent does NOT estimate context from
   * message length. The ratio comes from the IDE adapter's
   * `compact` env-var / statusline (token-counted), NOT from
   * a byte-counted estimate.
   */
  contextProbe?: ContextPercentProbe | null;
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
  const { taskBody, memoryBlock, contextProbe } = input;
  const contextBlock = renderContextBlock(contextProbe ?? null);
  if (memoryBlock.available === true && typeof memoryBlock.block === 'string') {
    return `${L1_WORKTREE_GOVERNANCE_BLOCK}\n${contextBlock}${memoryBlock.block}\n## Task\n${taskBody}\n`;
  }
  return `${L1_WORKTREE_GOVERNANCE_BLOCK}\n${contextBlock}${taskBody}`;
}

/**
 * Slice 2026-07-29-context-evaluation-accuracy: emit a
 * `## Context window` block with the authoritative ratio so the
 * dispatched sub-agent does not estimate from message length.
 *
 * The probe is a token-counted value (from the IDE adapter's
 * `compact` env-var or statusline). The block also includes a
 * hard rule: "do not estimate context yourself; trust this
 * number" — the LLM's char/4 estimate diverges from peaks'
 * token-counted value by 2-4x, and trusting the LLM's
 * self-estimate causes false-positive "context too low" reports
 * at 60%+ free.
 *
 * When the probe is null (e.g. the orchestrator did not run
 * the context probe before dispatch), the block instructs
 * the sub-agent to call `peaks code context-now` itself
 * before declaring context pressure.
 */
function renderContextBlock(probe: ContextPercentProbe | null): string {
  if (probe !== null && probe !== undefined) {
    const usedPct = (probe.ratio * 100).toFixed(1);
    const freePct = ((1 - probe.ratio) * 100).toFixed(1);
    const action = probe.ratio >= 0.95
      ? 'RED-LINE — call `peaks compact auto --execute` immediately.'
      : probe.ratio >= 0.85
        ? 'pre-compact zone — consider running `peaks compact auto --execute` proactively.'
        : probe.ratio >= 0.5
          ? 'soft-warn zone — continue working; the next dispatch will re-check.'
          : 'plenty of room — continue without compacting.';
    return `## Context window (authoritative — do NOT estimate yourself)

Your context is **${usedPct}% used** (${freePct}% free) as measured by the IDE adapter's token-counted statusline (source: \`${probe.source}\`, IDE: \`${probe.ide}\`). This number is the SAME value \`peaks code context-now\` returns — trust it; do not derive a percentage from your message length or any other heuristic (char/4 estimates diverge from token counts by 2-4x and have caused false "context too low" reports at ${freePct}%+ free).

**Action:** ${action}

If you are tempted to declare "context pressure" or "context too low" to the parent, FIRST re-run \`peaks code context-now\` and compare its \`ratio\` field to the number above. Only report context pressure if \`peaks code context-now\` returns \`verdict: red-line\` or \`action: auto-compact-now\`.

`;
  }
  return `## Context window (no probe available)

The orchestrator did not capture a context-fill probe before this dispatch. If you need to evaluate context pressure, run \`peaks code context-now --project <root>\` and trust its \`ratio\` field. Do not estimate from message length.

`;
}
