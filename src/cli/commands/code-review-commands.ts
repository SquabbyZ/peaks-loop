/**
 * peaks code-review * CLI surface — ECC bridge + OCR 1.x.
 */
import type { Command } from 'commander';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import { detectOcr18 } from '../../services/lint/detect-ocr-18.js';
import { acquireOcr18 } from '../../services/lint/ocr-18-acquire.js';
import { OCR_18_PACKAGE } from '../../services/lint/ocr-multilang-adapter.js';
import { runDelegatePreview } from '../../services/lint/ocr-18-delegate-payload.js';
import { registerRunOcr18Command } from './code-review-run-ocr-18.js';
import { registerOcrDelegateRecordCommand } from './code-review-ocr-delegate-record.js';

type DetectOptions = { json?: boolean };

type AcquireOptions = { json?: boolean };

/** What a caller can do when the acquisition did not land the package. */
const ACQUIRE_RETRY_ACTION =
  'Re-run `peaks code-review acquire-ocr-18` once the network is available.';

type DelegateOptions = { json?: boolean };

export function registerCodeReviewCommands(program: Command, io: ProgramIO): void {
  const codeReview = program
    .command('code-review', { hidden: true })
    .description(
      'Code-review primitives for peaks-rd Gate B3. ECC bridge (JS/TS) + OCR 1.x multi-language.'
    );

  registerRunOcr18Command(codeReview, io);

  addJsonOption(
    codeReview
      .command('detect-ocr-18')
      .description(
        'Read-only probe: returns the 5-state OCR 1.x runtime envelope (ready / ocr18-missing / binary-missing / llm-config-missing / detection-failed).'
      )
  ).action((options: DetectOptions) => {
    try {
      const result = detectOcr18();
      const envelope =
        result.state === 'ready'
          ? ok('code-review.detect-ocr-18', result, [...result.warnings], [...result.nextActions])
          : fail(
              'code-review.detect-ocr-18',
              result.state.toUpperCase().replace(/-/g, '_'),
              `ocr 1.x is not ready: ${result.state}`,
              result,
              [...result.nextActions]
            );
      printResult(io, envelope, options.json);
      if (result.state !== 'ready') process.exitCode = 0; // soft-fail
    } catch (error: unknown) {
      printResult(
        io,
        fail(
          'code-review.detect-ocr-18',
          'DETECT_FAILED',
          getErrorMessage(error),
          { state: 'detection-failed' },
          ['Re-run with a valid npx on PATH.']
        ),
        options.json
      );
    }
  });

  addJsonOption(
    codeReview
      .command('acquire-ocr-18')
      .description(
        'Acquire the OCR 1.x reviewer: runs the pinned npx package VISIBLY (npm progress on the ' +
          'terminal) and installs it once when it is not already cached. The companion to the read-only ' +
          '`detect-ocr-18` probe, which never installs.'
      )
  ).action(async (options: AcquireOptions) => {
    const command = 'code-review.acquire-ocr-18';
    try {
      // R6's other half, mirrored from `peaks web install`: "nothing to fetch"
      // is the only reason not to fetch, so an acquisition with nothing to do
      // says so without spawning anything.
      const before = detectOcr18();
      if (before.state === 'ready') {
        printResult(
          io,
          ok(
            command,
            {
              acquired: false,
              state: before.state,
              package: before.package,
              shell: null,
              shellNote: null
            },
            [],
            []
          ),
          options.json
        );
        return;
      }

      // `asJson` is threaded in so the installer cannot write its stdout into
      // the envelope this verb prints to the same stream.
      const outcome = await acquireOcr18({ asJson: options.json === true });
      if (!outcome.ok) {
        printResult(
          io,
          fail(
            command,
            outcome.code,
            outcome.message,
            { state: 'acquire-failed', shell: outcome.shell.kind, shellNote: outcome.shell.note },
            [ACQUIRE_RETRY_ACTION]
          ),
          options.json
        );
        process.exitCode = 1;
        return;
      }

      // R7, mirrored: an installer that exits 0 without landing the package is
      // CONSULTED, not assumed — a proxy filtering the registry, or `npx`
      // resolving into a different cache root, both exit 0.
      const after = detectOcr18();
      if (after.state !== 'ready') {
        printResult(
          io,
          fail(
            command,
            'OCR18_ACQUIRE_INCOMPLETE',
            `the acquisition exited 0 but ${OCR_18_PACKAGE} still does not resolve (${after.state})`,
            { state: after.state, shell: outcome.shell.kind, shellNote: outcome.shell.note },
            [...after.nextActions]
          ),
          options.json
        );
        process.exitCode = 1;
        return;
      }

      printResult(
        io,
        ok(
          command,
          {
            acquired: true,
            state: after.state,
            package: after.package,
            shell: outcome.shell.kind,
            shellNote: outcome.shell.note,
            durationMs: outcome.durationMs
          },
          [...outcome.warnings]
        ),
        options.json
      );
    } catch (error: unknown) {
      printResult(
        io,
        fail(command, 'OCR18_ACQUIRE_FAILED', getErrorMessage(error), { state: 'acquire-failed' }, [
          ACQUIRE_RETRY_ACTION
        ]),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    codeReview
      .command('ocr-18-delegate-preview')
      .description(
        'Print the file selection `ocr delegate preview` returns (no LLM key required). A ' +
          'SELECTION preview, not a review: use `run-ocr-18 --delegate --rid <rid>` for the ' +
          'packet the host agent reviews, then `ocr-delegate-record`.'
      )
  ).action((options: DelegateOptions) => {
    // No language: `ocr delegate preview` takes none, and the language used to
    // be passed here as a value delegate mode discarded.
    const result = runDelegatePreview(process.cwd());
    if (!result.ok) {
      printResult(
        io,
        fail(
          'code-review.ocr-18-delegate-preview',
          result.state.toUpperCase().replace(/-/g, '_'),
          `ocr 1.x state: ${result.state}`,
          { state: result.state, rawOutput: result.rawOutput },
          ['Re-run `peaks code-review detect-ocr-18 --json` to refresh.']
        ),
        options.json
      );
      return;
    }
    printResult(
      io,
      ok(
        'code-review.ocr-18-delegate-preview',
        result.preview,
        [],
        [
          'This is a selection preview — no review ran.',
          'For a review: `peaks code-review run-ocr-18 --delegate --rid <rid> --json`, then record the findings.'
        ]
      ),
      options.json
    );
  });

  registerOcrDelegateRecordCommand(codeReview, io);
}
