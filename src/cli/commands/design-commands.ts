// `peaks design init|status|uninit|check` — the design CLI; runners never exit, the code is here.

import { type Command, InvalidArgumentError } from 'commander';

import { fail, ok } from 'peaks-loop-shared/result';

import {
  activeSessionId,
  DesignBaselineUrlScopeError,
  type AcceptanceEnv
} from '../../services/design/acceptance.js';
import { checkDesign, exitCodeForVerdict } from '../../services/design/design-check.js';
import { initDesignContract } from '../../services/design/design-init.js';
import { readDesignStatus, removeDesignContract } from '../../services/design/design-status.js';
import { redactUrl } from '../../services/design/url-redact.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import {
  acceptanceFor,
  checkInput,
  checkNextActions,
  checkWarnings,
  splitList,
  type DesignCheckCliOptions
} from './design-check-input.js';
import { runGatedDesignCheck, type DesignCheckEcho } from './design-gate-evidence.js';

export type DesignInitCliOptions = {
  project: string;
  app?: string;
  start?: string;
  port?: number;
  pages?: string;
  archetypes?: string;
  pageRoots?: string;
  exclude?: string;
  url?: string;
  force?: boolean;
  refresh?: boolean;
  json?: boolean;
};

export type DesignScopedCliOptions = { project?: string; app?: string; json?: boolean };

const INIT_NEXT_ACTIONS = [
  'Ask the user to review the generated contract summary before implementation.'
];
/** The usage-error code from the check's exit contract (spec §7.1). */
const USAGE_EXIT_CODE = 3;
const CHECK_URL_HELP = 'render URL for G2 (defaults to engine.json or a derived loopback URL)';
const INIT_URL_ACTIONS = ['Pass an absolute http(s) URL, such as http://localhost:3000/.'];

const projectRootOf = (options: { project?: string }): string => options.project ?? process.cwd();

const parsePort = (value: string): number => {
  const port = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(port) || port < 1) {
    throw new InvalidArgumentError('must be a positive integer');
  }
  return port;
};

/** One printer per command: the envelope and its exit code in a single home. */
function failurePrinter(io: ProgramIO, command: string, json: boolean | undefined, exitCode = 1) {
  return (
    code: string,
    message: string,
    data: Record<string, unknown>,
    nextActions: string[] = []
  ): void => {
    printResult(io, fail(command, code, message, data, nextActions), json === true);
    process.exitCode = exitCode;
  };
}

/** A fixed `--url` must be an absolute http(s) address before any file is written. */
function initUrlRefusal(value: string): { code: string; message: string } | null {
  const code = 'DESIGN_URL_INVALID';
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { code, message: `--url must be an absolute URL, got "${redactUrl(value)}"` };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { code, message: `--url must use http or https, got "${redactUrl(value)}"` };
  }
  // engine.json is git-tracked: a credential here would be stored forever and
  // refused by the trust boundary anyway, so the write is refused instead.
  if (parsed.username !== '' || parsed.password !== '') {
    return { code, message: `--url must not carry credentials, got "${redactUrl(value)}"` };
  }
  return null;
}

function initInput(options: DesignInitCliOptions) {
  return {
    projectRoot: options.project,
    ...(options.app === undefined ? {} : { appPath: options.app }),
    ...(options.start === undefined ? {} : { startCommand: options.start }),
    ...(options.port === undefined ? {} : { port: options.port }),
    ...(options.pages === undefined ? {} : { pages: splitList(options.pages) }),
    ...(options.archetypes === undefined ? {} : { archetypes: splitList(options.archetypes) }),
    ...(options.pageRoots === undefined ? {} : { pageRoots: splitList(options.pageRoots) }),
    ...(options.exclude === undefined ? {} : { exclude: splitList(options.exclude) }),
    ...(options.url === undefined ? {} : { url: options.url }),
    force: options.force === true,
    refresh: options.refresh === true
  };
}

const GATE_DEPS: DesignCheckEcho = { checkInput, checkWarnings, checkNextActions };

export async function runDesignInit(options: DesignInitCliOptions, io: ProgramIO): Promise<void> {
  const failInit = failurePrinter(io, 'design.init', options.json);
  const failInitUsage = failurePrinter(io, 'design.init', options.json, USAGE_EXIT_CODE);
  const urlRefusal = options.url === undefined ? null : initUrlRefusal(options.url);
  if (urlRefusal !== null) {
    failInitUsage(
      urlRefusal.code,
      urlRefusal.message,
      { projectRoot: options.project },
      INIT_URL_ACTIONS
    );
    return;
  }
  try {
    const result = await initDesignContract(initInput(options));
    if (!result.ok) {
      failInit(
        result.code,
        result.message,
        {
          projectRoot: options.project,
          ...(result.candidates === undefined ? {} : { candidates: result.candidates })
        },
        INIT_NEXT_ACTIONS
      );
      return;
    }
    const data = {
      root: result.root,
      written: result.written,
      preserved: result.preserved,
      tokensFound: result.tokensFound,
      primaryColor: result.primary.color,
      primarySource: result.primary.source,
      gaps: result.primary.gaps
    };
    printResult(io, ok('design.init', data, [], INIT_NEXT_ACTIONS), options.json);
  } catch (error) {
    failInit('DESIGN_INIT_FAILED', getErrorMessage(error), { projectRoot: options.project });
  }
}

export async function runDesignStatus(
  options: DesignScopedCliOptions,
  io: ProgramIO
): Promise<void> {
  const failStatus = failurePrinter(io, 'design.status', options.json);
  try {
    const status = await readDesignStatus({
      projectRoot: projectRootOf(options),
      ...(options.app === undefined ? {} : { appPath: options.app })
    });
    const nextActions = status.adopted ? [] : ['No design contract is adopted for this app.'];
    printResult(io, ok('design.status', status, [], nextActions), options.json);
  } catch (error) {
    failStatus('DESIGN_STATUS_FAILED', getErrorMessage(error), {
      projectRoot: projectRootOf(options)
    });
  }
}

export async function runDesignUninit(
  options: DesignScopedCliOptions,
  io: ProgramIO
): Promise<void> {
  const failUninit = failurePrinter(io, 'design.uninit', options.json);
  try {
    const result = await removeDesignContract({
      projectRoot: projectRootOf(options),
      ...(options.app === undefined ? {} : { appPath: options.app })
    });
    if (!result.ok) {
      failUninit(result.code, result.message, { projectRoot: projectRootOf(options) });
      return;
    }
    printResult(io, ok('design.uninit', { removed: result.removed }), options.json);
  } catch (error) {
    failUninit('DESIGN_UNINIT_FAILED', getErrorMessage(error), {
      projectRoot: projectRootOf(options)
    });
  }
}

export async function runDesignCheck(
  options: DesignCheckCliOptions,
  io: ProgramIO,
  env: AcceptanceEnv = process.env
): Promise<void> {
  if (options.gate === true) return runGatedDesignCheck(options, io, env, GATE_DEPS);
  const failCheck = failurePrinter(io, 'design.check', options.json);
  const failUsage = failurePrinter(io, 'design.check', options.json, USAGE_EXIT_CODE);
  // One read: the flag wins, else the binding `peaks session info --active` reports.
  const sessionId = options.sessionId ?? activeSessionId(options.project) ?? undefined;
  const checkOptions = { ...options, sessionId };
  const accepted = options.allowSourceOnly === true;
  const refusal = acceptanceFor(checkOptions, sessionId, env.CI);
  if (refusal !== null) {
    failUsage(refusal.code, refusal.message, { projectRoot: options.project }, refusal.actions);
    return;
  }
  try {
    const result = await checkDesign(checkInput(checkOptions, accepted));
    printResult(
      io,
      ok(
        'design.check',
        result,
        [...checkWarnings(options), ...(result.warnings ?? [])],
        checkNextActions(result)
      ),
      options.json
    );
    process.exitCode = exitCodeForVerdict(result.verdict);
  } catch (error) {
    if (error instanceof DesignBaselineUrlScopeError) {
      failUsage(error.code, error.message, { projectRoot: options.project }, error.actions);
      return;
    }
    failCheck('DESIGN_CHECK_FAILED', getErrorMessage(error), { projectRoot: options.project });
    process.exitCode = USAGE_EXIT_CODE;
  }
}

function registerInitCommand(design: Command, io: ProgramIO): void {
  addJsonOption(
    design
      .command('init')
      .description('Write design/contract.md and the three machine-owned contract files')
      .requiredOption('--project <path>', 'project root')
      .option('--app <path>', 'app root when several frontends exist')
      .option('--start <command>', 'dev-server command recorded in engine.json')
      .option('--port <n>', 'dev-server port recorded in engine.json', parsePort)
      .option('--pages <list>', 'comma-separated render pages recorded in engine.json')
      .option('--page-roots <list>', 'comma-separated page roots recorded in paved-road.json')
      .option('--exclude <list>', 'comma-separated paths excluded from the source scan')
      .option('--url <url>', 'confirmed render URL recorded in engine.json')
      .option('--archetypes <list>', 'comma-separated exemplar archetypes')
      .option('--force', 'back up and rewrite user-owned files')
      .option('--refresh', 'rewrite only engine.json')
  ).action((options: DesignInitCliOptions) => runDesignInit(options, io));
}

export function registerDesignCommands(program: Command, io: ProgramIO): void {
  const design = program.command('design').description('Build and check the design contract');
  registerInitCommand(design, io);

  addJsonOption(
    design
      .command('status')
      .description('Report whether the design contract is adopted, its age, and its token counts')
      .option('--project <path>', 'project root (defaults to the current directory)')
      .option('--app <path>', 'app root when several frontends exist')
  ).action((options: DesignScopedCliOptions) => runDesignStatus(options, io));

  addJsonOption(
    design
      .command('uninit')
      .description('Remove the generated contract files and the governance standard')
      .option('--project <path>', 'project root (defaults to the current directory)')
      .option('--app <path>', 'app root when several frontends exist')
  ).action((options: DesignScopedCliOptions) => runDesignUninit(options, io));

  addJsonOption(
    design
      .command('check')
      .description('Judge the change set against the design contract (G1 source + G2 render)')
      .requiredOption('--project <path>', 'project root')
      .option('--app <path>', 'app root when several frontends exist')
      .option('--rid <rid>', 'request id whose ## Changed paths claims scope the change set')
      .option('--session-id <id>', 'session for rid claims (defaults to the active binding)')
      .option('--files <list>', 'comma-separated change set, repository-relative')
      .option('--base <ref>', 'git ref the change set is read against (default HEAD)')
      .option('--url <url>', CHECK_URL_HELP)
      .option('--pages <list>', 'comma-separated render pages for G2')
      .option('--start', 'start the dev server recorded in engine.json for G2')
      .option('--source-only', 'report the G1 source layer only; never a pass')
      .option('--allow-source-only', 'accept a source-only result in place of a render check')
      .option('--accept-note <text>', "the user's own words recorded with the acceptance")
      .option('--skip-exemplar', 'accept skipping the advisory archetype rubric (G3b)')
      .option('--baseline-url <url>', 'explicit G3a baseline URL instead of the recorded entry')
      .option('--gate', 'write design/check-<rid>.md and .json evidence for this verdict')
  ).action((options: DesignCheckCliOptions) => runDesignCheck(options, io));
}
