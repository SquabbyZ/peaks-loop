import { Command } from 'commander';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { detectIdeFromContext, parseAdapterStdin, parseClaudeShapeStdin, pluckObject, pluckString } from '../../services/ide/hook-translator.js';
import { buildCanonicalHook, formatDecisionResponse } from '../../services/ide/hook-protocol.js';
import { getAdapter } from '../../services/ide/ide-registry.js';
import { evaluateCodeBan } from '../../services/audit/enforcers/code-ban.js';
import { isRootWrite } from '../../services/audit/enforcers/no-root-pollution.js';
import { checkLoginGate } from '../../services/audit/enforcers/login-gate.js';
import { getSessionIdCanonical } from '../../services/session/session-manager.js';
import { resolveActiveSkillForCaller } from '../../services/audit/enforcers/active-skill-resolver.js';
import { fail, ok } from '../../shared/result.js';
import { emitDecision, emitHint } from '../../services/hooks/output.js';

type HookHandleOptions = { project: string; json?: boolean };

/**
 * Read the hook payload. `PEAKS_HOOK_STDIN` is a test seam (same convention as
 * `gate-commands.ts`); production reads stdin. The TTY short-circuit means an
 * interactive shell invocation is treated as an empty payload (allow).
 */
async function readStdin(): Promise<string> {
  const override = process.env.PEAKS_HOOK_STDIN;
  if (override !== undefined) {
    return override;
  }
  if (process.stdin.isTTY) return '';
  return new Promise<string>((resolveStdin) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolveStdin(data));
    process.stdin.on('error', () => resolveStdin(data));
  });
}

/**
 * `peaks hook handle` —— peaks 自有 hook 协议的单一入口。
 *
 * 该命令是 peaks-loop 拥有的 hook 处理总入口。它:
 *   1. 读 stdin
 *   2. auto-detect 来源 IDE(env / stdin shape / cwd)
 *   3. 归一化到 peaks canonical schema
 *   4. dispatch 到内部 peaks 逻辑(目前:gate enforce)
 *   5. 用 IDE 期望的格式发回决策
 *
 * Slice #1 阶段:peaks hook handle 与 peaks gate enforce
 * 并存(后者内部走 hook-translator)。Slice #2 把 IDE settings 改成调用
 * peaks hook handle 即可。Slice #3 删除旧命令。
 */
export function registerHookHandleCommand(program: Command, io: ProgramIO): void {
  const hook = program.command('hook').description('Peaks 自有 hook 协议单一入口（slice #1 新增；后续 slice 将逐步替代 gate enforce）');

  addJsonOption(
    hook
      .command('handle')
      .description('Read stdin hook payload, auto-detect IDE, dispatch to peaks gate-enforce logic, output IDE-formatted decision')
      .option('--project <path>', 'project the gates evaluate against (default: current directory)', '.')
  ).action(async (options: HookHandleOptions) => {
    try {
      const raw = await readStdin();
      let parsed: unknown = null;
      if (raw.trim().length > 0) {
        try {
          parsed = JSON.parse(raw);
        } catch {
          // Malformed JSON — treat as empty payload (fail-open)
          parsed = null;
        }
      }

      const ide = detectIdeFromContext({ env: process.env, cwd: process.cwd(), parsedStdin: parsed });
      const adapter = getAdapter(ide);

      // Slice #3: per-adapter stdin parser dispatch. The detected IDE
      // determines which parser runs; unknown IDEs fall back to the Claude
      // shape (preserves slice #1's "fail-open to Claude" semantics).
      const { toolName, command } = parseAdapterStdin(ide, parsed);
      // Also try the Claude parser as a secondary fallback so a Trae user who
      // accidentally pipes a Claude-shaped payload still gets the right fields.
      const claudeShape = parseClaudeShapeStdin(parsed);
      const fallbackToolName = toolName ?? claudeShape.toolName ?? pluckString(parsed, ['toolName']);
      const fallbackCommand = command ?? claudeShape.command ?? pluckString(parsed, ['toolInput', 'command']);

      const projectRoot = process.env[adapter.envVar] ?? options.project;

      const hook = buildCanonicalHook({
        toolName: fallbackToolName ?? '',
        toolInput: pluckObject(parsed, ['tool_input']) ?? pluckObject(parsed, ['toolInput']) ?? {},
        projectRoot,
        rawIdeFormat: ide,
        rawPayload: parsed
      });

      // Dispatch by toolName. For slice #1+, we only handle Bash. Task tool sub-agent dispatch goes through `peaks sub-agent dispatch` (slice #009) and does not need a hook entry.
      // Other tools: allow (no-op; future events will be added here).
      if (hook.toolName === 'Bash' && typeof fallbackCommand === 'string' && fallbackCommand.trim().length > 0) {
        // L2.1 P0 #1: code-commit-ban. Deny `git commit` / `git apply` from peaks-* skills
        // BEFORE the SOP gate runs. The active skill is read from the per-caller
        // active-skill file (see active-skill-resolver.ts).
        const activeSkill = resolveActiveSkillForCaller(projectRoot);
        if (activeSkill.skill !== null) {
          const codeDecision = evaluateCodeBan({ skill: activeSkill.skill, command: fallbackCommand });
          if (codeDecision.denied) {
            const formatted = formatDecisionResponse(ide, 'deny', codeDecision.reason);
            emitDecision(io, formatted.stdout);
            if (options.json === true) {
              emitHint(io, JSON.stringify(ok('hook.handle', { ide, tool: hook.toolName, decision: 'deny', reason: codeDecision.reason, enforcer: 'code-ban' })));
            }
            return;
          }
        }

        // Lazy import to avoid circular: peaks gate enforce logic
        const { enforceBashCommand } = await import('../../services/sop/gate-enforce-service.js');
        const decision = await enforceBashCommand(projectRoot, fallbackCommand);
        if (decision.decision === 'deny') {
          const formatted = formatDecisionResponse(ide, 'deny', decision.reason);
          emitDecision(io, formatted.stdout);
          if (options.json === true) {
            emitHint(io, JSON.stringify(ok('hook.handle', { ide, tool: hook.toolName, decision: 'deny', reason: decision.reason })));
          }
          return;
        }
        }

      // L2.2 P1 #1: login-gate. After code-commit-ban + gate-enforce pass,
      // flag destructive patterns (uninstall, force-push, --force, --hard,
      // rm -rf) so the LLM gets a soft warning (still allow). The user
      // gets the warning via the warn channel; the command proceeds.
      if (hook.toolName === 'Bash' && typeof fallbackCommand === 'string') {
        const gate = checkLoginGate({ command: fallbackCommand });
        if (gate.destructive) {
          emitHint(io, `warning: login-gate: destructive command detected (pattern: ${gate.matchedPattern}). Confirm with the user before proceeding.`);
        }
        }

      // L2.1 P0 #2: no-root-pollution. Deny Write/Edit to files outside the
      // root allowlist. file_path is read from toolInput.file_path (Claude
      // and most IDEs use the same shape). When the field is missing or the
      // path is not at depth 1, the enforcer allows (no-op).
      if (hook.toolName === 'Write' || hook.toolName === 'Edit' || hook.toolName === 'MultiEdit' || hook.toolName === 'Create') {
        const filePath = pluckString(parsed, ['tool_input', 'file_path'])
          ?? pluckString(parsed, ['toolInput', 'file_path'])
          ?? pluckString(parsed, ['tool_input', 'path'])
          ?? pluckString(parsed, ['toolInput', 'path']);
        if (typeof filePath === 'string' && filePath.trim().length > 0) {
          const rootCheck = isRootWrite({ projectRoot, filePath });
          if (!rootCheck.allowed) {
            const formatted = formatDecisionResponse(ide, 'deny', rootCheck.denyReason);
            emitDecision(io, formatted.stdout);
            if (options.json === true) {
              emitHint(io, JSON.stringify(ok('hook.handle', { ide, tool: hook.toolName, decision: 'deny', reason: rootCheck.denyReason, enforcer: 'no-root-pollution' })));
            }
            return;
          }
        }
      }

      const allow = formatDecisionResponse(ide, 'allow');
      emitDecision(io, allow.stdout);
      if (options.json === true) {
        printResult(io, ok('hook.handle', { ide, tool: hook.toolName, decision: 'allow' }), true);
      }
    } catch (error) {
      // Fail-open: a bug in hook.handle must not brick Claude Code.
      emitHint(io, `hook handle: internal error, allowing command (${error instanceof Error ? error.message : String(error)})`);
      if (options.json === true) {
        printResult(io, fail('hook.handle', 'HOOK_HANDLE_FAILED', error instanceof Error ? error.message : 'unknown', {}), true);
      }
    }
  });
}
