/**
 * `peaks shadcn init` — dynamic wrapper around the upstream `shadcn` CLI.
 *
 * Slice B2 of 2026-09-09-ecc-dynamic-and-cleanup: `skills/bee/peaks-rd/SKILL.md`
 * and `references/frontend-project-generation.md` already tell RD to scaffold
 * a frontend with `peaks shadcn init --preset [CODE] --template vite`, but the
 * command did not exist and `shadcn` was not a dependency. Rather than add a
 * hard dependency, this mirrors `src/services/lint/detect-ocr-18.ts` +
 * `npx-resolver.ts`: the tool is obtained on demand via
 * `npx --package shadcn@<pin> -- shadcn ...`, so the skill reference is true
 * and the dependency stays dynamic.
 *
 * Per the "Enhancement, not new AI CLI" tenet this is a thin pass-through:
 * peaks-loop resolves the upstream binary and forwards the user's intent. It
 * does not reimplement scaffolding and does not inject its own prompts.
 */
import { spawnSync } from 'node:child_process';
import { Command } from 'commander';
import { resolveNpxInvocation } from '../../services/lint/npx-resolver.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';

/** Pinned upstream version — bump deliberately, never float on `latest`. */
export const SHADCN_PACKAGE = 'shadcn@4.21.0';

export type ShadcnInitState = 'ok' | 'shadcn-missing' | 'execution-failed';

export type ShadcnInitOptions = {
  readonly cwd: string;
  readonly preset: string;
  readonly template?: string;
  readonly yes?: boolean;
  readonly timeoutMs?: number;
};

export type ShadcnInitResult = {
  readonly state: ShadcnInitState;
  readonly argv: readonly string[];
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly durationMs: number;
};

/**
 * Pure argv builder. `--package <pin> --` makes npx resolve the pinned
 * upstream CLI without installing it into the project.
 */
export function buildShadcnInitArgs(options: Pick<ShadcnInitOptions, 'preset' | 'template' | 'yes'>): string[] {
  const args = ['--package', SHADCN_PACKAGE, '--', 'shadcn', 'init', '--preset', options.preset];
  if (options.template !== undefined && options.template.length > 0) {
    args.push('--template', options.template);
  }
  if (options.yes === true) {
    args.push('--yes');
  }
  return args;
}

/**
 * Spawn the upstream CLI through the cross-platform npx resolver (on Windows
 * `npx` is a `.cmd` shim that `spawnSync` refuses to invoke directly).
 * Fail-soft: a missing network / missing npx returns a state, never throws.
 */
export function runShadcnInit(options: ShadcnInitOptions): ShadcnInitResult {
  const start = Date.now();
  const args = buildShadcnInitArgs(options);
  const invocation = resolveNpxInvocation(args);
  const result = spawnSync(invocation.command, [...invocation.args], {
    cwd: options.cwd,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 300_000,
    maxBuffer: 32 * 1024 * 1024,
    env: invocation.baseEnv
  });
  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';

  if (result.error !== undefined && result.error !== null) {
    return {
      state: 'shadcn-missing',
      argv: args,
      stdout,
      stderr: stderr.length > 0 ? stderr : getErrorMessage(result.error),
      exitCode: null,
      durationMs: Date.now() - start
    };
  }
  if (result.status !== 0) {
    return {
      state: 'execution-failed',
      argv: args,
      stdout,
      stderr,
      exitCode: result.status,
      durationMs: Date.now() - start
    };
  }
  return {
    state: 'ok',
    argv: args,
    stdout,
    stderr,
    exitCode: 0,
    durationMs: Date.now() - start
  };
}

export function registerShadcnCommands(program: Command, io: ProgramIO): void {
  const shadcn = program
    .command('shadcn')
    .description('Dynamic wrapper for the upstream shadcn CLI (obtained via `npx --package`; no hard dependency).');

  addJsonOption(
    shadcn
      .command('init')
      .description('Scaffold/init a shadcn/ui project by forwarding to upstream `shadcn init`.')
      .requiredOption('--preset <code>', 'shadcn registry preset code (resolve it before scaffolding when unknown)')
      .option('--template <name>', 'project template, e.g. vite or next')
      .option('--project <path>', 'target project root', '.')
      .option('--yes', 'forward --yes to upstream (skip its confirmation prompts)', false)
  ).action((options: { preset: string; template?: string; project: string; yes?: boolean; json?: boolean }) => {
    const asJson = options.json === true;
    const result = runShadcnInit({
      cwd: options.project,
      preset: options.preset,
      ...(options.template !== undefined && options.template.length > 0 ? { template: options.template } : {}),
      ...(options.yes === true ? { yes: true } : {})
    });

    if (result.state === 'ok') {
      printResult(
        io,
        ok('shadcn.init', result, [], [
          `Upstream argv: npx ${result.argv.join(' ')}`,
          'Generated projects must be TypeScript-only (no JavaScript source or config files).'
        ]),
        asJson
      );
      return;
    }

    const code = result.state === 'shadcn-missing' ? 'SHADCN_UNAVAILABLE' : 'SHADCN_INIT_FAILED';
    const message =
      result.state === 'shadcn-missing'
        ? `could not resolve ${SHADCN_PACKAGE} via npx`
        : `upstream shadcn init exited with code ${result.exitCode}`;
    printResult(
      io,
      fail('shadcn.init', code, message, result, [
        `Pinned package: ${SHADCN_PACKAGE}`,
        'Ensure Node.js >= 20 with npm is on PATH and the network allows the npm registry.',
        `Retry with: npx --package ${SHADCN_PACKAGE} -- shadcn init --preset <code>`
      ]),
      asJson
    );
    process.exitCode = 1;
  });
}
