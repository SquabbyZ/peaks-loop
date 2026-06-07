/**
 * Slice #009 — SubAgentDispatcher abstraction.
 *
 * Per-IDE contract: given a sub-agent role + prompt + request/session ids,
 * return a tool-call descriptor that the calling LLM should execute in
 * its native environment. The CLI is IDE-agnostic; per-IDE tool names
 * (Claude Code's `Task`, Trae's UNVERIFIED placeholder) are encapsulated
 * here, never leaked to SKILL.md.
 *
 * Why this exists:
 * - Prior SKILL.md hardcoded `Task(subagent_type="general-purpose", ...)`
 * which made peaks-cli depend on Claude Code's specific sub-agent
 * tool name. Adding a new IDE (Trae, future Cursor, etc.) required
 * editing every SKILL.md that mentioned sub-agent dispatch.
 * - This file (plus the per-IDE adapter wiring) collapses all
 * per-IDE sub-agent specifics to a single `SubAgentDispatcher`
 * instance per adapter. SKILL.md now only references
 * `peaks sub-agent dispatch <role>`, and the IDE-private tool
 * name flows through the returned `data.toolCall` at runtime.
 *
 * Cross-reference: PRD #002 G1 (AC-1..AC-5); RD tech-doc-002 §2.
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
}

/**
 * Claude Code dispatcher. Real, byte-level implementation.
 *
 * - `supportsRole`: any non-empty string (Claude Code's
 * `general-purpose` sub-agent accepts any prompt).
 * - `buildToolCall`: returns `{name: 'Task', args: {subagent_type,
 * description, prompt}}` — the exact shape the `Task` tool
 * in Claude Code expects.
 */
export const claudeCodeSubAgentDispatcher: SubAgentDispatcher = {
 label: 'claude-code',
 supportsRole: (role) => role.length >0,
 buildToolCall: ({ role, prompt, requestId }) => ({
 name: 'Task',
 args: {
 subagent_type: 'general-purpose',
 description: `${role} for rid=${requestId}`,
 prompt,
 },
 }),
};

/**
 * Trae dispatcher. UNVERIFIED — Trae sub-agent tool name TBD on real
 * dogfood. Byte-level identical to claude-code by design so:
 * - The dispatcher's return shape is uniform across both adapters
 * — a single byte-equality test can verify the placeholder
 * contract.
 * - Future real Trae dogfood can replace the body of
 * `buildToolCall` without breaking the adapter contract.
 *
 * Slice #014: the legacy `subAgentToolMatcher: 'Task'` install entry
 * is gone — the field is removed from `IdeAdapter`. Slice #009+
 * dispatched sub-agents directly, not via a PreToolUse hook. The Trae
 * dispatcher remains a placeholder so the dispatch surface is uniform
 * across adapters.
 *
 * When real Trae dogfood lands, replace the body of `buildToolCall`
 * with Trae's actual sub-agent tool name + args shape. The interface
 * stays the same; only the per-IDE wiring breaks (intentionally).
 */
export const traeSubAgentDispatcher: SubAgentDispatcher = {
 // UNVERIFIED — see file header
 label: 'trae',
 supportsRole: (role) => role.length >0,
 buildToolCall: ({ role, prompt, requestId }) => ({
 name: 'Task',
 args: {
 subagent_type: 'general-purpose',
 description: `${role} for rid=${requestId}`,
 prompt,
 },
 }),
};

/**
 * Null dispatcher for IDEs that cannot dispatch sub-agents at all
 * (e.g. a CLI-only IDE that has no LLM tool surface). Used as the
 * fallback by future unsupported-IDE adapters. The CLI returns
 * `{ok: false, code: "IDE_NOT_SUPPORTED"}` when the dispatcher's
 * `supportsRole` returns false.
 */
export const nullSubAgentDispatcher: SubAgentDispatcher = {
 label: 'null',
 supportsRole: () => false,
 buildToolCall: ({ role }) => {
 throw new SubAgentNotSupportedError(role);
 },
};

/**
 * Thrown by `nullSubAgentDispatcher.buildToolCall` and any future
 * dispatcher that does not support a given role. The CLI catches
 * this and returns the IDE_NOT_SUPPORTED error envelope.
 */
export class SubAgentNotSupportedError extends Error {
 readonly code = 'IDE_NOT_SUPPORTED' as const;
 constructor(public readonly role: SubAgentRole) {
 super(`Sub-agent dispatch is not supported for role: ${role}`);
 this.name = 'SubAgentNotSupportedError';
 }
}
