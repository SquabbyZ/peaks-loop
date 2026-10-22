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
import { resolve } from 'node:path';

import { type ProgramIO, addJsonOption, printResult } from '../cli-helpers.js';
import {
  decideGateAction,
  extractFilePath,
  isGatedTool,
  type GateToolName,
  type GateVerdict
} from '../../services/hooks/pre-tool-code-gate.js';
import { resolveToolCallBaseDir } from '../../services/hooks/hook-payload-cwd.js';
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

/**
 * The directory the tool call runs in: the payload's own `cwd` when it names
 * a usable one, and the gate process's own working directory otherwise — the
 * directory the harness ran the hook in. Neither source is guessed: the
 * payload is read at its top level, and the process's own directory is a fact
 * about this process.
 */
function resolveToolCallDir(payload: HookPayload, projectRoot: string): string {
  return resolveToolCallBaseDir(payload, projectRoot, process.cwd());
}

/**
 * The marker the gate leaves on stderr when it could not decide.
 *
 * The gate fails OPEN on a payload it cannot read, and that is deliberate: a
 * blocked edit on every call would be worse than an allowed one. But a silent
 * allow is invisible, and the failure it hides is the expensive kind — an
 * acceptance that feeds the payload through a pipe (which some shells do not
 * forward to the process at all) then "passes" every case while proving
 * nothing. So the case says so, on the channel the harness already reads.
 */
export const UNDECIDABLE_MARKER = 'PEAKS_CODE_GATE_UNDECIDABLE';

/**
 * How to feed the payload so that it arrives. A pipeline is not a delivery
 * mechanism on every shell — a PowerShell pipeline to a native executable
 * does not forward stdin at all — and then the gate reads no payload, allows
 * everything, and the check passes vacuously.
 */
export const PAYLOAD_DELIVERY_RECIPE =
  'feed the payload by FILE REDIRECTION (cmd /c "peaks code-gate < payload.json"), not through a pipe: ' +
  'a shell pipeline does not always forward stdin to the process, and then every case is allowed and the check proves nothing.';

/** Say, on stderr, that the gate could not decide — and still allow. */
function reportUndecidable(reason: string): void {
  process.stderr.write(`${UNDECIDABLE_MARKER}: ${reason}; allowing. ${PAYLOAD_DELIVERY_RECIPE}\n`);
}

/**
 * The reason this payload cannot be judged, or `null` when it can.
 *
 * A payload that names a gated tool but no target path is the same "cannot
 * decide" the empty payload is: there is no file to match against a family.
 */
function undecidableReason(
  tool: GateToolName,
  input: Readonly<Record<string, unknown>>
): string | null {
  if (!isGatedTool(tool)) return null;
  if (extractFilePath(input).length > 0) return null;
  return 'the payload names a gated tool but no target path';
}

/** The payload as bytes, or `''` when stdin could not be read. */
async function readPayload(): Promise<string> {
  try {
    return await readStdin();
  } catch {
    // Empty / unreadable stdin → fail-open allow. The shell-script
    // sibling does the same.
    return '';
  }
}

/** The payload as an object, or `null` when it is empty or malformed. */
function parsePayload(raw: string): HookPayload | null {
  if (raw.trim().length === 0) return null;
  let parsed: HookPayload | null = null;
  try {
    parsed = JSON.parse(raw) as HookPayload;
  } catch {
    // Malformed JSON → fail-open allow. Cannot decide safely.
    parsed = null;
  }
  return parsed;
}

/** The verdict envelope, in the shape the `--dry-run` mode prints. */
function printDryRunVerdict(
  io: ProgramIO,
  asJson: boolean,
  context: {
    readonly tool: GateToolName;
    readonly input: Readonly<Record<string, unknown>>;
    readonly verdict: GateVerdict;
    readonly undecidable: string | null;
  }
): void {
  const { tool, input, verdict, undecidable } = context;
  if (verdict.action === 'allow') {
    printResult(
      io,
      ok(
        'code.gate',
        { action: 'allow', tool, filePath: extractFilePath(input) },
        [],
        undecidable === null ? [] : [PAYLOAD_DELIVERY_RECIPE]
      ),
      asJson
    );
    return;
  }
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
    asJson
  );
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
          'Allow-listed paths (.peaks/**, skills/**, docs/**) are NOT gated. ' +
          'A payload the gate cannot read is ALLOWED (fail-open) and says so on ' +
          'stderr with PEAKS_CODE_GATE_UNDECIDABLE — ' +
          'feed the payload by FILE REDIRECTION, not through a pipe.'
      )
      .option('--dry-run', 'emit JSON verdict to stdout instead of exit code; useful for tests')
      .option(
        '--project <path>',
        'project the driver lease is resolved against (default: current directory)'
      )
  ).action(async (opts: { json?: boolean; dryRun?: boolean; project?: string }) => {
    const parsed = parsePayload(await readPayload());

    if (parsed === null) {
      reportUndecidable('no stdin payload');
      if (opts.dryRun === true) {
        printResult(
          io,
          ok(
            'code.gate',
            { action: 'allow', reason: 'empty-or-malformed-payload' },
            [],
            ['no stdin payload; allowing', PAYLOAD_DELIVERY_RECIPE]
          ),
          opts.json
        );
        return;
      }
      process.exit(0);
    }

    const tool = readToolName(parsed);
    const input = readToolInput(parsed);
    const undecidable = undecidableReason(tool, input);
    if (undecidable !== null) {
      reportUndecidable(undecidable);
    }
    // TWO roots, because two questions ask for one. The CANONICAL root is
    // where the session and the leases live, so the caller is placed against
    // it. The NAMED root is the project the caller named, and it is what the
    // deny families are relative to: a project nested inside a git repository
    // is judged against ITSELF, not against the git root above it. One file
    // must not get two verdicts from two spellings, and a project that is not
    // the git root is exactly where the two would differ.
    // The tool call's OWN directory is a third fact: it is the base a
    // relative path is read against.
    const namedRoot = resolve(opts.project ?? process.cwd());
    const canonicalRoot = resolveCanonicalProjectRoot(namedRoot);
    const driver = resolveDriver(canonicalRoot, parsed);
    const toolCwd = resolveToolCallDir(parsed, namedRoot);
    const verdict = decideGateAction(tool, input, driver, { projectRoot: namedRoot, toolCwd });
    if (opts.dryRun === true) {
      printDryRunVerdict(io, opts.json === true, { tool, input, verdict, undecidable });
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
