/**
 * Phase B Task 20: peaks vendor-detect CLI.
 * Reports which vendor CLIs are installed on PATH + recommends default.
 * Spec: docs/superpowers/specs/2026-08-10-peaks-detached-sub-agent-design.md §3.3
 */
import type { Command } from 'commander';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { ok } from 'peaks-loop-shared/result';
import { defaultRegistry } from 'peaks-loop-internal-runtime';

export async function vendorDetect(opts: { json: boolean }) {
  const reg = defaultRegistry();
  const list = reg.list();
  const installed: string[] = [];
  for (const a of list) if (await a.detectInstalled()) installed.push(a.id);
  const recommended = installed[0] ?? null;
  return { ok: true, command: 'vendor-detect', data: { installed, recommended } };
}

/**
 * `peaks vendor-detect` CLI registration (rid-001 redo).
 * Slice 2026-08-11 detached-sub-agent-design §3.3 + §5.3 — register the
 * previously-dead-coded `vendorDetect()` handler at the top-level program
 * surface so `peaks vendor-detect --json` actually reaches it (was
 * dead-coded at the CLI seam even though the handler existed).
 */
export function registerVendorDetectCommand(program: Command, io: ProgramIO): void {
  addJsonOption(
    program
      .command('vendor-detect')
      .description(
        'Detect which vendor CLIs (claude / codex / copilot) are installed ' +
        'on PATH and recommend a default for --mode detached dispatch. ' +
        'Returns `{ installed: string[], recommended: <id|null> }`.'
      )
  ).action(async (options: { json: boolean }) => {
    const result = await vendorDetect({ json: options.json === true });
    printResult(io, ok('vendor-detect', result.data, [], [
      'Pass the recommended vendor id to `peaks sub-agent dispatch --mode detached --vendor <id>`.',
      'Re-run with --json to machine-parse.'
    ]), options.json === true);
  });
}
