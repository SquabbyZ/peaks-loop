/**
 * Code-review command shells. ECC remains the JS/TS review path; OCR 1.8
 * commands are registered now and implemented by the later adapter slice.
 */
import type { Command } from 'commander';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { ok } from 'peaks-loop-shared/result';

const NOT_IMPLEMENTED = { state: 'not-yet-implemented' as const };

export function registerCodeReviewCommands(program: Command, io: ProgramIO): void {
  const codeReview = program
    .command('code-review', { hidden: true })
    .description('Code-review primitives for peaks-rd Gate B3.');

  addJsonOption(codeReview.command('detect-ecc'))
    .action((options: { json?: boolean }) => {
      printResult(io, ok('code-review.detect-ecc', NOT_IMPLEMENTED), options.json);
    });

  addJsonOption(codeReview.command('run-ecc'))
    .action((options: { json?: boolean }) => {
      printResult(io, ok('code-review.run-ecc', NOT_IMPLEMENTED), options.json);
    });

  addJsonOption(codeReview.command('detect-ocr-18'))
    .action((options: { json?: boolean }) => {
      printResult(io, ok('code-review.detect-ocr-18', NOT_IMPLEMENTED), options.json);
    });

  addJsonOption(codeReview.command('run-ocr-18'))
    .action((options: { json?: boolean }) => {
      printResult(io, ok('code-review.run-ocr-18', NOT_IMPLEMENTED), options.json);
    });

  addJsonOption(codeReview.command('ocr-18-delegate-preview'))
    .action((options: { json?: boolean }) => {
      printResult(io, ok('code-review.ocr-18-delegate-preview', NOT_IMPLEMENTED), options.json);
    });
}
