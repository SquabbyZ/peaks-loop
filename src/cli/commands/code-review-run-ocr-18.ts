/**
 * `peaks code-review run-ocr-18` — the single-language and multi-language entry
 * point into the OCR 1.x bridge.
 *
 * Split out of `code-review-commands.ts` along the file-size policy's 300-line
 * cap, and along a real seam: this file owns flag precedence and envelope
 * shape, the adapter owns argv and spawning.
 */
import type { Command } from 'commander';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import { detectOcr18 } from '../../services/lint/detect-ocr-18.js';
import { runOcr18 } from '../../services/lint/ocr-multilang-adapter.js';
import { runOcr18Multi } from '../../services/lint/ocr-18-multi.js';
import {
  OCR_18_LANGUAGES,
  parseLanguageSelection
} from '../../services/lint/ocr-18-language-routing.js';

const COMMAND = 'code-review.run-ocr-18';

const SUPPORTED_LANGUAGES_SET = new Set<string>(OCR_18_LANGUAGES);

const ROUTED_LANGUAGES = OCR_18_LANGUAGES.join(', ');

/** The refusal both language flags must produce: it says which one to keep. */
const BOTH_LANGUAGE_FLAGS =
  'Pass `--language <lang>` for a single language, or `--languages auto|<csv>` for many — not both.';

type RunOcr18Options = {
  language?: string;
  languages?: string;
  from?: string;
  to?: string;
  commit?: string;
  delegate?: boolean;
  json?: boolean;
};

/** The git range the review covers; an empty object means "the workspace". */
function rangeOf(options: RunOcr18Options): { from?: string; to?: string; commit?: string } {
  return {
    ...(options.from !== undefined ? { from: options.from } : {}),
    ...(options.to !== undefined ? { to: options.to } : {}),
    ...(options.commit !== undefined ? { commit: options.commit } : {})
  };
}

function printLanguageRefusal(io: ProgramIO, options: RunOcr18Options, message: string): void {
  printResult(
    io,
    fail(COMMAND, 'LANGUAGE_FLAGS_CONFLICT', message, { state: 'language-unsupported' }, [message]),
    options.json
  );
}

function runSingle(io: ProgramIO, options: RunOcr18Options): void {
  const language = options.language;
  if (language === undefined || !SUPPORTED_LANGUAGES_SET.has(language)) {
    printResult(
      io,
      fail(
        COMMAND,
        'LANGUAGE_UNSUPPORTED',
        `unsupported language: ${language ?? '<missing>'}`,
        { state: 'language-unsupported', supported: OCR_18_LANGUAGES },
        [`Pick one of: ${ROUTED_LANGUAGES}`, 'Or use `--languages auto` to detect from the range.']
      ),
      options.json
    );
    return;
  }
  const result = runOcr18({
    cwd: process.cwd(),
    language,
    ...rangeOf(options),
    ...(options.delegate === true ? { delegate: true } : {})
  });
  const envelope =
    result.state === 'ok'
      ? ok(COMMAND, result, [], [])
      : fail(
          COMMAND,
          result.state.toUpperCase().replace(/-/g, '_'),
          `ocr 1.x state: ${result.state}`,
          result,
          ['Re-run `peaks code-review detect-ocr-18 --json` to refresh.']
        );
  printResult(io, envelope, options.json);
}

/** Parse the selector, or print the refusal and return null. */
function selectionFor(
  io: ProgramIO,
  options: RunOcr18Options,
  selector: string
): ReturnType<typeof parseLanguageSelection> | null {
  try {
    return parseLanguageSelection(selector);
  } catch (error: unknown) {
    printResult(
      io,
      fail(
        COMMAND,
        'LANGUAGE_UNSUPPORTED',
        getErrorMessage(error),
        { state: 'language-unsupported', supported: OCR_18_LANGUAGES },
        [`Pick "auto", or one of: ${ROUTED_LANGUAGES}`]
      ),
      options.json
    );
    return null;
  }
}

/** Run the one review, or print the detection failure and return null. */
function multiFor(
  io: ProgramIO,
  options: RunOcr18Options,
  selection: ReturnType<typeof parseLanguageSelection>
): ReturnType<typeof runOcr18Multi> | null {
  try {
    return runOcr18Multi({
      cwd: process.cwd(),
      ...(selection.languages !== null ? { languages: selection.languages } : {}),
      ...rangeOf(options)
    });
  } catch (error: unknown) {
    printResult(
      io,
      fail(COMMAND, 'OCR18_DETECT_FAILED', getErrorMessage(error), { state: 'detection-failed' }, [
        'The git range could not be read, so nothing was reviewed.'
      ]),
      options.json
    );
    return null;
  }
}

function printMultiResult(
  io: ProgramIO,
  options: RunOcr18Options,
  result: ReturnType<typeof runOcr18Multi>
): void {
  if (result.state === 'ok') {
    printResult(io, ok(COMMAND, result, [], []), options.json);
    return;
  }
  if (result.state === 'no-routed-language') {
    // An ok envelope, and an explicit one: nothing was reviewed, which is not
    // the same thing as a clean review.
    printResult(
      io,
      ok(
        COMMAND,
        result,
        [
          `No routed language in the range: ${result.changedFileCount} file(s) changed, ` +
            `${result.unsupportedFiles.length} not reviewable as a routed language.`,
          'Nothing was reviewed — this is not a clean review.'
        ],
        []
      ),
      options.json
    );
    return;
  }

  // Unavailable: carry the detector's own state so `binary-missing` and
  // `llm-config-missing` are not collapsed into one shape.
  const detector = detectOcr18();
  printResult(
    io,
    fail(
      COMMAND,
      result.state.toUpperCase().replace(/-/g, '_'),
      `ocr 1.x state: ${result.state}`,
      {
        ...result,
        detector: {
          state: detector.state,
          package: detector.package,
          warnings: detector.warnings
        }
      },
      [...detector.nextActions, 'Nothing was reviewed — this is not a clean review.']
    ),
    options.json
  );
}

function runMulti(io: ProgramIO, selector: string, options: RunOcr18Options): void {
  if (options.delegate === true) {
    printLanguageRefusal(
      io,
      options,
      '`--delegate` is not language-scoped — `ocr delegate preview` ignores `--languages`. Pass `--delegate --language <lang>` or `--languages` alone.'
    );
    return;
  }
  const selection = selectionFor(io, options, selector);
  if (selection === null) return;
  const result = multiFor(io, options, selection);
  if (result !== null) printMultiResult(io, options, result);
}

export function registerRunOcr18Command(codeReview: Command, io: ProgramIO): void {
  addJsonOption(
    codeReview
      .command('run-ocr-18')
      .description(
        'Invoke `ocr review` once over the requested git range (or `ocr delegate preview` when --delegate); findings are attributed to a language by file extension after the review.'
      )
      .option('--language <lang>', 'single target language, e.g. python | go | typescript | java')
      .option(
        '--languages <selector>',
        'auto (detect from the range) or a comma-separated list, e.g. ts,js,go'
      )
      .option('--from <ref>', 'git ref to diff from (e.g. main)')
      .option('--to <ref>', 'git ref to diff to (e.g. HEAD)')
      .option('--commit <sha>', 'specific commit SHA to review')
      .option('--delegate', 'use Delegation Mode (no LLM key required)')
  ).action((options: RunOcr18Options) => {
    if (options.language !== undefined && options.languages !== undefined) {
      printLanguageRefusal(io, options, BOTH_LANGUAGE_FLAGS);
      return;
    }
    if (options.languages !== undefined) {
      runMulti(io, options.languages, options);
      return;
    }
    runSingle(io, options);
  });
}
