/**
 * peaks code-review * CLI surface — soft-optional ocr integration
 * for peaks-rd Gate B3.
 *
 * Per the "skill-first / CLI-auxiliary" tenet, peaks-rd SKILL.md
 * is the primary surface; this CLI returns structured JSON the
 * skill consumes to produce a second-opinion code review.
 *
 * Subcommands:
 *   - `peaks code-review detect-ocr` — JSON envelope describing the
 *     current ocr install + config state (5 reasons: ready /
 *     package-missing / binary-missing / config-missing /
 *     detection-failed).
 *   - `peaks code-review run-ocr [--from --to --commit]` — invokes
 *     `ocr review --format json` and wraps the result in a peaks
 *     ResultEnvelope. Soft-fails when ocr isn't ready so peaks-rd
 *     can continue without the second-opinion review.
 */
import { homedir } from 'node:os';
import { Command } from 'commander';
import { detectOcr, runOcrReview } from '../../services/code-review/ocr-service.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from '../../shared/result.js';

type DetectOcrOptions = {
  project?: string;
  json?: boolean;
};

type RunOcrOptions = {
  project?: string;
  from?: string;
  to?: string;
  commit?: string;
  json?: boolean;
};

export function registerCodeReviewCommands(program: Command, io: ProgramIO): void {
  const codeReview = program
    .command('code-review')
    .description(
      'Code-review primitives for peaks-rd Gate B3. Wraps the soft-optional `@alibaba-group/open-code-review` (ocr) tool when it is installed + configured; peaks-rd uses the structured JSON output as a second-opinion review alongside its own LLM review. ocr ships as a peaks-cli optionalDependency.'
    );

  addJsonOption(
    codeReview
      .command('detect-ocr')
      .description(
        'Read-only probe: returns the ocr install + config state as a JSON envelope (5 reasons: ready / package-missing / binary-missing / config-missing / detection-failed). peaks-rd calls this first to decide whether to invoke `run-ocr`.'
      )
      .option('--project <path>', 'project root (default: cwd)')
  ).action((options: DetectOcrOptions) => {
    const projectRoot = options.project ?? process.cwd();
    try {
      const detect = detectOcr({ cwd: projectRoot, homeDir: homedir() });
      const envelope = detect.state === 'ready'
        ? ok('code-review.detect-ocr', detect, [...detect.warnings], [...detect.nextActions])
        : fail('code-review.detect-ocr', detect.state.toUpperCase().replace(/-/g, '_'), `ocr is not ready: ${detect.state}`, detect, [...detect.nextActions]);
      printResult(io, envelope, options.json);
      if (detect.state !== 'ready') {
        process.exitCode = 1;
      }
    } catch (error: unknown) {
      printResult(
        io,
        fail(
          'code-review.detect-ocr',
          'DETECT_OCR_FAILED',
          getErrorMessage(error),
          { state: 'detection-failed', packageInstalled: false, binaryPath: null, version: null, configPath: '', configValid: false },
          ['Re-run with `--project <path>` pointing at a known-good project root.']
        ),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    codeReview
      .command('run-ocr')
      .description(
        'Run `ocr review --format json` and return the parsed JSON envelope. Soft-fails (exit 0, ok=false) when ocr is not ready, so peaks-rd can continue without the second-opinion review and surface the install/config nextActions to the user.'
      )
      .option('--project <path>', 'project root (default: cwd)')
      .option('--from <ref>', 'git ref to diff from (e.g. main, origin/main)')
      .option('--to <ref>', 'git ref to diff to (e.g. HEAD, feature-branch)')
      .option('--commit <sha>', 'specific commit SHA to review')
  ).action((options: RunOcrOptions) => {
    const projectRoot = options.project ?? process.cwd();
    try {
      const result = runOcrReview({
        cwd: projectRoot,
        homeDir: homedir(),
        input: { projectRoot, ...(options.from !== undefined && { from: options.from }), ...(options.to !== undefined && { to: options.to }), ...(options.commit !== undefined && { commit: options.commit }) },
      });
      // Soft-fail policy: when ocr is not ready or the subprocess
      // failed, we still return a JSON envelope (ok=false) but
      // do NOT set process.exitCode — the caller is expected to
      // pattern-match on the state and proceed without ocr.
      const envelope = result.spawned && result.exitCode === 0
        ? ok('code-review.run-ocr', result, [...result.warnings], [...result.nextActions])
        : fail(
            'code-review.run-ocr',
            result.state.toUpperCase().replace(/-/g, '_'),
            result.spawned ? `ocr review exited ${result.exitCode}` : `ocr is not ready: ${result.state}`,
            result,
            [...result.nextActions]
          );
      printResult(io, envelope, options.json);
      // Intentionally do NOT set process.exitCode here — soft-fail.
    } catch (error: unknown) {
      printResult(
        io,
        fail(
          'code-review.run-ocr',
          'RUN_OCR_FAILED',
          getErrorMessage(error),
          { spawned: false, state: 'detection-failed' as const, exitCode: null, stdout: '', stderr: '', durationMs: 0, parsed: null },
          ['Run `peaks code-review detect-ocr --json` to inspect ocr install state.']
        ),
        options.json
      );
      // Soft-fail on exception too — peaks-rd should continue.
    }
  });
}
