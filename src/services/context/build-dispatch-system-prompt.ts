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
import { formatTestToolDetection } from '../dispatch/test-tool-detection.js';

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
  /**
   * Slice 2026-09-03-codegraph-preread (Option A): pre-composed
   * `## Codegraph structure` markdown block, read from the codegraph
   * index BEFORE the RD sub-agent's task body is composed so the RD
   * plans against real module/file topology, not LLM memory.
   *
   * - `undefined` → no codegraph block (legacy callers unchanged).
   * - `null` → codegraph was attempted but is unavailable; the composer
   *   renders a fixed "codegraph unavailable — proceeding on project-scan
   *   only" note (fail-soft; never hard-blocks a dispatch).
   * - `string` → the block, rendered verbatim between the context window
   *   and the memory/task content.
   */
  codegraphBlock?: string | null;
  /**
   * Slice 2026-09-06-ui-lib-dispatch-priority: pre-composed
   * `## Project stack` markdown block, rendered from the detected
   * project context (component library + CSS framework + build tool) by
   * the dispatch site BEFORE the sub-agent's task body is composed so
   * the RD/UI sub-agent sees the library-first directive in-context.
   *
   * - `undefined` → no project-stack block (legacy callers unchanged).
   * - `null` → the project has no detected component library; the
   *   composer renders nothing (byte-identical degradation).
   * - `string` → the block, rendered verbatim between the codegraph
   *   block and the memory/task content.
   */
  projectStackBlock?: string | null;
  /**
   * Slice 2026-09-07-search-first-preflight: the orchestrator-synthesized
   * `## Fresh context` block (≤5 binding directives from a Context7 →
   * WebSearch preflight), read from `.peaks/_runtime/<sessionId>/fresh-context.md`.
   *
   * - `undefined` → no fresh-context block (legacy callers unchanged).
   * - `null` → the block is unavailable (missing file / no `## Fresh context`
   *   heading); the composer renders nothing (byte-identical degradation).
   * - `string` → the block, rendered verbatim after the project-stack block
   *   and before the memory/task content.
   */
  freshContextBlock?: string | null;
  /**
   * Slice 2026-09-10-dispatch-token-and-swarm §4: session capsule
   * published by the orchestrator through `peaks sub-agent share`.
   *
   * - `undefined` / `null` → no capsule pointer, no precedence line
   *   (byte-identical legacy prompt).
   * - `{ batchId, key, bytes }` → a `shared-read` pointer plus the
   *   mandatory precedence line: the capsule is ADVISORY BACKGROUND only
   *   and the task spec wins on conflict. Nothing the sub-agent must act
   *   on may live only in the capsule.
   */
  capsule?: { readonly batchId: string; readonly key: string; readonly bytes: number } | null;
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

That chain ends with \`git worktree add\` (superpowers:using-git-worktrees SKILL.md line 96), which bypasses peaks-loop's L2 hook gate and L3 IDE \`permissions.deny\`. L3 denial is NOT sufficient — by then the chain has already taught raw \`git worktree add\`.

For worktree operations, use ONLY:

- \`peaks worktree spawn --rid <rid> --ttl <duration> --purpose <text>\` (after rid-L2-extended ships)
- until then: \`peaks worktree auth grant --rid <id> --reason <text> --ttl <5m>\`

Superpowers skills remain REFERENCE material for brainstorming / planning techniques, but MUST NOT be used as a workflow. peaks-rd's own PRD/RD artifacts (\`.peaks/_runtime/<sessionId>/rd/requests/<rid>.md\`) are authoritative.

If the upstream superpowers chain suggests raw \`git worktree add\`:

1. STOP
2. Re-author the plan as a peaks-rd artifact
3. Continue with \`peaks worktree spawn\` (or the auth-grant fallback)
`;

/**
 * Slice 2026-08-01-subagent-merge-and-e2e (Task 8): the dispatch
 * system prompt gains three lifecycle rules. The sub-agent must:
 *
 *   1. Register any long-lived local process it starts (vite dev,
 *      mock API, docker proxy, etc.) with
 *      `peaks sub-agent shutdown register --pid <pid> --name <label>`
 *      before it exits, so the parent session can best-effort-kill
 *      the process before merge-back (Task 3 + Task 6).
 *
 *   2. NOT run E2E. The parent session runs Playwright verification
 *      once after merge-back (Task 10). Sub-agent E2E runs are
 *      duplicates that the parent's single E2E pass will catch.
 *
 *   3. NOT call `git merge / pull / rebase` or
 *      `peaks worktree release`. The parent session owns the
 *      merge-back step (Task 9). Sub-agent merges double-write the
 *      index, race the worktree release, and can corrupt the
 *      caller's working branch.
 *
 * These rules are placed immediately after the L1 worktree governance
 * block so every stable boilerplate block is contiguous at the prompt
 * start, maximizing Anthropic prompt-cache prefix reuse (stable-first
 * ordering).
 */
export const LIFECYCLE_RULES = `## Sub-agent lifecycle rules (locked 2026-08-01)

- If you start a long-lived local service (vite dev, mock API, docker container, etc.), register it with \`peaks sub-agent shutdown register --pid <pid> --name <label>\` before you exit; the parent session best-effort-kills it before merge-back.
- Do NOT run E2E. The parent session runs Playwright verification once after merge-back (Task 10); your E2E work is duplicate effort.
- Do NOT call \`git merge\`, \`git pull\`, \`git rebase\`, or \`peaks worktree release\`. The parent session owns the merge-back step.
`;

/**
 * Slice 2026-09-10-context-audit-and-discipline (Slice C): cap the sub-agent's
 * FINAL report.
 *
 * Why (measured, session 2026-09-07-session-245530): 20 sub-agent final
 * reports cost ≈ 60 KB ≈ 15K tokens of the ORCHESTRATOR's window in one
 * session — the reports, not the dispatch boilerplate, were the second-largest
 * consumer. The sub-agent already writes a full artifact to disk; the report
 * only needs to be the index into it.
 *
 * QUALITY GUARD (binding): the cap removes no information. Everything the
 * parent needs to ACT on stays in the report; everything longer lives in the
 * artifact the parent can `Read`. The five mandatory fields below are exactly
 * the ones the orchestrator must have to decide the next gate.
 */
export const REPORT_CAP_BLOCK = `## Final report cap (mandatory)

Your FINAL report to the parent MUST be ≤ 40 lines and ≤ 2 KB. Write any longer detail into the artifact file you already own — the parent can \`Read\` that file for the full detail, so nothing is lost. The report itself MUST still carry: changed files (one line each), the exact commands you ran, pass/fail counts, tsc status, and any blocker. Do NOT paste file contents, full tool output, or logs into the report.
`;

/**
 * Slice 2026-09-10-fact-force-gate-adaptation: stand IN FRONT of an external
 * `PreToolUse` gate instead of explaining its denial after the fact.
 *
 * ECC (a third-party plugin under `~/.claude/plugins/`) registers
 * `gateguard-fact-force.js` on `Edit|Write|MultiEdit`. It denies the first
 * edit of a file whose facts the agent has not established, and its four-item
 * message never says two things the agent needs: that the file must be READ
 * first, and that the edit was NOT applied. Measured failure mode
 * (session 2026-09-10-session-528a63): the sub-agent reads the denial as
 * "the tool is broken" and abandons the edit.
 *
 * So the block below leads with the STANDING RULE (read before you edit) and
 * names the paths it covers, and mentions the denial only as the consequence
 * of skipping that rule. A sub-agent that has never seen the gate can read
 * this once and never trip it.
 *
 * The gate itself is untouched: peaks-loop adapts to it, and does NOT disable,
 * bypass, or re-implement it. Nor is `ECC_GATEGUARD=off` part of this.
 *
 * Always rendered — no opt-out flag and no role split. Every role edits files
 * outside `.peaks/**`, and only sub-agent #1 of a session sees a denial (the
 * gate fires once per file), so a role-scoped or opt-in block would leave the
 * rest of the fleet untold. It joins the stable boilerplate prefix: constant
 * bytes for every dispatch, prompt-cache friendly.
 *
 * The `.peaks/**` exemption is real and pre-dates this slice — peaks-loop
 * materialises `.claude/settings.local.json` so the gate skips `.peaks/**`
 * (slice 2.0.1-bug3-fact-forcing-bypass; see
 * `src/cli/commands/workspace/init-command.ts`).
 */
export const FACT_FORCE_GATE_BLOCK = `## Read before you edit (Fact-Forcing Gate)

Read a file BEFORE your first \`Edit\` / \`Write\` / \`MultiEdit\` on it — the normal way to work here, not an optional step. It applies to every path OUTSIDE \`.peaks/**\` (source, tests, docs, config); \`.peaks/**\` writes are exempt.

Skipping that read trips a \`PreToolUse\` plugin gate (ECC's "Fact-Forcing Gate"), which denies the edit. A denial is NOT a failure and the tool is NOT broken — your edit was NOT applied. Read the file, state the four facts the gate asks for (importers, affected API, data schemas if any, the user's verbatim instruction), then retry the same operation. Do not switch tools, do not give up, do not re-attempt blindly.
`;

/** Always-on renderer for {@link FACT_FORCE_GATE_BLOCK}. */
export function renderFactForceGateBlock(): string {
  return `${FACT_FORCE_GATE_BLOCK}\n`;
}

/**
 * Compose the system-prompt body for a sub-agent dispatch.
 *
 * 2026-09-10-dispatch-block-d (Option D): the composer owns the Test Tool
 * Detection injection — ONE unified block for every role, prepended first.
 * Callers MUST NOT prepend `formatTestToolDetection()` themselves or the
 * block is injected twice.
 *
 * Byte-identical degradation contract (slice 2026-07-22-orchestrator-memory-preflight
 * controller brief): when the memory block is unavailable, the composed body is
 * exactly `formatTestToolDetection() + "\n\n" + L1 + "\n" + LIFECYCLE +
 * "\n" + REPORT_CAP + "\n" + FACT_FORCE_GATE + "\n" + contextBlock + taskBody`, so the unavailable
 * branch MUST return `taskBody` unwrapped (NOT a `# title\n\n` wrap).
 * (REPORT_CAP joined the stable prefix in slice
 * 2026-09-10-context-audit-and-discipline, Slice C.)
 * The contract holds for callers that do not pass `codegraphBlock` (all
 * non-RD roles). Slice 2026-09-03-codegraph-preread deliberately inserts a
 * codegraph structure block (or its fail-soft unavailable note) for RD
 * dispatches between the context window and the memory/task content.
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
  const {
    taskBody,
    memoryBlock,
    contextProbe,
    codegraphBlock,
    projectStackBlock,
    freshContextBlock,
    capsule
  } = input;
  // 2026-09-10-dispatch-block-d (Option D): ONE Test Tool Detection block
  // for every role — the composer owns the injection so callers MUST NOT
  // prepend `formatTestToolDetection()` themselves (double injection).
  const testToolText = `${formatTestToolDetection()}\n\n`;
  // 2026-09-10-fact-force-gate-adaptation: always-on, both branches.
  const factForceGateText = renderFactForceGateBlock();
  const contextBlock = renderContextBlock(contextProbe ?? null);
  const codegraphText = renderCodegraphBlock(codegraphBlock);
  const projectStackText = renderProjectStackBlock(projectStackBlock);
  const freshContextText = renderFreshContextBlock(freshContextBlock);
  const capsuleText = renderCapsulePointer(capsule);
  if (memoryBlock.available === true && typeof memoryBlock.block === 'string') {
    return `${testToolText}${L1_WORKTREE_GOVERNANCE_BLOCK}\n${LIFECYCLE_RULES}\n${REPORT_CAP_BLOCK}\n${factForceGateText}${contextBlock}${codegraphText}${projectStackText}${freshContextText}${capsuleText}${memoryBlock.block}\n## Task\n${taskBody}`;
  }
  return `${testToolText}${L1_WORKTREE_GOVERNANCE_BLOCK}\n${LIFECYCLE_RULES}\n${REPORT_CAP_BLOCK}\n${factForceGateText}${contextBlock}${codegraphText}${projectStackText}${freshContextText}${capsuleText}${taskBody}`;
}

/**
 * Slice 2026-09-10-dispatch-token-and-swarm §4 — session capsule pointer.
 *
 * QUALITY GUARD: the capsule is BACKGROUND only. The precedence line below
 * is part of the contract, not decoration — anything the sub-agent must
 * ACT on stays inline in the task spec. The renderer therefore always
 * emits the precedence sentence whenever it emits the pointer.
 */
function renderCapsulePointer(
  capsule: { readonly batchId: string; readonly key: string; readonly bytes: number } | null | undefined
): string {
  if (capsule === null || capsule === undefined) return '';
  return `## Shared session capsule (advisory background)\nBackground facts already established by the orchestrator (${capsule.bytes} bytes): read them with \`peaks sub-agent shared-read --batch ${capsule.batchId} --key ${capsule.key}\`. This capsule is ADVISORY BACKGROUND ONLY — it is not a task. Your task spec below is authoritative and wins on any conflict; anything you must act on is stated inline there.\n\n`;
}

/**
 * Slice 2026-09-03-codegraph-preread: fixed degradation string emitted
 * when the RD dispatch preflight requested a codegraph structure read but
 * the index could not be resolved (absent + init failure, foreign schema,
 * unparseable output). Kept as a constant so the unavailable branch is
 * byte-stable and trivially testable.
 */
export const CODEGRAPH_UNAVAILABLE_BLOCK =
  '## Codegraph structure\n\ncodegraph unavailable — proceeding on project-scan only.\n';

/**
 * Render the codegraph insertion for a dispatch prompt.
 *
 * - `undefined` → empty (the composer is byte-identical to the legacy
 *   shape for callers that did not opt into a codegraph pre-read).
 * - `null` → the fixed CODEGRAPH_UNAVAILABLE_BLOCK note.
 * - `string` → the pre-composed block from the codegraph preflight
 *   service, verbatim.
 *
 * Every non-empty variant is normalized to end on its own paragraph
 * (`\n\n`) so the following block (project memory or task body) starts
 * cleanly regardless of the caller's trailing newline habits.
 */
function renderCodegraphBlock(codegraphBlock: string | null | undefined): string {
  if (codegraphBlock === undefined) return '';
  const text = codegraphBlock === null ? CODEGRAPH_UNAVAILABLE_BLOCK : codegraphBlock;
  return `${text.replace(/\s+$/, '')}\n\n`;
}

/**
 * Render the project-stack insertion for a dispatch prompt.
 *
 * - `undefined` / `null` → empty (the composer is byte-identical to the
 *   legacy shape — no dangling "Project stack" heading).
 * - `string` → the pre-composed block from the dispatch site, verbatim.
 *
 * Mirrors `renderCodegraphBlock`: every non-empty variant is normalized
 * to end on its own paragraph (`\n\n`) so the following block (project
 * memory or task body) starts cleanly.
 */
function renderProjectStackBlock(projectStackBlock: string | null | undefined): string {
  if (projectStackBlock === undefined || projectStackBlock === null) return '';
  return `${projectStackBlock.replace(/\s+$/, '')}\n\n`;
}

/**
 * Render the fresh-context insertion for a dispatch prompt.
 *
 * - `undefined` / `null` → empty (the composer is byte-identical to the
 *   legacy shape — no dangling "Fresh context" heading).
 * - `string` → the pre-composed block from the fresh-context preflight
 *   synthesis, verbatim.
 *
 * Mirrors `renderProjectStackBlock`: every non-empty variant is normalized
 * to end on its own paragraph (`\n\n`) so the following block (project
 * memory or task body) starts cleanly.
 */
function renderFreshContextBlock(freshContextBlock: string | null | undefined): string {
  if (freshContextBlock === undefined || freshContextBlock === null) return '';
  return `${freshContextBlock.replace(/\s+$/, '')}\n\n`;
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
      ? 'RED-LINE — call `peaks code auto-compact` immediately.'
      : probe.ratio >= 0.85
        ? 'pre-compact zone — consider running `peaks code auto-compact` proactively.'
        : probe.ratio >= 0.5
          ? 'soft-warn zone — continue working; the next dispatch will re-check.'
          : 'plenty of room — continue without compacting.';
    return `## Context window (authoritative — do NOT estimate yourself)

Context **${usedPct}% used** (${freePct}% free), token-counted by the IDE adapter's statusline (source: \`${probe.source}\`, IDE: \`${probe.ide}\`). This is the SAME value \`peaks code context-now\` returns — trust it; never derive a percentage from message length (char/4 diverges 2-4x and has caused false "context too low" reports at ${freePct}%+ free).

**Action:** ${action}

Before telling the parent "context pressure" or "context too low", re-run \`peaks code context-now\` and compare its \`ratio\` to the number above. Report pressure ONLY if it returns \`verdict: red-line\` or \`action: auto-compact-now\`.

`;
  }
  return `## Context window (no probe available)

No context-fill probe was captured before this dispatch. To evaluate context pressure, run \`peaks code context-now --project <root>\` and trust its \`ratio\` field. Do not estimate from message length.

`;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Slice 2026-09-10-dispatch-token-and-swarm §1 — rule-presence guard.
 *
 * The compression + role-scoping in this file is allowed to shorten prose.
 * It is NOT allowed to drop a binding rule. These token sets are the
 * machine-checkable definition of "binding rule": each entry is a phrase
 * that carries an obligation (MUST / MUST NOT / refused / a command the
 * sub-agent is told to use or avoid). The guard test asserts that EVERY
 * role's composed prompt contains EVERY token — so a future compression
 * that deletes a rule fails CI instead of silently weakening the contract.
 * ────────────────────────────────────────────────────────────────────────── */

/** Binding phrases every dispatch prompt must contain, for every role. */
export const BINDING_RULE_TOKENS: readonly string[] = [
  // L1 worktree governance
  'MUST NOT follow the superpowers chain',
  'superpowers:using-git-worktrees',
  '`git worktree add`',
  '`peaks worktree spawn --rid <rid> --ttl <duration> --purpose <text>`',
  '`peaks worktree auth grant --rid <id> --reason <text> --ttl <5m>`',
  'MUST NOT be used as a workflow',
  'STOP',
  'Re-author the plan as a peaks-rd artifact',
  // lifecycle rules
  '`peaks sub-agent shutdown register --pid <pid> --name <label>`',
  'Do NOT run E2E',
  'Do NOT call `git merge`, `git pull`, `git rebase`',
  '`peaks worktree release`',
  // context window
  'do NOT estimate yourself',
  '`peaks code context-now`',
  '`verdict: red-line`',
  // final report cap (Slice 2026-09-10-context-audit-and-discipline, Slice C)
  '## Final report cap (mandatory)',
  '≤ 40 lines and ≤ 2 KB',
  'the parent can `Read` that file for the full detail',
  'changed files (one line each)',
  'pass/fail counts',
  'tsc status',
  // fact-forcing gate (slice 2026-09-10-fact-force-gate-adaptation)
  '## Read before you edit (Fact-Forcing Gate)',
  'Read a file BEFORE your first `Edit` / `Write` / `MultiEdit` on it',
  'every path OUTSIDE `.peaks/**`',
  '`PreToolUse` plugin gate',
  'A denial is NOT a failure and the tool is NOT broken',
  'your edit was NOT applied',
  'retry the same operation',
  'do not re-attempt blindly',
  // test scope — ONE unified block, byte-identical for EVERY role
  '## Test Tool Detection (mandatory)',
  '`package.json#scripts.test`',
  'do NOT invoke `npx <runner>`',
  '## Test Scope (mandatory)',
  'PEAKS_FULL_TEST=1',
  'refused',
] as const;

/**
 * The runner-direct-path tokens: the refusal example, the two direct paths
 * the block names (`peaks test --json` to introspect; PB-5, the repo-defined
 * `test` / `test:*` scripts that are NOT gated), and the two pieces of
 * quality guidance that must survive any compression — never assume a
 * runner without asking the user as a last resort, and prefer
 * `peaks test <file>` because it resolves the local binary Windows-aware.
 *
 * 2026-09-10-dispatch-block-d (Option D): there is no role split any more,
 * so this set is asserted IDENTICALLY for every role. The runner EXAMPLES
 * were removed as part of the unification — they were never rules.
 */
export const TEST_RUNNER_RULE_TOKENS: readonly string[] = [
  '`./node_modules/.bin/vitest run`',
  'PB-5',
  '`peaks test --json`',
  'ask the user before assuming a runner',
  '(Windows-aware)',
] as const;

/**
 * Return the subset of `tokens` that `text` does NOT contain. Pure; used by
 * the rule-presence guard and usable by any future prompt self-check.
 */
export function missingRuleTokens(text: string, tokens: readonly string[]): readonly string[] {
  return tokens.filter((t) => !text.includes(t));
}
