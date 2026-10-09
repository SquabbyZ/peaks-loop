/**
 * peaks loop * CLI (Slice #14 + M7 add).
 *
 *   #14 sub-features (L4 Agent Loop integration): distill / preflight /
 *     detect-pattern / check-consistency, plus `peaks goal compose`.
 *
 *   M7 (2026-07-07 spec §7A.2): `peaks loop export --loop <id> --out <p.tar.gz>`
 *     and `peaks loop import --in <p.tar.gz> [--as <loop-id>]`. `export` reads
 *     the loop_release + relations + bees + evidence briefs and hard-blocks on
 *     `shareable=false`; `import` validates `format_version_major=1` and lands
 *     the release as `candidate` (spec §7A.2) — the receiver must run an
 *     independent evaluation before promoting to `stable`. M7 only ADDs these
 *     two verbs; the existing 14.x surface is not modified.
 *
 * This module owns the `loop` parent, the registrar order, and `distill` — the
 * one verb that spawns a child process, kept here so the `node:child_process`
 * import stays on the module `tests/unit/spawn-windows-hide-guard.test.ts`
 * pins it to. Every other verb lives beside this file, one module per verb.
 */

import type { Command } from 'commander';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import type { LoopDistillOptions } from './loop-command-shared.js';
import { registerLoopExportCommand } from './loop-export-command.js';
import { registerLoopGoalComposeCommand } from './loop-goal-compose-command.js';
import { registerLoopImportCommand } from './loop-import-command.js';
import { registerLoopPlaceholderCommands } from './loop-placeholder-commands.js';

export function registerLoopCommands(program: Command, io: ProgramIO): void {
  // 14.5 peaks goal compose — a TOP-LEVEL command (not under `peaks loop`),
  // because IDE adapters expose it as `goalCommand`.
  registerLoopGoalComposeCommand(program, io);

  const loop = program
    .command('loop')
    .description(
      'Slice #14: L4 Agent Loop sub-features (distill / preflight / detect-pattern / check-consistency)'
    );

  registerLoopDistillCommand(loop, io);
  registerLoopPlaceholderCommands(loop, io);
  registerLoopExportCommand(loop, io);
  registerLoopImportCommand(loop, io);
}

/**
 * 14.1 distill — delegate to `peaks memory extract` through a dynamic
 * `node:child_process` import (no static import, so the command layer does not
 * load `child_process` for verbs that never spawn). The LLM-side UX layer
 * composes the two commands.
 */
function registerLoopDistillCommand(loop: Command, io: ProgramIO): void {
  addJsonOption(
    loop
      .command('distill')
      .description(
        '14.1: distill patterns from past sessions into .peaks/memory/ (delegates to peaks memory extract)'
      )
      .requiredOption('--project <path>', 'target project root')
      .option(
        '--apply',
        'write extracted memories to .peaks/memory/ (default: dry-run preview)',
        false
      )
  ).action(async (options: LoopDistillOptions) => {
    try {
      printResult(
        io,
        ok(
          'loop.distill',
          await extractMemoryViaDelegate(options),
          [],
          distillNextActions(options)
        ),
        options.json
      );
    } catch (error) {
      printResult(
        io,
        fail(
          'loop.distill',
          'LOOP_DISTILL_FAILED',
          getErrorMessage(error),
          { project: options.project },
          ['Verify the project path']
        ),
        options.json
      );
      process.exitCode = 1;
    }
  });
}

/** Spawn `peaks memory extract` and report the first 200 bytes of its stdout. */
async function extractMemoryViaDelegate(
  options: LoopDistillOptions
): Promise<Record<string, unknown>> {
  const apply = options.apply === true;
  const { execFileSync } =
    (await import('node:child_process')) as typeof import('node:child_process');
  const args = ['memory', 'extract', '--project', options.project];
  if (apply) args.push('--apply');
  const stdout = execFileSync('node', ['bin/peaks.js', ...args], {
    cwd: options.project,
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true
  }).toString('utf-8');
  return { project: options.project, apply, delegateStdout: stdout.slice(0, 200) };
}

/** The two sentences `loop.distill` tells the caller about what it just ran. */
function distillNextActions(options: LoopDistillOptions): string[] {
  return [
    options.apply === true
      ? 'peaks memory extract --apply was invoked'
      : 'peaks memory extract dry-run was invoked',
    'A future slice will inline the memory extract (not via execFileSync).'
  ];
}
