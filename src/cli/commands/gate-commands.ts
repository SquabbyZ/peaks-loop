import { Command } from 'commander';
import { enforceBashCommand, recordGateBypass, GateBypassError } from '../../services/sop/gate-enforce-service.js';
import { evaluateWorktreeAuth, type ToolCallKind } from '../../services/hooks/worktree-authorization-gate.js';
import { getCurrentSessionId } from '../../services/skills/skill-presence-service.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { detectIdeFromContext, parseClaudeShapeStdin, pluckObject, pluckString } from '../../services/ide/hook-translator.js';
import { getAdapter } from '../../services/ide/ide-registry.js';
import { emitBlock, emitDecision, emitHint } from '../../services/hooks/output.js';

type GateEnforceCliOptions = { project: string; json?: boolean };
type GateBypassCliOptions = { sop: string; phase: string; reason: string; project: string; json?: boolean };

/**
 * Read the PreToolUse hook payload. `PEAKS_HOOK_STDIN` is a test seam; production
 * reads stdin. The CLI-side stdin reader is intentionally kept here (not in
 * `hook-translator.ts`) because it owns the `process.stdin` lifecycle and the
 * test-seam env var. The translator operates on already-parsed payloads.
 */
async function readHookPayload(): Promise<string> {
  const override = process.env.PEAKS_HOOK_STDIN;
  if (override !== undefined) {
    return override;
  }
  if (process.stdin.isTTY) {
    return '';
  }
  return new Promise<string>((resolveStdin) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolveStdin(data));
    process.stdin.on('error', () => resolveStdin(data));
  });
}

/**
 * Map Claude Code tool name to the gate's internal `ToolCallKind`. Anything we don't recognize
 * returns `'Other'` — the worktree gate is opt-in by tool, so unknown tools short-circuit to allow.
 */
function classifyTool(toolName: string | undefined): ToolCallKind {
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

export function registerGateCommands(program: Command, io: ProgramIO): void {
  const gate = program.command('gate').description('SOP gate enforcement (PreToolUse hook handler and bypass)');

  addJsonOption(
    gate
      .command('enforce')
      .description('PreToolUse hook handler: deny a Bash command guarded by an unsatisfied SOP gate')
      .option('--project <path>', 'project the gates evaluate against (default: current directory)', '.')
  ).action(async (options: GateEnforceCliOptions) => {
    // Trust red line: this runs on (potentially) every Bash call. Any failure to
    // decide must FAIL-OPEN (allow), never block the user's Claude Code.
    try {
      const raw = await readHookPayload();
      let parsedStdin: unknown = null;
      if (raw.trim().length > 0) {
        try {
          parsedStdin = JSON.parse(raw);
        } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
          // Malformed JSON — fail-open. Detect + parse on null fall back to the
          // default adapter and yield empty tool/command, which short-circuits
          // to the "not a guarded surface" early exit below.
        }
      }
      const ide = detectIdeFromContext({ env: process.env, cwd: process.cwd(), parsedStdin });
      const adapter = getAdapter(ide);
      // For slice #1 only the Claude adapter is registered, so the parser is
      // Claude-shaped. Future slices dispatch on `ide` to pick a per-adapter
      // parser; the parser entry-point (`parseXxxShapeStdin`) is the only
      // change required.
      const { toolName, command } = parseClaudeShapeStdin(parsedStdin);
      if (toolName !== adapter.toolMatcher || typeof command !== 'string' || command.trim().length === 0) {
        // Not a guarded surface — allow. Emit minimal JSON on stdout so Claude
        // Code's PreToolUse hook validator accepts the response. Empty stdout
        // is rejected with "Hook JSON output validation failed — Invalid input"
        // in Claude Code 2.x; `{}` is the canonical no-op marker.
        if (options.json === true) {
          printResult(io, ok('gate.enforce', { decision: 'allow', skipped: true }), true);
        } else {
          emitDecision(io, {});
        }
        return;
      }

      // slice 2026-07-27-worktree-user-auth: BEFORE the SOP gate runs, check the worktree
      // authorization gate. The worktree gate is narrower than the SOP gate (it only inspects
      // a small set of worktree-mutating operations) and is fail-CLOSED. The two layers are
      // complementary: SOP gates decide "may this command run under this SOP's state", the
      // worktree gate decides "did the user explicitly authorize this worktree-mutating operation
      // in the current task". The worktree gate is cheap and self-contained, so it runs first
      // to give the LLM a clear error reason before the SOP gate would otherwise allow.
      //
      // We extract the tool kind from the hook payload (Bash/Agent/EnterWorktree/Workflow).
      // For Agent/Task we also pull `isolation` from the tool input — only "worktree" isolation
      // is gated. For all other tool kinds the worktree gate is a no-op.
      const toolKind = classifyTool(toolName);
      if (toolKind !== 'Other') {
        const sessionId = getCurrentSessionId(options.project) ?? 'unknown-sid';
        // slice 2026-07-29-worktree-l2-extended Part 2.B: the gate consults
        // the lease file referenced by `PEAKS_WORKTREE_LEASE_ID` as a
        // second authorization path when no `peaks worktree auth grant`
        // is on file. Dispatch (Part 2.C) injects the env var on every
        // sub-agent spawn so worktree-mutating tool calls from inside
        // the sub-agent process auto-authorize via the lease instead
        // of requiring a separate grant.
        const leaseId = process.env.PEAKS_WORKTREE_LEASE_ID ?? null;
        // Part 19: container lease (L4) is the parallel path for
        // `--isolation container` sub-agents. The env is set by the
        // dispatch command (Part 8 + Part 12) at spawn time.
        const containerLeaseId = process.env.PEAKS_CONTAINER_LEASE_ID ?? null;
        const wtDecision = evaluateWorktreeAuth({
          projectRoot: options.project,
          sessionId,
          toolName: toolKind,
          command: toolKind === 'Bash' ? command : null,
          isolation: toolKind === 'Agent' || toolKind === 'EnterWorktree' ? extractIsolation(parsedStdin) : null,
          requestId: null,
          leaseId: leaseId !== null && /^[a-f0-9]{16}$/.test(leaseId) ? leaseId : null,
          containerLeaseId: containerLeaseId !== null && /^[a-f0-9]{16}$/.test(containerLeaseId) ? containerLeaseId : null
        });
        if (!wtDecision.allow) {
          // Hard block: a worktree-mutating tool call without a current-task user grant.
          // emitBlock writes the Claude Code permissionDecision:"deny" envelope and exits 2.
          // The reason includes the remediation hint so the LLM can run `peaks worktree auth grant`
          // and retry, and the user can read the deny text in the next-turn stderr.
          emitBlock(io, `[worktree-gate:${wtDecision.code}] ${wtDecision.reason} — ${wtDecision.remediation}`);
          if (options.json === true) {
            emitHint(io, JSON.stringify(ok('gate.enforce', { decision: 'deny', layer: 'worktree-auth', ...wtDecision })));
          }
          return;
        }
        // allow: continue to the SOP gate (the regular enforcement path).
        // wtDecision may have arrived via lease (viaLease != null); the SOP gate does not
        // care which path granted, only that the worktree gate said allow.
      }

      const decision = await enforceBashCommand(options.project, command);
      if (decision.decision === 'deny') {
        // PRD#2 (2026-06-16-fact-forcing-gate-format): a true SOP gate failure is
        // a HARD block. emitBlock writes the Claude Code permissionDecision:"deny"
        // JSON to stdout (the hook's decision signal), sets process.exitCode = 2
        // (Claude Code's block exit code), AND surfaces the reason to stderr so
        // the LLM sees it on the next turn. This prevents the previous behaviour
        // where Claude Code wrapped the output as "PreToolUse:Bash hook error".
        emitBlock(io, decision.reason);
        if (options.json === true) {
          emitHint(io, JSON.stringify(ok('gate.enforce', decision)));
        }
        return;
      }
      if (decision.warnings && decision.warnings.length > 0) {
        for (const warning of decision.warnings) {
          emitHint(io, warning);
        }
      }
      if (options.json === true) {
        emitHint(io, JSON.stringify(ok('gate.enforce', decision)));
      } else {
        // allow: emit minimal JSON on stdout so Claude Code's PreToolUse hook
        // validator accepts the response (see comment above).
        emitDecision(io, {});
      }
    } catch (error) {
      // Fail-open: a bug in enforcement must not brick Claude Code.
      emitHint(io, `gate enforce: internal error, allowing command (${getErrorMessage(error)})`);
    }
  });

  addJsonOption(
    gate
      .command('bypass')
      .description('Record a one-shot bypass so the next guarded Bash command is allowed once')
      .requiredOption('--sop <id>', 'SOP id whose guard to bypass')
      .requiredOption('--phase <phase>', 'phase whose gate to bypass')
      .requiredOption('--reason <text>', 'justification recorded for the bypass')
      .option('--project <path>', 'project whose run-state holds the token (default: current directory)', '.')
  ).action((options: GateBypassCliOptions) => {
    try {
      if (options.reason.trim().length === 0) {
        printResult(io, fail('gate.bypass', 'BYPASS_REASON_REQUIRED', '--reason must not be empty', { sop: options.sop, phase: options.phase }, ['Provide --reason "<why>"']), options.json);
        process.exitCode = 1;
        return;
      }
      const result = recordGateBypass(options.project, options.sop, options.phase, options.reason);
      printResult(
        io,
        ok('gate.bypass', { sop: options.sop, phase: options.phase, count: result.count }, [], ['The next guarded Bash command for this transition will be allowed once']),
        options.json
      );
    } catch (error) {
      const code = error instanceof GateBypassError ? error.code : 'GATE_BYPASS_FAILED';
      printResult(io, fail('gate.bypass', code, getErrorMessage(error), { sop: options.sop, phase: options.phase }, ['Satisfy the gate instead of bypassing']), options.json);
      process.exitCode = 1;
    }
  });
}
