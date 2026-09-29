/**
 * Slice `b1-filesplit-campaign` (wave 3) — verbatim extraction of the sub-agent
 * dispatch CONTRACT (the role namespace, the IDE-private tool-call descriptor,
 * the dispatch input, the per-IDE dispatcher interface and the two batch-await
 * shapes) from `./sub-agent-dispatcher.ts`, so that module clears the 300
 * raw-line cap. Every declaration is a type or interface: no runtime value
 * moved, no member, modifier or doc comment changed. `sub-agent-dispatcher.ts`
 * re-exports all six names from its own path, so no importer changed and the
 * envelope schema pinned by `tests/unit/services/dispatch/sub-agent-dispatchers.test.ts`
 * is the same schema.
 */

/**
 * Role string namespace. Soft whitelist — the CLI does NOT hard-validate
 * specific role names. Empirically observed (peaks-qa SKILL.md):3 top
 * roles +3 sub-roles + arbitrary business subdivisions:
 *
 * - top: rd | qa | ui | txt | general-purpose
 * - qa sub-roles: qa-business | qa-perf | qa-security
 * - business细分: qa-business-regression | qa-business-api
 * | qa-business-frontend | ...
 * - promotable: prd-business | prd-technical | prd-ux |
 * ui-visual | ui-flow | ui-component | ...
 *
 * Any non-empty string is a valid role. CLI emits a "soft whitelist"
 * hint in --help but does not reject unknown values.
 */
export type SubAgentRole = string;

/**
 * IDE-private tool-call descriptor. The LLM, upon receiving this in
 * the CLI's JSON envelope, must invoke the tool named `name` in its
 * own environment with the provided `args`.
 */
export interface SubAgentToolCall {
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
  /**
   * Slice 2026-06-23-audit-4th #C2: toolCall version. The IDE's
   * arg shape can change between versions (e.g. Claude Code's
   * `subagent_type: "general-purpose"` may become
   * `subagent_type: "claude-code-3.5"` in a future release). The
   * dispatcher stamps this on `buildToolCall`; the dispatch record
   * propagates it so a future reader can detect "this record is for
   * v2.0 Task, current IDE is v3.0" without inspecting args.
   * Pre-versioning records default to '2.0.0' on read.
   */
  readonly toolCallVersion?: string;
}

/**
 * Input to `buildToolCall`. The CLI assembles this from the user's
 * command-line args (role, prompt) + state-machine lookups
 * (requestId, sessionId).
 */
export interface SubAgentDispatchInput {
  readonly role: SubAgentRole;
  readonly prompt: string;
  readonly requestId: string;
  readonly sessionId: string;
}

/**
 * Per-IDE sub-agent dispatcher contract. Each IdeAdapter exposes
 * one of these; the CLI calls `buildToolCall` after validating
 * `supportsRole` (and `null-dispatcher` is the fallback when an
 * IDE cannot dispatch sub-agents at all).
 */
export interface SubAgentDispatcher {
  /**
   * Short label used in envelope `ide` field and CLI help text.
   * e.g. "claude-code" / "trae" / "null".
   */
  readonly label: string;

  /**
   * Whether this dispatcher supports dispatching a given role.
   * claude-code returns true for all non-empty strings; trae is
   * byte-identical (UNVERIFIED pending real Trae dogfood);
   * null-dispatcher always returns false.
   */
  supportsRole(role: SubAgentRole): boolean;

  /**
   * Build the IDE-specific tool call descriptor for a dispatch.
   * Must be pure: no I/O, no side effects. The CLI wraps the
   * returned descriptor in its JSON envelope.
   */
  buildToolCall(input: SubAgentDispatchInput): SubAgentToolCall;

  /**
   * 2.7.0 slice-dag-dispatcher MVP: join barrier for a batch of dispatched
   * sub-agents. Returns one BatchResult per dispatch in the batch.
   *
   * Default implementation in this MVP (1.2): claude-code holds an
   * in-process Promise queue (LRU-keyed by batchId); the four non-Claude
   * IDEs (trae / trae-cn / codex / cursor) return a
   * `awaitByLlm: true` marker so the calling LLM holds the await itself
   * — envelope shape is uniform. Real per-IDE implementations land in
   * 1.3.
   *
   * `nullSubAgentDispatcher` throws `SubAgentNotSupportedError` here.
   */
  awaitBatch?(input: SubAgentAwaitBatchInput): Promise<readonly SubAgentBatchResult[]>;
}

/**
 * 2.7.0 slice-dag-dispatcher MVP: input to the optional `awaitBatch` method.
 * MVP dispatch is one batch per top-level `peaks sub-agent dispatch --from-dag`
 * call; `batchId` is the same one returned in the dispatch envelope.
 */
export interface SubAgentAwaitBatchInput {
  readonly batchId: string;
  readonly dispatchCount: number;
  /** Per-dispatch record path; CLI already has this from the dispatch envelope. */
  readonly recordPaths: readonly string[];
  /** Optional cap on how long the join should wait. */
  readonly timeoutMs?: number;
}

/**
 * 2.7.0 slice-dag-dispatcher MVP: per-dispatch result of a join barrier.
 * The CLI returns one of these per dispatch in the batch.
 */
export interface SubAgentBatchResult {
  readonly dispatchIndex: number;
  readonly recordPath: string;
  readonly status: 'done' | 'failed' | 'cancelled' | 'timeout';
  readonly durationMs: number;
  readonly note: string | null;
}
