/**
 * peaks ide * CLI (Slice 2026-07-09 add-zcode-adapter, Slice C).
 *
 * Slice C adds ONE verb:
 *
 *   peaks ide model --current
 *
 * Outputs the currently-active model id detected from the host
 * environment (so far: only the `zcode` adapter opts in via
 * `IdeAdapter.detectCurrentModel?`). The CLI is the read-only
 * debugging surface for runtime model probing. It does NOT set any
 * state — `peaks config set model` remains the canonical write path.
 *
 * Future slices will extend this surface with `peaks ide list`,
 * `peaks ide detect`, etc. — this slice keeps the surface minimal
 * (per Karpathy guideline #2 — Simplicity First).
 *
 * Vendor-neutrality: this file delegates to
 * `src/services/ide/current-model-detector.ts` which walks every
 * registered adapter. This file does NOT import any specific
 * adapter.
 */
import { Command } from 'commander';
import { detectCurrentIdeModel } from '../../services/ide/current-model-detector.js';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from '../../shared/result.js';
import { listAdapterIds } from '../../services/ide/ide-registry.js';

type IdeModelOptions = {
  current?: boolean;
  json?: boolean;
};

export function registerIdeCommands(program: Command, io: ProgramIO): void {
  const ide = program.command('ide').description('Read-only introspection helpers for the registered IDE adapter layer (slice 2026-07-09 add-zcode-adapter, Slice C)');

  addJsonOption(
    ide
      .command('model')
      .description('Inspect the IDE adapter model surface. Slice C supports `--current` only.')
      .option('--current', 'Print the model id the active IDE adapter reports as currently configured')
      .action(async (options: IdeModelOptions) => {
        if (options.current) {
          await runIdeModelCurrent(io, options);
          return;
        }
        // No verb supplied — Commander would normally show help; we
        // emit a structured error instead so the JSON envelope stays
        // consistent for LLM callers.
        printResult(
          io,
          fail(
            'ide.model',
            'MISSING_VERB',
            'Specify a verb: --current. Future slices may add --configured / --default.',
            { registeredAdapters: listAdapterIds() },
            ['Rerun with --current to read the runtime-detected model id.']
          ),
          options.json
        );
      })
  );
}

async function runIdeModelCurrent(io: ProgramIO, options: IdeModelOptions): Promise<void> {
  try {
    const modelId = await detectCurrentIdeModel();
    if (modelId === undefined) {
      printResult(
        io,
        ok('ide.model.current', {
          modelId: null,
          detected: false,
          registeredAdapters: listAdapterIds(),
        }),
        options.json
      );
      return;
    }
    printResult(
      io,
      ok('ide.model.current', {
        modelId,
        detected: true,
        registeredAdapters: listAdapterIds(),
      }),
      options.json
    );
  } catch (error) {
    printResult(
      io,
      fail(
        'ide.model.current',
        'DETECTION_FAILED',
        'Runtime model detection failed; falling back to configured model. See logs.',
        { error: error instanceof Error ? error.message : String(error) },
        ['Check `PEAKS_LOG_LEVEL=debug peaks ide model --current` for the underlying error.']
      ),
      options.json
    );
  }
}
