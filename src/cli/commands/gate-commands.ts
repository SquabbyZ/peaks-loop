import type { Command } from 'commander';
import {
  enforceBashCommand,
  recordGateBypass,
  GateBypassError
} from '../../services/sop/gate-enforce-service.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { emitHint } from '../../services/hooks/output.js';
import { parseClaudeShapeStdin } from '../../services/ide/hook-translator.js';
import type { ToolCallKind } from '../../services/hooks/worktree-authorization-gate.js';
import {
  classifyTool,
  emitAllowSkipped,
  emitAllowWorktree,
  emitSopAllow,
  emitSopDeny,
  emitSopWarnings,
  handleWorktreeGate,
  parseHookStdin,
  resolveToolMatcher,
  type GateEnforceCliOptions
} from './gate-commands-enforce.js';
import { handleMcpSurfaceGate } from '../../services/hooks/mcp-surface-gate.js';

type GateBypassCliOptions = {
  sop: string;
  phase: string;
  reason: string;
  project: string;
  json?: boolean;
};

export function registerGateCommands(program: Command, io: ProgramIO): void {
  const gate = program
    .command('gate')
    .description('SOP gate enforcement (PreToolUse hook handler and bypass)');

  registerGateEnforceCommand(gate, io);
  registerGateBypassCommand(gate, io);
}

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
      data += String(chunk);
    });
    process.stdin.on('end', () => resolveStdin(data));
    process.stdin.on('error', () => resolveStdin(data));
  });
}

/**
 * handler returns. The default behavior is to wait for stdin EOF before exiting, but the hook's
 * stdin pipe may not close promptly (the parent can keep the handle open even after it has finished
 * reading the JSON decision), which causes 4 Node.js processes to accumulate in the user's task
 * manager. An explicit process.exit here forces the gate process to release all handles and exit
 * immediately.
 *
 * PEAKS_HOOK_STDIN test seam, no PEAKS_TEST_SEAM env var). The test harness calls `runCommand`
 * which invokes the same action handler in process — calling `process.exit` inside the test would
 * kill the vitest runner before assertions complete. The `process.exitCode` set above is sufficient
 * for the test path: Commander's `parseAsync` resolves the action, then the harness reads the
 * captured stdout/stderr before the runner exits normally with the recorded exit code.
 */
function exitWhenRealCliHook(): void {
  if (process.env.PEAKS_HOOK_STDIN === undefined && process.env.PEAKS_TEST_SEAM === undefined) {
    process.exit(process.exitCode || 0);
  }
}

/** Which of the surfaces this payload is on, and what the gates downstream need. */
interface HookSurface {
  readonly toolKind: ToolCallKind;
  readonly command: string | undefined;
  /** The command, when this really is the Bash surface — otherwise `null`. */
  readonly bashCommand: string | null;
  readonly isWorktreeToolSurface: boolean;
}

/** Read the payload's surface out of the tool name, the adapter's matcher and the command. */
function classifySurface(parsedStdin: unknown): HookSurface {
  const toolMatcher = resolveToolMatcher(parsedStdin);
  const { toolName, command } = parseClaudeShapeStdin(parsedStdin);
  const toolKind = classifyTool(toolName);
  const isBash =
    toolName === toolMatcher && typeof command === 'string' && command.trim().length > 0;
  return {
    toolKind,
    command,
    bashCommand: isBash ? command : null,
    isWorktreeToolSurface: toolKind === 'Agent' || toolKind === 'EnterWorktree'
  };
}

/**
 * Body of the `gate enforce` PreToolUse handler. The worktree-then-SOP ordering and every early
 * return / exit-code path are documented on the helpers this delegates to in `gate-commands-enforce`.
 */
async function runGateEnforceAction(io: ProgramIO, options: GateEnforceCliOptions): Promise<void> {
  // Trust red line: this runs on (potentially) every Bash call. Any failure to
  // decide must FAIL-OPEN (allow), never block the user's Claude Code.
  try {
    const raw = await readHookPayload();
    const parsedStdin = parseHookStdin(raw);
    // The MCP branch runs FIRST and is fail-CLOSED, so it must not sit behind
    // the "not a guarded surface" early return below — an MCP tool name matches
    // neither the Bash matcher nor a worktree tool, so everything after this
    // point would wave it through. A block here has already been emitted.
    if (handleMcpSurfaceGate(io, parsedStdin)) {
      return;
    }
    const surface = classifySurface(parsedStdin);
    const { toolKind, command } = surface;
    if (surface.bashCommand === null && !surface.isWorktreeToolSurface) {
      emitAllowSkipped(io, options);
      return;
    }
    if (handleWorktreeGate(io, options, toolKind, { command, parsedStdin })) {
      return;
    }
    if (surface.bashCommand === null) {
      emitAllowWorktree(io, options);
      return;
    }
    const decision = await enforceBashCommand(options.project, surface.bashCommand);
    if (decision.decision === 'deny') {
      emitSopDeny(io, options, decision);
      return;
    }
    emitSopWarnings(io, decision);
    emitSopAllow(io, options, decision);
  } catch (error) {
    // Fail-open: a bug in enforcement must not brick Claude Code.
    emitHint(io, `gate enforce: internal error, allowing command (${getErrorMessage(error)})`);
  }
  exitWhenRealCliHook();
}

function registerGateEnforceCommand(gate: Command, io: ProgramIO): void {
  addJsonOption(
    gate
      .command('enforce')
      .description(
        'PreToolUse hook handler: deny a Bash command guarded by an unsatisfied SOP gate'
      )
      .option(
        '--project <path>',
        'project the gates evaluate against (default: current directory)',
        '.'
      )
  ).action(async (options: GateEnforceCliOptions) => {
    await runGateEnforceAction(io, options);
  });
}

function registerGateBypassCommand(gate: Command, io: ProgramIO): void {
  addJsonOption(
    gate
      .command('bypass')
      .description('Record a one-shot bypass so the next guarded Bash command is allowed once')
      .requiredOption('--sop <id>', 'SOP id whose guard to bypass')
      .requiredOption('--phase <phase>', 'phase whose gate to bypass')
      .requiredOption('--reason <text>', 'justification recorded for the bypass')
      .option(
        '--project <path>',
        'project whose run-state holds the token (default: current directory)',
        '.'
      )
  ).action((options: GateBypassCliOptions) => {
    runGateBypassAction(io, options);
  });
}

function runGateBypassAction(io: ProgramIO, options: GateBypassCliOptions): void {
  try {
    if (options.reason.trim().length === 0) {
      printResult(
        io,
        fail(
          'gate.bypass',
          'BYPASS_REASON_REQUIRED',
          '--reason must not be empty',
          { sop: options.sop, phase: options.phase },
          ['Provide --reason "<why>"']
        ),
        options.json
      );
      process.exitCode = 1;
      return;
    }
    const result = recordGateBypass(options.project, options.sop, options.phase, options.reason);
    printResult(
      io,
      ok(
        'gate.bypass',
        { sop: options.sop, phase: options.phase, count: result.count },
        [],
        ['The next guarded Bash command for this transition will be allowed once']
      ),
      options.json
    );
  } catch (error) {
    const code = error instanceof GateBypassError ? error.code : 'GATE_BYPASS_FAILED';
    printResult(
      io,
      fail(
        'gate.bypass',
        code,
        getErrorMessage(error),
        { sop: options.sop, phase: options.phase },
        ['Satisfy the gate instead of bypassing']
      ),
      options.json
    );
    process.exitCode = 1;
  }
}
