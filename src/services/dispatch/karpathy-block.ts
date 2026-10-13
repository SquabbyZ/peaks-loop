/**
 * The Karpathy-guidelines context block, machine-injected into every sub-agent
 * prompt by the dispatch prompt composer
 * (`src/cli/commands/dispatch-prompt-composition.ts`), the same way the Test
 * Tool Detection block is injected by `./test-tool-detection.ts`.
 *
 * Why this module exists: the obligation to deliver this block lived only as
 * prose in `skills/bee/peaks-rd/references/rd-sub-agent-dispatch.md`, addressed
 * to the orchestrator. Measured 2026-10-12: four RD dispatch prompts in one
 * session carried zero occurrences of `Karpathy`, and the one block that WAS
 * appended had a word wrong — which the verbatim requirement makes a defect.
 * An obligation a busy caller can forget is not an executor; this is.
 *
 * SOURCE OF TRUTH: the fenced block in the reference file's
 * §"Karpathy-guidelines context" section is the canonical human-facing text;
 * `KARPATHY_GUIDELINES_BLOCK` below is its machine copy, and
 * `tests/unit/services/dispatch/karpathy-block.test.ts` asserts the two are
 * byte-equal, so the copy cannot drift silently. A second copy that CAN drift
 * is the same defect class as the dropped block; a pinned one is not.
 *
 * Why a static constant rather than a per-call read of the reference file
 * (same reasoning as `./test-tool-detection.ts`): dispatch is a hot path, and
 * the skill tree is not guaranteed to be present in an installed bundle.
 */

/**
 * The canonical block, verbatim. Byte-for-byte the fenced block under
 * §"Karpathy-guidelines context" in the RD dispatch reference, including its
 * trailing newline.
 */
export const KARPATHY_GUIDELINES_BLOCK = `Karpathy-guidelines context (REQUIRED — read before any code action)

The 4 Karpathy guidelines are mandatory for every planning, implementation, refactor, and review action you take. If 200 lines could be 50, rewrite. Touch only what the request requires. Surface assumptions, do not hide them. Define verifiable success criteria.

1. Think Before Coding

Don't assume. Don't hide confusion. Surface tradeoffs. Before implementing: state assumptions explicitly; if multiple interpretations exist, present them; if a simpler approach exists, say so; if unclear, stop and ask.

2. Simplicity First

Minimum code that solves the problem. Nothing speculative. No features beyond what was asked. No abstractions for single-use code. No "flexibility" or "configurability" that wasn't requested. No error handling for impossible scenarios. If you write 200 lines and it could be 50, rewrite it. Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

3. Surgical Changes

Touch only what you must. Clean up only your own mess. When editing existing code: don't "improve" adjacent code, comments, or formatting; don't refactor things that aren't broken; match existing style. When your changes create orphans: remove imports/variables/functions that YOUR changes made unused. The test: every changed line should trace directly to the user's request.

4. Goal-Driven Execution

Define success criteria. Loop until verified. "Add validation" → write tests for invalid inputs, then make them pass. "Fix the bug" → write a test that reproduces it, then make it pass. For multi-step tasks, state a brief plan with verify checkpoints. Strong success criteria let you loop independently. Weak criteria require constant clarification.
`;

/**
 * The block as the presence test compares it: line endings normalized to `\n`
 * and trailing whitespace trimmed.
 *
 * The trailing boundary is NOT part of the block's identity, and treating it as
 * part of it is a measured defect, not a hypothetical one. A caller that passes
 * its prompt through a shell round-trip (`--prompt "$(cat prompt.txt)"`) or
 * through any tool that trims the last newline hands the CLI the block MINUS
 * its final `\n`; a byte-exact `includes()` then read that as "no block" and
 * appended a second, identical copy — the double-append the contract forbids,
 * reproduced end to end on 2026-10-13. The same normalization answers a Windows
 * checkout, where the reference file the caller copies from may carry CRLF
 * while the constant does not.
 *
 * What is deliberately NOT normalized: the block's BODY. A copy with one word
 * wrong is still treated as absent and the canonical text is added, because the
 * requirement is verbatim delivery and the measured 2026-10-12 failure was
 * exactly a block appended with a word wrong. A header line alone is likewise
 * not evidence: matching the header would accept the wrong body.
 */
const KARPATHY_GUIDELINES_BLOCK_FOR_PRESENCE = KARPATHY_GUIDELINES_BLOCK.replace(
  /\r\n/g,
  '\n'
).trimEnd();

/** True when `text` already carries the canonical block (see the boundary note above). */
export function hasKarpathyBlock(text: string): boolean {
  return text.replace(/\r\n/g, '\n').includes(KARPATHY_GUIDELINES_BLOCK_FOR_PRESENCE);
}

/**
 * Ensure `text` carries the canonical block. Pure and idempotent.
 *
 * - `text` already carries the block (per {@link hasKarpathyBlock}) → returned
 *   unchanged, byte for byte. This is the compliant caller's guarantee: no
 *   double-append and no reflow of a prompt that already has the block.
 * - otherwise → `text` with the block appended, and `text` itself untouched.
 *
 * Near-miss policy, stated rather than left implicit: when the caller carries a
 * copy whose body differs, the canonical block is injected anyway and the
 * caller's copy is left in place. Deleting text a caller wrote is not this
 * function's job; delivering the canonical text is. The cost is two
 * "Karpathy-guidelines context" headings in that prompt — visible, and the one
 * the child must obey is the canonical one.
 *
 * The caller applies this to the assembled prompt, not to the caller's draft —
 * see `composeDispatchPrompt`, which runs it on `effectivePrompt` (the exact
 * string handed to the sub-agent as `toolCall.args.prompt` and recorded as the
 * dispatch record's `prompt`). The caller's draft is inside that string
 * verbatim, so a draft-side copy is matched too, and the check also catches a
 * block some other contributor put in the assembled text.
 */
export function ensureKarpathyBlock(text: string): string {
  if (hasKarpathyBlock(text)) return text;
  return `${text}\n\n${KARPATHY_GUIDELINES_BLOCK}`;
}
