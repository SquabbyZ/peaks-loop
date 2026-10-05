import { type EnforceDecision } from '../../services/sop/gate-enforce-service.js';
import {
  evaluateWorktreeAuth,
  type ToolCallKind,
  type WorktreeAuthCheckInput,
  type WorktreeAuthDecision
} from '../../services/hooks/worktree-authorization-gate.js';
import { getCurrentSessionId } from '../../services/skills/skill-presence-service.js';
import { ok } from 'peaks-loop-shared/result';

import { printResult, type ProgramIO } from '../cli-helpers.js';
import {
  detectIdeFromContext,
  pluckObject,
  pluckString
} from '../../services/ide/hook-translator.js';
import { DISPATCH_PROVENANCE_ENV } from '../../services/worktree/dispatch-provenance.js';
import { getAdapter } from '../../services/ide/ide-registry.js';
import { emitBlock, emitDecision, emitHint } from '../../services/hooks/output.js';

export type GateEnforceCliOptions = { project: string; json?: boolean };

/** The fail-closed deny variant of the worktree-gate decision. */
type WorktreeDeny = Extract<WorktreeAuthDecision, { allow: false }>;
/** The SOP deny variant of the enforcement decision. */
type SopDeny = Extract<EnforceDecision, { decision: 'deny' }>;
/** The SOP allow variant of the enforcement decision. */
type SopAllow = Extract<EnforceDecision, { decision: 'allow' }>;

/**
 * Parse the raw stdin payload, failing open to `null` on malformed JSON.
 */
export function parseHookStdin(raw: string): unknown {
  let parsedStdin: unknown = null;
  if (raw.trim().length > 0) {
    try {
      parsedStdin = JSON.parse(raw);
    } catch {
      // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0).
      // Malformed JSON — fail-open. Detect + parse on null fall back to the
      // default adapter and yield empty tool/command, which short-circuits to
      // the "not a guarded surface" early exit.
    }
  }
  return parsedStdin;
}

/**
 * Map Claude Code tool name to the gate's internal `ToolCallKind`. Anything we don't recognize
 * returns `'Other'` — the worktree gate is opt-in by tool, so unknown tools short-circuit to allow.
 */
export function classifyTool(toolName: string | undefined): ToolCallKind {
  if (toolName === 'Bash') return 'Bash';
  if (toolName === 'Agent' || toolName === 'Task') return 'Agent';
  if (toolName === 'EnterWorktree') return 'EnterWorktree';
  if (toolName === 'Workflow') return 'Workflow';
  return 'Other';
}

/**
 * Best-effort extraction of the `isolation` field for `Agent` / `Task` tool calls. The Claude
 * hook payload puts args under `tool_input`, the Cursor/Trae sibling puts them under `toolInput`.
 * Both shapes are accepted; everything else returns null.
 */
function extractIsolation(parsed: unknown): string | null {
  if (parsed === null || typeof parsed !== 'object') return null;
  const input = pluckObject(parsed, ['tool_input']) ?? pluckObject(parsed, ['toolInput']);
  if (input === undefined) return null;
  const value = pluckString(input, ['isolation']);
  return value === undefined ? null : value;
}

/**
 * Detect the IDE + adapter and return the adapter's tool matcher. For slice #1 only the Claude
 * adapter is registered, so the payload parser is Claude-shaped. Future slices dispatch on `ide`
 * to pick a per-adapter parser; the parser entry-point (`parseXxxShapeStdin`) is the only change
 * required.
 *
 * The Bash-surface predicate itself stays in `runGateEnforceAction`: TypeScript's aliased-condition
 * narrowing needs `isBashSurface` (which embeds `typeof command === 'string'`) computed in the same
 * scope where `command` is later read, so the extraction stops at the adapter lookup.
 */
export function resolveToolMatcher(parsedStdin: unknown): string {
  const ide = detectIdeFromContext({ env: process.env, cwd: process.cwd(), parsedStdin });
  return getAdapter(ide).toolMatcher;
}

/** `Bash` tool calls pass their command through; every other kind contributes `null`. */
function resolveBashCommand(toolKind: ToolCallKind, command: string | undefined): string | null {
  return toolKind === 'Bash' && typeof command === 'string' ? command : null;
}

/** Only `Agent` / `EnterWorktree` calls carry a gated `isolation`; others contribute `null`. */
function resolveIsolation(toolKind: ToolCallKind, parsedStdin: unknown): string | null {
  return toolKind === 'Agent' || toolKind === 'EnterWorktree'
    ? extractIsolation(parsedStdin)
    : null;
}

/** Lease ids are only honored when they are a 16-char hex token; anything else fails closed. */
function normalizeLeaseId(value: string | null): string | null {
  return value !== null && /^[a-f0-9]{16}$/.test(value) ? value : null;
}

/**
 * Assemble the worktree-gate input from the hook payload (Bash/Agent/EnterWorktree/Workflow).
 * We extract the tool kind from the hook payload. For Agent/Task we also pull `isolation` from the
 * tool input — only "worktree" isolation is gated. For all other tool kinds the worktree gate is a
 * no-op.
 *
 * `PEAKS_WORKTREE_LEASE_ID` as a second authorization path when no `peaks worktree auth grant` is on
 * file. Dispatch (Part 2.C) injects the env var on every sub-agent spawn so worktree-mutating tool
 * calls from inside the sub-agent process auto-authorize via the lease instead of requiring a
 * separate grant. Part 19: container lease (L4) is the parallel path for `--isolation container`
 * sub-agents. The env is set by the dispatch command (Part 8 + Part 12) at spawn time.
 */
function buildWorktreeAuthInput(
  options: GateEnforceCliOptions,
  toolKind: ToolCallKind,
  command: string | undefined,
  parsedStdin: unknown
): WorktreeAuthCheckInput {
  const sessionId = getCurrentSessionId(options.project) ?? 'unknown-sid';
  return {
    projectRoot: options.project,
    sessionId,
    toolName: toolKind,
    command: resolveBashCommand(toolKind, command),
    isolation: resolveIsolation(toolKind, parsedStdin),
    requestId: null,
    leaseId: normalizeLeaseId(process.env.PEAKS_WORKTREE_LEASE_ID ?? null),
    containerLeaseId: normalizeLeaseId(process.env.PEAKS_CONTAINER_LEASE_ID ?? null),
    dispatchProvenanceToken: process.env[DISPATCH_PROVENANCE_ENV] ?? null
  };
}

/**
 * Run the fail-closed worktree authorization gate for a gated tool kind. Returns `true` when the
 * call was denied (a hard block has already been emitted and the handler must stop) and `false`
 * when the flow should continue to the SOP gate. `Other` tool kinds are not gated at all.
 *
 * gate. The worktree gate is narrower than the SOP gate (it only inspects a small set of
 * worktree-mutating operations) and is fail-CLOSED. The two layers are complementary: SOP gates
 * decide "may this command run under this SOP's state", the worktree gate decides "did the user
 * explicitly authorize this worktree-mutating operation in the current task". The worktree gate is
 * cheap and self-contained, so it runs first to give the LLM a clear error reason before the SOP
 * gate would otherwise allow.
 *
 * wtDecision may have arrived via lease (viaLease != null); the SOP gate does not care which path
 * granted, only that the worktree gate said allow.
 */
export function handleWorktreeGate(
  io: ProgramIO,
  options: GateEnforceCliOptions,
  toolKind: ToolCallKind,
  payload: { command: string | undefined; parsedStdin: unknown }
): boolean {
  if (toolKind === 'Other') {
    return false;
  }
  const wtDecision = evaluateWorktreeAuth(
    buildWorktreeAuthInput(options, toolKind, payload.command, payload.parsedStdin)
  );
  if (!wtDecision.allow) {
    emitWorktreeDeny(io, options, wtDecision);
    return true;
  }
  // allow: continue to the SOP gate (the regular enforcement path).
  return false;
}

/**
 * Not a guarded surface — allow. Emit minimal JSON on stdout so Claude Code's PreToolUse hook
 * validator accepts the response. Empty stdout is rejected with "Hook JSON output validation
 * failed — Invalid input" in Claude Code 2.x; `{}` is the canonical no-op marker.
 */
export function emitAllowSkipped(io: ProgramIO, options: GateEnforceCliOptions): void {
  if (options.json === true) {
    printResult(io, ok('gate.enforce', { decision: 'allow', skipped: true }), true);
  } else {
    emitDecision(io, {});
  }
}

/**
 * Hard block: a worktree-mutating tool call without a current-task user grant. emitBlock writes
 * the Claude Code permissionDecision:"deny" envelope and exits 2. The reason includes the
 * remediation hint so the LLM can run `peaks worktree auth grant` and retry, and the user can
 * read the deny text in the next-turn stderr.
 */
function emitWorktreeDeny(
  io: ProgramIO,
  options: GateEnforceCliOptions,
  wtDecision: WorktreeDeny
): void {
  emitBlock(
    io,
    `[worktree-gate:${wtDecision.code}] ${wtDecision.reason} — ${wtDecision.remediation}`
  );
  if (options.json === true) {
    emitHint(
      io,
      JSON.stringify(
        ok('gate.enforce', { decision: 'deny', layer: 'worktree-auth', ...wtDecision })
      )
    );
  }
}

/** Worktree gate allowed and this is not a Bash surface — allow without running the SOP gate. */
export function emitAllowWorktree(io: ProgramIO, options: GateEnforceCliOptions): void {
  if (options.json === true) {
    printResult(io, ok('gate.enforce', { decision: 'allow', layer: 'worktree-auth' }), true);
  } else {
    emitDecision(io, {});
  }
}

/**
 * writes the Claude Code permissionDecision:"deny" JSON to stdout (the hook's decision signal),
 * sets process.exitCode = 2 (Claude Code's block exit code), AND surfaces the reason to stderr so
 * the LLM sees it on the next turn. This prevents the previous behaviour where Claude Code wrapped
 * the output as "PreToolUse:Bash hook error".
 */
export function emitSopDeny(
  io: ProgramIO,
  options: GateEnforceCliOptions,
  decision: SopDeny
): void {
  emitBlock(io, decision.reason);
  if (options.json === true) {
    emitHint(io, JSON.stringify(ok('gate.enforce', decision)));
  }
}

/** Surface any SOP-gate warnings as hints before the allow decision is emitted. */
export function emitSopWarnings(io: ProgramIO, decision: SopAllow): void {
  if (decision.warnings && decision.warnings.length > 0) {
    for (const warning of decision.warnings) {
      emitHint(io, warning);
    }
  }
}

/**
 * SOP gate allowed the command. --json mode emits the canonical envelope on stdout (the documented
 * contract for downstream tooling). The hook decision (allow/deny) is still signalled via
 * emitHint here was wrong — emitHint writes to stderr, but the AC5 contract expects the JSON
 * envelope on stdout. Switch to printResult(asJson=true).
 */
export function emitSopAllow(
  io: ProgramIO,
  options: GateEnforceCliOptions,
  decision: SopAllow
): void {
  if (options.json === true) {
    printResult(io, ok('gate.enforce', decision), true);
  } else {
    // allow: emit minimal JSON on stdout so Claude Code's PreToolUse hook
    // validator accepts the response (see comment above).
    emitDecision(io, {});
  }
}
