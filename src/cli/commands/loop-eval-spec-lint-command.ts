// `peaks loop spec lint <file>` — the only spec verb that validates an explicit
// caller-named path instead of resolving a session-bound spec.yaml, which is why it
// owns a file of its own.
import type { Command } from 'commander';
import { lintSpecFile } from '../../services/loop/spec-service.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import { loopSpecParent } from './loop-eval-parents.js';

interface LoopSpecLintOptions {
  rid?: string;
  json?: boolean;
}

export function registerLoopSpecLintCommand(program: Command, io: ProgramIO): void {
  const spec = loopSpecParent(program);

  addJsonOption(
    spec
      .command('lint')
      .description('Slice E.2: schema-validate a spec.yaml file (path required).')
      .argument('<file>', 'path to spec.yaml')
      .option('--rid <rid>', 'override the rid embedded in the spec (default: inferred from path)')
  ).action((file: string, options: LoopSpecLintOptions) => runLoopSpecLint(file, options, io));
}

function reportLoopSpecLintFailure(
  io: ProgramIO,
  error: unknown,
  file: string,
  asJson?: boolean
): void {
  printResult(
    io,
    fail('loop.spec.lint', 'LOOP_SPEC_LINT_FAILED', getErrorMessage(error), { file }, [
      'Verify the file path and rid flag.'
    ]),
    asJson
  );
  process.exitCode = 1;
}

function runLoopSpecLint(file: string, options: LoopSpecLintOptions, io: ProgramIO): void {
  try {
    const result = lintSpecFile(file, options.rid);
    if (result.spec === null) {
      printResult(
        io,
        fail(
          'loop.spec.lint',
          'SPEC_LINT_FAILED',
          result.report.errors.join('; '),
          { file, raw: result.raw.slice(0, 200) },
          ['Verify the file path and YAML syntax.']
        ),
        options.json
      );
      process.exitCode = 1;
      return;
    }
    printResult(
      io,
      ok(
        'loop.spec.lint',
        {
          file,
          spec: result.spec,
          lint: {
            ok: result.report.ok,
            errors: result.report.errors,
            warnings: result.report.warnings
          }
        },
        [],
        []
      ),
      options.json
    );
    if (!result.report.ok) process.exitCode = 1;
  } catch (error) {
    reportLoopSpecLintFailure(io, error, file, options.json);
  }
}
