/**
 * `peaks runtime *` — vendor-runtime detection + compact CLI surface.
 *
 * Slice S2-a of RD-2 (2026-07-08 session). Three subcommands:
 *
 *   detect    — print which vendor is the active AI runtime
 *               (claude-code / codex / copilot / unknown).
 *   list      — list the built-in vendor adapters registered by
 *               RuntimeService (Claude Code / Codex / Copilot).
 *   compact   — Task 1.7 (design §13.1 row 5) retired the
 *               adapter-vendor `compact` dispatch. Pre-1.7 this
 *               command could `child_process.spawn` an adapter-
 *               declared `compactCommand` (e.g. `claude --compact`)
 *               and return `ok: true` on spawn. That was a
 *               false-success shape: spawn is not proof of
 *               completion. The handler now returns an explicit
 *               deprecation envelope with the capability-first
 *               next action (`peaks compact auto`). The legacy
 *               adapter registry and RuntimeService paths are
 *               preserved (so `peaks runtime detect` / `list`
 *               remain useful) but `peaks runtime compact` never
 *               exits 0.
 */
import type { Command } from 'commander';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, getErrorMessage, ok } from 'peaks-loop-shared/result';

import { detectRuntime } from '../../services/runtime/runtime-detector.js';
import { RuntimeService } from '../../services/runtime/runtime-service.js';

export interface RuntimeDetectOptions {
  json?: boolean;
}

export interface RuntimeListOptions {
  json?: boolean;
}

export interface RuntimeCompactOptions {
  json?: boolean;
  /** Vendor adapter id (built-in or registered). */
  via?: string;
  force?: boolean;
  /** Override the project root (defaults to .peaks runtime lookup). */
  project?: string;
}

function resolveProjectRoot(explicit: string | undefined): string {
  if (explicit !== undefined && explicit.length > 0) return explicit;
  return process.cwd();
}

export function registerRuntimeCommands(program: Command, io: ProgramIO): void {
  const runtime = program
    .command('runtime')
    .description('Vendor runtime detection + compact via adapter (--via <vendor-id>)');

  // -----------------------------------------------------------------
  // 1. peaks runtime detect [--json]
  // -----------------------------------------------------------------
  addJsonOption(
    runtime
      .command('detect')
      .description('Print the active AI runtime vendor (claude-code / codex / copilot / unknown)')
  ).action((options: RuntimeDetectOptions) => {
    try {
      const result = detectRuntime();
      printResult(io, ok('runtime.detect', result, [], [
        result.vendor === 'unknown'
          ? 'No vendor sentinel detected. Use `peaks adapter register --id <vendor> --binary <cmd>` to wire a custom one.'
          : `Run \`peaks compact auto --project <repo> --json\` to invoke the capability-first control plane.`
      ]), options.json);
    } catch (error) {
      printResult(io, fail('runtime.detect', 'RUNTIME_DETECT_FAILED', getErrorMessage(error), {}, ['Retry with a clean env']), options.json);
      process.exitCode = 1;
    }
  });

  // -----------------------------------------------------------------
  // 2. peaks runtime list [--json]
  // -----------------------------------------------------------------
  addJsonOption(
    runtime
      .command('list')
      .description('List the built-in vendor adapters registered by RuntimeService')
  ).action((options: RuntimeListOptions) => {
    try {
      const svc = new RuntimeService();
      const adapters = svc.listBuiltInAdapters().map((a) => ({ id: a.id, displayName: a.displayName }));
      printResult(io, ok('runtime.list', { builtIn: adapters }, [], [
        `Run \`peaks adapter register --id <vendor> --binary <cmd>\` to add a custom adapter (persists to .peaks/runtime/adapters.json).`
      ]), options.json);
    } catch (error) {
      printResult(io, fail('runtime.list', 'RUNTIME_LIST_FAILED', getErrorMessage(error), {}, []), options.json);
      process.exitCode = 1;
    }
  });

  // -----------------------------------------------------------------
  // 3. peaks runtime compact [--via <id>] [--force] [--json] [--project <root>]
  // -----------------------------------------------------------------
  // Task 1.7 (design §13.1 row 5): the legacy adapter-vendor
  // dispatch is retired. The verb remains so callers get an
  // explicit deprecation envelope with the capability-first
  // next action, instead of a fabricated `ok: true` from a
  // child_process.spawn return value.
  addJsonOption(
    runtime
      .command('compact')
      .description(
        'RETIRED by Task 1.7 (design §13.1). Returns an explicit deprecation ' +
          'envelope; the next step is the capability-first control plane ' +
          '(`peaks compact auto --project <repo> --session-id <sid> --json`).'
      )
      .option('--via <id>', '(ignored) — vendor adapter id; pre-1.7 dispatch path is retired')
      .option('--force', '(ignored) — pre-1.7 spawn flag; retired')
      .option('--project <path>', 'project root (defaults to cwd)')
  ).action((options: RuntimeCompactOptions) => {
    try {
      const projectRoot = resolveProjectRoot(options.project);
      const requested = options.via;
      const detected = requested !== undefined && requested.length > 0
        ? { vendor: requested, source: 'flag' as const }
        : detectRuntime();
      printResult(
        io,
        fail(
          'runtime.compact',
          'RUNTIME_COMPACT_RETIRED',
          'Task 1.7 (design §13.1) retired the adapter-vendor compact ' +
            'dispatch: a child_process.spawn return value is not proof ' +
            'of compact completion. The next step is the capability-first ' +
            'control plane.',
          { projectRoot, via: requested ?? null, detected },
          [
            'peaks compact auto --project <repo> --session-id <sid> --json',
            'peaks compact status --project <repo> --session-id <sid> --json',
            'peaks compact capabilities --project <repo> --json'
          ]
        ),
        options.json
      );
      process.exitCode = 1;
    } catch (error) {
      printResult(io, fail('runtime.compact', 'RUNTIME_COMPACT_FAILED', getErrorMessage(error), {}, [
        'peaks compact auto --project <repo> --session-id <sid> --json'
      ]), options.json);
      process.exitCode = 1;
    }
  });
}