import { Command } from 'commander';
import { enforceBashCommand, recordGateBypass, GateBypassError } from '../../services/sop/gate-enforce-service.js';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';

type GateEnforceCliOptions = { project: string; json?: boolean };
type GateBypassCliOptions = { sop: string; phase: string; reason: string; project: string; json?: boolean };

type HookPayload = { tool_name?: string; tool_input?: { command?: string } };

/** Read the PreToolUse hook payload. `PEAKS_HOOK_STDIN` is a test seam; production reads stdin. */
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

function emitDeny(io: ProgramIO, reason: string): void {
  // The exact, verified PreToolUse decision shape. permissionDecision:"deny"
  // blocks the tool call before Claude Code's permission checks (un-bypassable).
  io.stdout(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason
    }
  }));
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
      let command: string | undefined;
      let toolName: string | undefined;
      if (raw.trim().length > 0) {
        const payload = JSON.parse(raw) as HookPayload;
        toolName = payload.tool_name;
        command = payload.tool_input?.command;
      }
      if (toolName !== 'Bash' || typeof command !== 'string' || command.trim().length === 0) {
        // Not a guarded surface — allow (no output = normal permission flow).
        if (options.json === true) {
          printResult(io, ok('gate.enforce', { decision: 'allow', skipped: true }), true);
        }
        return;
      }
      const decision = await enforceBashCommand(options.project, command);
      if (decision.decision === 'deny') {
        emitDeny(io, decision.reason);
        if (options.json === true) {
          io.stderr(JSON.stringify(ok('gate.enforce', decision)));
        }
        return;
      }
      if (decision.warnings && decision.warnings.length > 0) {
        for (const warning of decision.warnings) {
          io.stderr(warning);
        }
      }
      if (options.json === true) {
        io.stderr(JSON.stringify(ok('gate.enforce', decision)));
      }
      // allow: emit nothing on stdout → normal permission flow.
    } catch (error) {
      // Fail-open: a bug in enforcement must not brick Claude Code.
      io.stderr(`gate enforce: internal error, allowing command (${getErrorMessage(error)})`);
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
