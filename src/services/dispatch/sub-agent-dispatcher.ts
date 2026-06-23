/**
 * Slice #009 — SubAgentDispatcher abstraction.
 *
 * 2.7.0 slice-dag-dispatcher MVP (slice 1.2.a) added `awaitBatch` per
 * dispatcher: claude-code holds an in-process promise queue; trae / trae-cn
 * / codex / cursor return an `awaitByLlm: true` marker for the calling
 * LLM to hold the await itself (real per-IDE implementations land in
 * slice 1.3). The `nullSubAgentDispatcher` throws.
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
import { existsSync, readFileSync } from 'node:fs';

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
 // Slice 2026-06-23-audit-4th #C2: stamp the IDE-arg shape
 // version. When Claude Code changes the Task args shape (e.g.
 // a new subagent_type value), bump this and the dispatch record
 // propagates it so a future reader can detect a stale record.
 toolCallVersion: '2.0.0',
 }),
 // 2.7.0 slice-dag-dispatcher MVP: real join barrier for claude-code.
 // The MVP harness uses an in-process promise queue keyed by batchId.
 // (1.2 阶段进程内 hold 即可;1.3 / 1.4 阶段若多进程 sub-agent 走共享文件 / heartbeat 轮询。)
 awaitBatch: async (input) => awaitClaudeCodeBatch(input),
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
 toolCallVersion: '2.0.0',
 }),
 // 2.7.0 slice-dag-dispatcher (slice 1.3): real file-polling awaitBatch
 // for Trae. Per-IDE wrapper around `pollDispatchRecords` with the
 // Trae-default heartbeat (30s). The fallback `awaitByLlm` marker is
 // gone — Trae now joins like claude-code.
 awaitBatch: async (input) =>
 pollDispatchRecords(input, {
 ide: 'trae',
 defaultTimeoutMs: 30_000,
 notePrefix: 'trae 1.3 real awaitBatch'
 })
};

/**
 * Trae-CN dispatcher. Mirrors Trae's shape with a separate label so
 * the CLI's IDE detection can distinguish a Trae install region
 * (Trae-CN differs in skill install path / log location only;
 * dispatch surface is identical per slice #011 framework rule).
 *
 * Slice 1.3: real `awaitBatch` — same polling core as Trae.
 */
export const traeCnSubAgentDispatcher: SubAgentDispatcher = {
 label: 'trae-cn',
 supportsRole: (role) => role.length >0,
 buildToolCall: ({ role, prompt, requestId }) => ({
 name: 'Task',
 args: {
 subagent_type: 'general-purpose',
 description: `${role} for rid=${requestId}`,
 prompt,
 },
 }),
 awaitBatch: async (input) =>
 pollDispatchRecords(input, {
 ide: 'trae-cn',
 defaultTimeoutMs: 30_000,
 notePrefix: 'trae-cn 1.3 real awaitBatch'
 })
};

/**
 * Codex (OpenAI CLI IDE) dispatcher.
 *
 * Slice #13 noted Codex's sub-agent tool name is TBD; per slice #009
 * rationale, the dispatcher mirrors Claude Code's shape so the
 * adapter contract stays uniform. Slice 1.3 promotes Codex from
 * `awaitByLlmFallback` to a real `awaitBatch` (file-based polling,
 * Codex default 45s — Codex's documented heartbeat is slightly
 * slower per slice #13 R-3).
 */
export const codexSubAgentDispatcher: SubAgentDispatcher = {
 label: 'codex',
 supportsRole: (role) => role.length >0,
 buildToolCall: ({ role, prompt, requestId }) => ({
 name: 'Task',
 args: {
 subagent_type: 'general-purpose',
 description: `${role} for rid=${requestId}`,
 prompt,
 },
 toolCallVersion: '2.0.0',
 }),
 awaitBatch: async (input) =>
 pollDispatchRecords(input, {
 ide: 'codex',
 defaultTimeoutMs: 45_000,
 notePrefix: 'codex 1.3 real awaitBatch'
 })
};

/**
 * Cursor dispatcher. UNVERIFIED — Cursor sub-agent tool name TBD on
 * real dogfood. Byte-level identical to claude-code by design (slice
 * #012 framing).
 *
 * Slice 1.3: real `awaitBatch` — file-based polling, Cursor default
 * 30s.
 */
export const cursorSubAgentDispatcher: SubAgentDispatcher = {
 label: 'cursor',
 supportsRole: (role) => role.length >0,
 buildToolCall: ({ role, prompt, requestId }) => ({
 name: 'Task',
 args: {
 subagent_type: 'general-purpose',
 description: `${role} for rid=${requestId}`,
 prompt,
 },
 toolCallVersion: '2.0.0',
 }),
 awaitBatch: async (input) =>
 pollDispatchRecords(input, {
 ide: 'cursor',
 defaultTimeoutMs: 30_000,
 notePrefix: 'cursor 1.3 real awaitBatch'
 })
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
 // 2.7.0 slice-dag-dispatcher MVP: null dispatcher never supports await either.
 awaitBatch: async ({ batchId }) => {
 throw new SubAgentNotSupportedError(`awaitBatch on batch ${batchId}`);
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

/* ──────────────────────────────────────────────────────────────────────────
 * 2.7.0 slice-dag-dispatcher MVP (slice 1.2.a) — awaitBatch implementation
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * In-process LRU promise queue for claude-code. Keyed by batchId.
 * Populated by `awaitClaudeCodeBatch` callers; consumed by the same.
 * MVP-scope only: 1.3 / 1.4 may replace with cross-process heartbeat polling.
 */
const claudeCodeBatchAwaiters = new Map<string, Promise<readonly SubAgentBatchResult[]>>();

/**
 * Real awaitBatch for claude-code (MVP). In 1.2, dispatch + await are
 * both in the same process; we record the batch size and resolve after
 * `dispatchCount` heartbeats land for the given `recordPaths`, or after
 * `timeoutMs` elapses (per-dispatch `timeout` status).
 *
 * Implementation contract (MVP):
 *  - We poll each `recordPaths[i]` for an `outcome: success | failed` or
 *    `status: done | failed` field; if absent after `timeoutMs`, that
 *    dispatch is reported as `timeout`.
 *  - The poll interval is 50ms (fast enough for unit tests, cheap enough
 *    for the MVP; the real cross-process version uses heartbeat polling).
 */
export async function awaitClaudeCodeBatch(
 input: SubAgentAwaitBatchInput
): Promise<readonly SubAgentBatchResult[]> {
 const { batchId, dispatchCount, recordPaths, timeoutMs } = input;
 if (dispatchCount <= 0 || recordPaths.length === 0) {
 return [];
 }
 const startedAt = Date.now();
 const pollIntervalMs = 50;
 const deadline = timeoutMs ?? 60_000;
 const capped = Math.min(deadline, 120_000);

 // MVP: race the deadline against a simple polling loop. Real per-IDE
 // implementations land in slice 1.3.
 const results: SubAgentBatchResult[] = [];
 const remaining = new Map<number, { recordPath: string; status: SubAgentBatchResult['status']; note: string | null; finishedAt: number | null }>();
 for (let i = 0; i < recordPaths.length; i += 1) {
 const recordPath = recordPaths[i] ?? '';
 remaining.set(i, { recordPath, status: 'timeout', note: null, finishedAt: null });
 }

 while (remaining.size > 0 && Date.now() - startedAt < capped) {
 for (const [idx, slot] of remaining) {
 if (slot.finishedAt !== null) continue;
 const outcome = readDispatchOutcome(slot.recordPath);
 if (outcome === null) continue;
 slot.status = outcome.status;
 slot.note = outcome.note;
 slot.finishedAt = Date.now();
 }
 if (Array.from(remaining.values()).every((s) => s.finishedAt !== null)) break;
 await new Promise((r) => setTimeout(r, pollIntervalMs));
 }

 for (const [idx, slot] of remaining) {
 const finishedAt = slot.finishedAt ?? startedAt + capped;
 results.push({
 dispatchIndex: idx,
 recordPath: slot.recordPath,
 status: slot.status,
 durationMs: finishedAt - startedAt,
 note: slot.note
 });
 }
 results.sort((a, b) => a.dispatchIndex - b.dispatchIndex);
 // Touch batchId so the parameter is "used" — keeps the linter happy when
 // the in-process queue (claudeCodeBatchAwaiters) is later wired up.
 void batchId;
 return results;
}

/** Best-effort outcome read for a dispatch record. Returns null if pending. */
function readDispatchOutcome(recordPath: string): { status: SubAgentBatchResult['status']; note: string | null } | null {
 if (!recordPath) return null;
 try {
 if (!existsSync(recordPath)) return null;
 const raw = readFileSync(recordPath, 'utf8');
 const obj = JSON.parse(raw) as { status?: string; outcome?: string; lastBeatAt?: string };
 const s = obj.status;
 if (s === 'done' || s === 'success') return { status: 'done', note: null };
 if (s === 'failed') return { status: 'failed', note: obj.outcome ?? null };
 if (s === 'cancelled') return { status: 'cancelled', note: null };
 if (s === 'stale') return { status: 'timeout', note: 'stale' };
 return null;
 } catch {
 return null;
 }
}

/**
 * Slice 1.3 — shared per-IDE polling core for trae / trae-cn / codex /
 * cursor. Same polling loop shape as `awaitClaudeCodeBatch`, with
 * per-IDE default timeout + note prefix. The 4 IDEs differ only in
 * (a) `defaultTimeoutMs` (Trae / Trae-CN / Cursor = 30s, Codex = 45s
 * per slice #13 R-3) and (b) the `note` label surfaced when an IDE
 * times out (so 1.4 dogfood can attribute a timeout to the right
 * IDE).
 *
 * MVP rationale (per Karpathy §2 Simplicity First): the 4 IDEs
 * currently share the same file-based polling transport. The only
 * per-IDE distinction is the timeout + label. Future per-IDE
 * divergence (real IPC / shell hooks) is a 1.4 dogfood concern —
 * here we keep the dispatcher interface uniform while each IDE's
 * `awaitBatch` is now a real implementation rather than the 1.2
 * `awaitByLlmFallback` marker.
 */
export interface PollDispatchRecordsOptions {
 readonly ide: 'trae' | 'trae-cn' | 'codex' | 'cursor';
 readonly defaultTimeoutMs: number;
 readonly notePrefix: string;
}

export async function pollDispatchRecords(
 input: SubAgentAwaitBatchInput,
 opts: PollDispatchRecordsOptions
): Promise<readonly SubAgentBatchResult[]> {
 const { dispatchCount, recordPaths, timeoutMs } = input;
 if (dispatchCount <= 0 || recordPaths.length === 0) {
 return [];
 }
 const startedAt = Date.now();
 const pollIntervalMs = 50;
 const deadline = timeoutMs ?? opts.defaultTimeoutMs;
 const capped = Math.min(Math.max(deadline, 0), 120_000);

 const results: SubAgentBatchResult[] = [];
 const remaining = new Map<number, { recordPath: string; status: SubAgentBatchResult['status']; note: string | null; finishedAt: number | null }>();
 for (let i = 0; i < recordPaths.length; i += 1) {
 const recordPath = recordPaths[i] ?? '';
 remaining.set(i, { recordPath, status: 'timeout', note: null, finishedAt: null });
 }

 while (remaining.size > 0 && Date.now() - startedAt < capped) {
 for (const [idx, slot] of remaining) {
 if (slot.finishedAt !== null) continue;
 const outcome = readDispatchOutcome(slot.recordPath);
 if (outcome === null) continue;
 slot.status = outcome.status;
 slot.note = outcome.note;
 slot.finishedAt = Date.now();
 }
 if (Array.from(remaining.values()).every((s) => s.finishedAt !== null)) break;
 await new Promise((r) => setTimeout(r, pollIntervalMs));
 }

 for (const [idx, slot] of remaining) {
 const finishedAt = slot.finishedAt ?? startedAt + capped;
 const baseNote = slot.status === 'timeout' ? `${opts.notePrefix} (timeout)` : opts.notePrefix;
 results.push({
 dispatchIndex: idx,
 recordPath: slot.recordPath,
 status: slot.status,
 durationMs: finishedAt - startedAt,
 note: slot.note !== null ? `${baseNote} — ${slot.note}` : baseNote
 });
 }
 results.sort((a, b) => a.dispatchIndex - b.dispatchIndex);
 return results;
}

/**
 * 1.2 fallback for trae / trae-cn / codex / cursor. Deprecated by
 * slice 1.3 — kept exported for legacy callers + back-compat tests
 * (the 1.2 marker is still a valid envelope shape; the 1.4 dogfood
 * tests can compare the marker note vs the 1.3 real note to verify
 * per-IDE attribution).
 */
export async function awaitByLlmFallback(
 input: SubAgentAwaitBatchInput,
 ide: string
): Promise<readonly SubAgentBatchResult[]> {
 const startedAt = Date.now();
 return input.recordPaths.map((p, i) => ({
 dispatchIndex: i,
 recordPath: p,
 status: 'timeout' as const,
 durationMs: 0,
 note: `awaitByLlm: ${ide} 1.2 fallback (real impl in 1.3)`
 }));
 void startedAt;
}

/**
 * In-process awaiter registration hook (used by `peaks sub-agent dispatch`
 * to attach a resolver; not part of the dispatcher public surface).
 * Reserved for slice 1.3 cross-process upgrade.
 */
export function registerClaudeCodeAwaiter(batchId: string, awaiter: Promise<readonly SubAgentBatchResult[]>): void {
 claudeCodeBatchAwaiters.set(batchId, awaiter);
 // Soft cap: keep at most 32 batches in memory; drop the oldest.
 if (claudeCodeBatchAwaiters.size > 32) {
 const oldest = claudeCodeBatchAwaiters.keys().next().value;
 if (oldest !== undefined) claudeCodeBatchAwaiters.delete(oldest);
 }
}
