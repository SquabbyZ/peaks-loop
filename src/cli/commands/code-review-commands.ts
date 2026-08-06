/**
 * peaks code-review * CLI surface — ECC bridge + OCR 1.8.x.
 */
import type { Command } from 'commander';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import { detectOcr18 } from '../../services/lint/detect-ocr-18.js';
import { OCR_18_LANGUAGES, runOcr18, type Ocr18Language } from '../../services/lint/ocr-multilang-adapter.js';

const SUPPORTED_LANGUAGES_SET = new Set<string>(OCR_18_LANGUAGES);

type DetectOptions = { json?: boolean };

type RunOcr18Options = {
  language?: string;
  from?: string;
  to?: string;
  commit?: string;
  delegate?: boolean;
  json?: boolean;
};

type DelegateOptions = { json?: boolean };

export function registerCodeReviewCommands(program: Command, io: ProgramIO): void {
  const codeReview = program
    .command('code-review', { hidden: true })
    .description('Code-review primitives for peaks-rd Gate B3. ECC bridge (JS/TS) + OCR 1.8.x multi-language.');

  addJsonOption(codeReview
    .command('detect-ocr-18')
    .description('Read-only probe: returns the 5-state OCR 1.8.x runtime envelope (ready / ocr18-missing / binary-missing / llm-config-missing / detection-failed).')
  ).action((options: DetectOptions) => {
    try {
      const result = detectOcr18();
      const envelope = result.state === 'ready'
        ? ok('code-review.detect-ocr-18', result, [...result.warnings], [...result.nextActions])
        : fail('code-review.detect-ocr-18', result.state.toUpperCase().replace(/-/g, '_'), `ocr 1.8.x is not ready: ${result.state}`, result, [...result.nextActions]);
      printResult(io, envelope, options.json);
      if (result.state !== 'ready') process.exitCode = 0; // soft-fail
    } catch (error: unknown) {
      printResult(io, fail('code-review.detect-ocr-18', 'DETECT_FAILED', getErrorMessage(error), { state: 'detection-failed' }, ['Re-run with a valid npx on PATH.']), options.json);
    }
  });

  addJsonOption(codeReview
    .command('run-ocr-18')
    .description('Invoke `ocr review --filter-language <lang>` (or `ocr delegate preview` when --delegate) for one of 8 supported languages.')
    .option('--language <lang>', `target language: ${OCR_18_LANGUAGES.join(' | ')}`)
    .option('--from <ref>', 'git ref to diff from (e.g. main)')
    .option('--to <ref>', 'git ref to diff to (e.g. HEAD)')
    .option('--commit <sha>', 'specific commit SHA to review')
    .option('--delegate', 'use Delegation Mode (no LLM key required)')
  ).action((options: RunOcr18Options) => {
    const language = options.language;
    if (language === undefined || !SUPPORTED_LANGUAGES_SET.has(language)) {
      printResult(io, fail('code-review.run-ocr-18', 'LANGUAGE_UNSUPPORTED', `unsupported language: ${language ?? '<missing>'}`, { state: 'language-unsupported', supported: OCR_18_LANGUAGES }, [`Pick one of: ${OCR_18_LANGUAGES.join(', ')}`]), options.json);
      return;
    }
    const result = runOcr18({
      cwd: process.cwd(),
      language: language as Ocr18Language,
      ...(options.from !== undefined ? { from: options.from } : {}),
      ...(options.to !== undefined ? { to: options.to } : {}),
      ...(options.commit !== undefined ? { commit: options.commit } : {}),
      ...(options.delegate === true ? { delegate: true } : {})
    });
    const envelope = result.state === 'ok'
      ? ok('code-review.run-ocr-18', result, [], [])
      : fail('code-review.run-ocr-18', result.state.toUpperCase().replace(/-/g, '_'), `ocr 1.8.x state: ${result.state}`, result, ['Re-run `peaks code-review detect-ocr-18 --json` to refresh.']);
    printResult(io, envelope, options.json);
  });

  addJsonOption(codeReview
    .command('ocr-18-delegate-preview')
    .description('Print the Delegation Mode spec for the host agent (no LLM key required).')
  ).action((options: DelegateOptions) => {
    const result = runOcr18({ cwd: process.cwd(), language: 'python', delegate: true });
    const envelope = result.state === 'ok'
      ? ok('code-review.ocr-18-delegate-preview', result, [], [])
      : fail('code-review.ocr-18-delegate-preview', result.state.toUpperCase().replace(/-/g, '_'), `ocr 1.8.x state: ${result.state}`, result, ['Re-run `peaks code-review detect-ocr-18 --json` to refresh.']);
    printResult(io, envelope, options.json);
  });
}
