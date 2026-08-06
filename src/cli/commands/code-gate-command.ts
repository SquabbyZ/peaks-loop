/**
 * Slice 2026-08-06-codegate-vendor-neutral — `peaks code-gate` CLI command.
 *
 * Vendor-neutral PreToolUse hook entry. Reads the standard hook JSON
 * payload from stdin (`{tool, input}` shape) and either exits 0
 * (allow) or exits 2 with stderr containing
 * PEAKS_CODE_PROHIBITED_DIRECT_EDIT (deny).
 *
 * This command is the runtime adapter for the shell-script sibling
 * (`src/services/hooks/pre-tool-code-gate.sh`). Both share the same
 * path-family decision; the CLI invokes the same pure decision
 * function (`decideGateAction`) the shell script encodes.
 *
 * Settings.json entry shape (vendor-neutral, registered by
 * `peaks hooks install`):
 *   { matcher: "Edit|Write|MultiEdit", hooks: [{ type: "command", command: "peaks code-gate --json" }] }
 *
 * The vendor-specific install code (`src/cli/commands/hooks-commands.ts`
 * + `src/services/ide/adapters/*`) is the only place that knows how
 * to render this into any IDE's settings.json shape. This file is
 * vendor-neutral — no vendor references in the source code itself.
 */

import type { Command } from 'commander';

import type { ProgramIO } from '../cli-helpers.js';
import { addJsonOption, printResult } from '../cli-helpers.js';
import { decideGateAction, extractFilePath, type GateInput } from '../../services/hooks/pre-tool-code-gate.js';
import { fail, ok } from 'peaks-loop-shared/result';

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
  ).action(async (opts: { json?: boolean; dryRun?: boolean }) => {
    let raw = '';
    try {
      raw = await readStdin();
    } catch {
      // Empty / unreadable stdin → fail-open allow. The shell-script
      // sibling does the same.
      raw = '';
    }
    let parsed: GateInput | null = null;
    try {
      parsed = raw.trim().length > 0 ? (JSON.parse(raw) as GateInput) : null;
    } catch {
      // Malformed JSON → fail-open allow. Cannot decide safely.
      parsed = null;
    }

    if (parsed === null) {
      if (opts.dryRun === true) {
        printResult(
          io,
          ok('code.gate', { action: 'allow', reason: 'empty-or-malformed-payload' }, [], ['no stdin payload; allowing']),
          opts.json
        );
        return;
      }
      process.exit(0);
    }

    const verdict = decideGateAction(parsed.tool, parsed.input ?? {});
    if (opts.dryRun === true) {
      if (verdict.action === 'allow') {
        printResult(io, ok('code.gate', { action: 'allow', tool: parsed.tool, filePath: extractFilePath(parsed.input ?? {}) }, [], []), opts.json);
      } else {
        printResult(io, fail('code.gate', 'PEAKS_CODE_PROHIBITED_DIRECT_EDIT', verdict.message, { action: 'deny', tool: parsed.tool, filePath: verdict.filePath, reason: verdict.reason }, ['use peaks sub-agent dispatch rd']), opts.json);
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
    process.stdin.on('data', (chunk) => { buf += chunk; });
    process.stdin.on('end', () => resolveFn(buf));
    process.stdin.on('error', (err) => reject(err));
  });
}