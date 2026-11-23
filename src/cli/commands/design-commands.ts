// `peaks design init|status|uninit|check` — the CLI surface for the per-app design
// contract. Runners are exported and never call process.exit(); the exit code is here.

import { type Command, InvalidArgumentError } from 'commander';

import { fail, ok } from 'peaks-loop-shared/result';

import {
  acceptanceRefusal,
  activeSessionId,
  CHECK_BLOCKED_ACTIONS,
  SOURCE_ONLY_DIAGNOSTIC,
  type AcceptanceEnv
} from '../../services/design/acceptance.js';
import {
  checkDesignSourceOnly,
  type DesignCheckResult,
  exitCodeForVerdict
} from '../../services/design/design-check.js';
import {
  initDesignContract,
  readDesignStatus,
  removeDesignContract
} from '../../services/design/design-init.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';

export type DesignInitCliOptions = {
  project: string;
  app?: string;
  start?: string;
  port?: number;
  pages?: string;
  archetypes?: string;
  force?: boolean;
  refresh?: boolean;
  json?: boolean;
};

export type DesignScopedCliOptions = { project?: string; app?: string; json?: boolean };

export type DesignCheckCliOptions = {
  project: string;
  app?: string;
  rid?: string;
  sessionId?: string | undefined;
  files?: string;
  base?: string;
  url?: string;
  pages?: string;
  sourceOnly?: boolean;
  allowSourceOnly?: boolean;
  acceptNote?: string;
  json?: boolean;
};

const INIT_NEXT_ACTIONS = [
  'Ask the user to review the generated contract summary before implementation.'
];
/** The usage-error code from the check's exit contract (spec §7.1). */
const USAGE_EXIT_CODE = 3;

/** A `--flag a,b,c` value as a list; an empty string is an empty list, not absent. */
const splitList = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

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

function initInput(options: DesignInitCliOptions) {
  return {
    projectRoot: options.project,
    ...(options.app === undefined ? {} : { appPath: options.app }),
    ...(options.start === undefined ? {} : { startCommand: options.start }),
    ...(options.port === undefined ? {} : { port: options.port }),
    ...(options.pages === undefined ? {} : { pages: splitList(options.pages) }),
    ...(options.archetypes === undefined ? {} : { archetypes: splitList(options.archetypes) }),
    force: options.force === true,
    refresh: options.refresh === true
  };
}

function checkInput(options: DesignCheckCliOptions, allowSourceOnly: boolean) {
  return {
    projectRoot: options.project,
    ...(options.app === undefined ? {} : { appPath: options.app }),
    ...(options.rid === undefined ? {} : { rid: options.rid }),
    ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
    ...(options.files === undefined ? {} : { changedFiles: splitList(options.files) }),
    ...(options.base === undefined ? {} : { base: options.base }),
    allowSourceOnly,
    ...(options.acceptNote === undefined ? {} : { acceptNote: options.acceptNote })
  };
}

function checkNextActions(result: DesignCheckResult): string[] {
  if (result.verdict === 'fail') return ['Fix the listed findings, then re-run the design check.'];
  if (result.verdict === 'not-adopted') {
    return ['Initialize the design contract for this app before checking it.'];
  }
  return result.errorCode === undefined ? [] : (CHECK_BLOCKED_ACTIONS[result.errorCode] ?? []);
}

/** `--url` and `--pages` scope G2, which S1 does not have; say so rather than drop them. */
function checkWarnings(options: DesignCheckCliOptions): string[] {
  const used: string[] = [];
  if (options.url !== undefined) used.push('--url');
  if (options.pages !== undefined) used.push('--pages');
  const warnings = used.map(
    (flag) => `${flag} is a G2 render input; S1 has no render engine, so it was not used.`
  );
  if (options.sourceOnly === true) warnings.push(SOURCE_ONLY_DIAGNOSTIC);
  return warnings;
}

export async function runDesignInit(options: DesignInitCliOptions, io: ProgramIO): Promise<void> {
  const failInit = failurePrinter(io, 'design.init', options.json);
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
      tokensFound: result.tokensFound
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
  const failCheck = failurePrinter(io, 'design.check', options.json);
  const failUsage = failurePrinter(io, 'design.check', options.json, USAGE_EXIT_CODE);
  // One read: the flag wins, else the binding `peaks session info --active` reports.
  const sessionId = options.sessionId ?? activeSessionId(options.project) ?? undefined;
  const checkOptions = { ...options, sessionId };
  const accepted = options.allowSourceOnly === true;
  if (accepted) {
    const refusal = acceptanceRefusal(checkOptions, env.CI);
    if (refusal !== null) {
      failUsage(refusal.code, refusal.message, { projectRoot: options.project }, refusal.actions);
      return;
    }
  }
  try {
    const result = await checkDesignSourceOnly(checkInput(checkOptions, accepted));
    printResult(
      io,
      ok('design.check', result, checkWarnings(options), checkNextActions(result)),
      options.json
    );
    process.exitCode = exitCodeForVerdict(result.verdict);
  } catch (error) {
    failCheck('DESIGN_CHECK_FAILED', getErrorMessage(error), { projectRoot: options.project });
    process.exitCode = USAGE_EXIT_CODE;
  }
}

export function registerDesignCommands(program: Command, io: ProgramIO): void {
  const design = program
    .command('design')
    .description('Build and check the per-app design contract (source-only in S1)');

  addJsonOption(
    design
      .command('init')
      .description('Write design/contract.md and the three machine-owned contract files')
      .requiredOption('--project <path>', 'project root')
      .option('--app <path>', 'app root when several frontends exist')
      .option('--start <command>', 'dev-server command recorded in engine.json')
      .option('--port <n>', 'dev-server port recorded in engine.json', parsePort)
      .option('--pages <list>', 'comma-separated render pages recorded in engine.json')
      .option('--archetypes <list>', 'comma-separated exemplar archetypes')
      .option('--force', 'back up and rewrite user-owned files')
      .option('--refresh', 'rewrite only engine.json')
  ).action((options: DesignInitCliOptions) => runDesignInit(options, io));

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
      .description('Judge the change set against the design contract (G1 source-only in S1)')
      .requiredOption('--project <path>', 'project root')
      .option('--app <path>', 'app root when several frontends exist')
      .option('--rid <rid>', 'request id whose ## Changed paths claims scope the change set')
      .option('--session-id <id>', 'session for rid claims (defaults to the active binding)')
      .option('--files <list>', 'comma-separated change set, repository-relative')
      .option('--base <ref>', 'git ref the change set is read against (default HEAD)')
      .option('--url <url>', 'render URL (G2; not used in S1)')
      .option('--pages <list>', 'render pages (G2; not used in S1)')
      .option('--source-only', 'report the G1 source layer only; never a pass')
      .option('--allow-source-only', 'accept a source-only result in place of a render check')
      .option('--accept-note <text>', "the user's own words accepting source-only")
  ).action((options: DesignCheckCliOptions) => runDesignCheck(options, io));
}
