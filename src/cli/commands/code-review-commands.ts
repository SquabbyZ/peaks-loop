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
 *     detection-failed). Source of truth for the LLM endpoint
 *     config is `peaksConfig.ocr.llm` in the user's peaks-loop
 *     config (NOT `~/.opencodereview/config.json`).
 *   - `peaks code-review run-ocr [--from --to --commit]` — invokes
 *     `ocr review --format json` and wraps the result in a peaks
 *     ResultEnvelope. Soft-fails when ocr isn't ready so peaks-rd
 *     can continue without the second-opinion review. Injects the
 *     LLM endpoint config as env vars (OCR_LLM_URL / OCR_LLM_TOKEN
 *     / OCR_LLM_MODEL / OCR_USE_ANTHROPIC / OCR_LLM_AUTH_HEADER)
 *     so the ocr subprocess never has to read from a file the
 *     user did not set up themselves.
 *   - `peaks code-review config-template` — prints the JSON snippet
 *     the user should paste into their peaks-loop config.json. It
 *     does NOT write anything. The user is in control of their
 *     LLM token / URL / model. No `peaks ocr config set`; the user
 *     either edits the JSON directly or uses `peaks config set
 *     --key ocr.llm.url --value '...'` (a peaks-loop command, not
 *     an ocr command).
 */
import { Command } from 'commander';
import { getOcrConfigTemplate, detectOcr, runOcrReview } from '../../services/code-review/ocr-service.js';
import { getOcrLlmConfig, getUserConfigPath, redactConfigSecrets } from '../../services/config/config-service.js';
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

type ConfigTemplateOptions = {
  json?: boolean;
};

export function registerCodeReviewCommands(program: Command, io: ProgramIO): void {
  const codeReview = program
    .command('code-review', { hidden: true })
    .description(
      'Code-review primitives for peaks-rd Gate B3. Wraps the soft-optional `@alibaba-group/open-code-review` (ocr) tool when it is installed + configured; peaks-rd uses the structured JSON output as a second-opinion review alongside its own LLM review. ocr is a peerDependency of peaks-loop 2.8.2+ (was briefly promoted to a hard dependency in 2.0.1/2.0.2, then demoted to optionalDependencies 2.0.3+ — peer in 2.8.2 because its postinstall downloads a Go binary via HTTPS and would otherwise slow `npm i -g peaks-loop` in restricted environments). Install manually with `npm i -g @alibaba-group/open-code-review` if you want second-opinion reviews. LLM endpoint config lives under `peaksConfig.ocr.llm` in the user config — run `peaks code-review config-template` to see the JSON snippet to paste.'
    );

  addJsonOption(
    codeReview
      .command('detect-ocr')
      .description(
        'Read-only probe: returns the ocr install + config state as a JSON envelope (5 reasons: ready / package-missing / binary-missing / config-missing / detection-failed). peaks-rd calls this first to decide whether to invoke `run-ocr`. Reads the LLM endpoint from `peaksConfig.ocr.llm` (not from ~/.opencodereview/config.json).'
      )
      .option('--project <path>', 'project root (default: cwd)')
  ).action((options: DetectOcrOptions) => {
    const projectRoot = options.project ?? process.cwd();
    try {
      const detect = detectOcr({
        cwd: projectRoot,
        peaksConfigPath: getUserConfigPath(),
        peaksOcrConfig: getOcrLlmConfig(),
      });
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
          { state: 'detection-failed', packageInstalled: false, binaryPath: null, version: null, configPath: '', configValid: false, missingKeys: [] },
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
        'Run `ocr review --format json` and return the parsed JSON envelope. Soft-fails (exit 0, ok=false) when ocr is not ready, so peaks-rd can continue without the second-opinion review and surface the install/config nextActions to the user. The peaks-loop `peaksConfig.ocr.llm` block is injected as OCR_LLM_URL / OCR_LLM_TOKEN / ... env vars so the ocr subprocess never has to read ~/.opencodereview/config.json.'
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
        peaksConfigPath: getUserConfigPath(),
        peaksOcrConfig: getOcrLlmConfig(),
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

  addJsonOption(
    codeReview
      .command('config-template')
      .description(
        'Print the JSON snippet the user should paste into their peaks-loop config (`peaksConfig.ocr.llm`). This command does NOT write anything. The user is the only party that touches the LLM token / URL / model — peaks-loop never auto-configures the endpoint. Token value is shown as the placeholder "<your-api-key>"; replace it before pasting.'
      )
  ).action((options: ConfigTemplateOptions) => {
    const template = getOcrConfigTemplate();
    const targetPath = getUserConfigPath();
    const currentConfig = getOcrLlmConfig();
    const currentRedacted = currentConfig === null ? null : redactConfigSecrets(currentConfig, 'ocr.llm');
    const payload = {
      targetPath,
      currentConfig: currentRedacted,
      template,
      nextActions: [
        `Edit ${targetPath} and add the "ocr" block from the template above.`,
        'OR use peaks-loop config set with one key at a time: `peaks config set --key ocr.llm.url --value \'<url>\'` etc.',
        'The authToken field is sensitive and is stored in the user layer (`~/.peaks/config.json`); peaks-loop will not commit it.',
        'Re-run `peaks code-review detect-ocr --json` to verify the new state is `ready`.',
      ],
    };
    printResult(io, ok('code-review.config-template', payload), options.json);
  });
}
