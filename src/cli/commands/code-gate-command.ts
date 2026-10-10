/**
 *
 * Vendor-neutral PreToolUse hook entry. Reads the standard hook JSON
 * payload from stdin and either exits 0 (allow) or exits 2 with stderr
 * containing PEAKS_CODE_PROHIBITED_DIRECT_EDIT (deny).
 *
 * This command is the runtime adapter for the shell-script sibling
 * (`src/services/hooks/pre-tool-code-gate.sh`). Both share the same
 * path-family decision; the CLI invokes the same pure decision
 * function (`decideGateAction`) the shell script encodes.
 *
 * Settings.json entry shape (vendor-neutral, registered by
 * `peaks hooks install`): an `Edit|Write|MultiEdit` matcher whose command is
 * `peaks code-gate`, carrying the adapter's own project-root env var and
 * `--json`.
 *
 * The vendor-specific install code (`src/cli/commands/hooks-commands.ts`
 * + `src/services/ide/adapters/*`) is the only place that knows how
 * to render this into any IDE's settings.json shape. This file is
 * vendor-neutral — no vendor references in the source code itself.
 */

import type { Command } from 'commander';

import { type ProgramIO, addJsonOption, printResult } from '../cli-helpers.js';
import {
  decideGateAction,
  extractFilePath,
  type GateToolName
} from '../../services/hooks/pre-tool-code-gate.js';
import {
  hasLeaseForCaller,
  resolveActiveSkillForCaller
} from '../../services/audit/enforcers/active-skill-resolver.js';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { pluckObject, pluckString } from '../../services/ide/hook-translator.js';
import { fail, ok } from 'peaks-loop-shared/result';

/**
 * The command layer's view of the hook payload. The same tool call arrives
 * under two spellings of the same three keys — `{tool, input}` and
 * `{tool_name, tool_input}` — and both must decide identically, so the fields
 * stay unread here and are normalised below. Reading only one spelling leaves
 * every call under the other ungated, because a tool name that is not one of
 * the gated three is allowed before the path is ever consulted. The
 * caller-identifying fields ride in the same JSON.
 */
type HookPayload = Record<string, unknown>;

/**
 * Read the tool call's name from whichever spelling supplies it, or `''` when
 * neither does. `tool_name` is the harness spelling; `tool` is the one this
 * command's own header documents. The shell-script sibling accepts both and
 * calls each key by name, and the two gates must not disagree about what a
 * payload says.
 */
function readToolName(parsed: HookPayload): GateToolName {
  return pluckString(parsed, ['tool_name']) ?? pluckString(parsed, ['tool']) ?? '';
}

/** Read the tool call's arguments from whichever spelling supplies them. */
function readToolInput(parsed: HookPayload): Readonly<Record<string, unknown>> {
  return pluckObject(parsed, ['tool_input']) ?? pluckObject(parsed, ['input']) ?? {};
}

/**
 * Resolve which skill is driving this tool call, or `null` when that cannot be
 * established.
 *
 * The identity comes from the payload rather than the environment: whether a
 * hook subprocess inherits caller-identifying env is unverified, and the
 * payload already carries the id. The lease lookup is scoped to that id — an id
 * owning no lease is indistinguishable from an id that is not the lease's key,
 * and an unscoped read would answer with whichever lease the directory listing
 * yielded first, i.e. with another window's skill. Both cases resolve to
 * `null`, which leaves `decideGateAction` on its two-argument behaviour.
 */
function resolveDriver(projectRoot: string, payload: HookPayload): string | null {
  const callerId = payload.caller_id ?? payload.session_id;
  if (typeof callerId !== 'string' || callerId.length === 0) return null;
  if (!hasLeaseForCaller(projectRoot, callerId)) return null;
  return resolveActiveSkillForCaller(projectRoot, { callerId }).skill;
}

export function registerCodeGateCommand(program: Command, io: ProgramIO): void {
  addJsonOption(
    program
      .command('code-gate')
      .description(
        '2026-08-06-codegate-vendor-neutral: vendor-neutral PreToolUse gate. ' +
          'Reads the standard hook JSON payload from stdin and either exits 0 (allow) ' +
          'or exits 2 with stderr containing PEAKS_CODE_PROHIBITED_DIRECT_EDIT (deny). ' +
          'The gate blocks Edit/Write/MultiEdit on hard-blocked path families ' +
          '(src/, tests/unit/, tests/integration/, config/, bin/, scripts/) so the ' +
          'orchestrator is forced to dispatch via `peaks sub-agent dispatch rd`. ' +
          'Allow-listed paths (.peaks/**, skills/**, docs/**) are NOT gated.'
      )
      .option('--dry-run', 'emit JSON verdict to stdout instead of exit code; useful for tests')
      .option(
        '--project <path>',
        'project the driver lease is resolved against (default: current directory)'
      )
  ).action(async (opts: { json?: boolean; dryRun?: boolean; project?: string }) => {
    let raw = '';
    try {
      raw = await readStdin();
    } catch {
      // Empty / unreadable stdin → fail-open allow. The shell-script
      // sibling does the same.
      raw = '';
    }
    let parsed: HookPayload | null = null;
    try {
      parsed = raw.trim().length > 0 ? (JSON.parse(raw) as HookPayload) : null;
    } catch {
      // Malformed JSON → fail-open allow. Cannot decide safely.
      parsed = null;
    }

    if (parsed === null) {
      if (opts.dryRun === true) {
        printResult(
          io,
          ok(
            'code.gate',
            { action: 'allow', reason: 'empty-or-malformed-payload' },
            [],
            ['no stdin payload; allowing']
          ),
          opts.json
        );
        return;
      }
      process.exit(0);
    }

    const tool = readToolName(parsed);
    const input = readToolInput(parsed);
    const verdict = decideGateAction(
      tool,
      input,
      resolveDriver(resolveCanonicalProjectRoot(opts.project ?? process.cwd()), parsed)
    );
    if (opts.dryRun === true) {
      if (verdict.action === 'allow') {
        printResult(
          io,
          ok('code.gate', { action: 'allow', tool, filePath: extractFilePath(input) }, [], []),
          opts.json
        );
      } else {
        printResult(
          io,
          fail(
            'code.gate',
            'PEAKS_CODE_PROHIBITED_DIRECT_EDIT',
            verdict.message,
            {
              action: 'deny',
              tool,
              filePath: verdict.filePath,
              reason: verdict.reason
            },
            ['use peaks sub-agent dispatch rd']
          ),
          opts.json
        );
      }
      return;
    }

    if (verdict.action === 'deny') {
      process.stderr.write(verdict.message + '\n');
      process.exit(2);
    }
    process.exit(0);
  });
}

function readStdin(): Promise<string> {
  return new Promise<string>((resolveFn, reject) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      buf += chunk;
    });
    process.stdin.on('end', () => resolveFn(buf));
    process.stdin.on('error', (err) => reject(err));
  });
}
