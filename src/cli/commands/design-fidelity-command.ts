/**
 * `peaks design fidelity <route>` — compare a prototype with the running
 * implementation at one or more viewports and write the evidence pair.
 *
 * The command starts no application server. A local prototype file is served by
 * the loopback-only static server inside the oracle and that fact is recorded;
 * the implementation is a URL the caller already runs. With no `--prototype`
 * the route is recorded as `not-applicable` rather than skipped, because the
 * later prerequisite treats a missing conclusion as a refusal.
 */
import { resolve } from 'node:path';

import type { Command } from 'commander';
import { fail, ok } from 'peaks-loop-shared/result';

import { repoRelativeKey } from '../../shared/path-utils.js';
import { activeSessionId } from '../../services/design/acceptance.js';
import {
  readPriorPrototypeSha,
  writeFidelityEvidence
} from '../../services/design/fidelity-evidence.js';
import {
  layoutCapture,
  runFidelityOracle,
  type FidelityCaptureFn
} from '../../services/design/fidelity-oracle.js';
import {
  blockedFidelity,
  notApplicableFidelity,
  type FidelityMode,
  type FidelityResult
} from '../../services/design/layout/fidelity-model.js';
import { readSpacingTokensStrict } from '../../services/design/layout/layout-tokens.js';
import type { Viewport } from '../../services/design/layout/layout-geometry.js';
import { isSinglePathSegment } from '../../services/session/getSessionDir.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { designRootOf, viewportList } from './design-layout-shared.js';

export const FIDELITY_DEFAULT_VIEWPORTS = '390x844,834x1112,1280x800';

const COMMAND = 'design.fidelity';
const USAGE_EXIT_CODE = 2;

export type DesignFidelityCliOptions = {
  project: string;
  app?: string;
  prototype?: string;
  implementation?: string;
  mode?: string;
  viewport?: string;
  sessionId?: string;
  json?: boolean;
};

/** pass and not-applicable pass the gate; fail and blocked do not. */
export function exitCodeForFidelity(verdict: FidelityResult['verdict']): number {
  if (verdict === 'fail') return 1;
  if (verdict === 'blocked') return USAGE_EXIT_CODE;
  return 0;
}

function modeOf(raw: string | undefined): FidelityMode | null {
  if (raw === undefined) return 'prod';
  return raw === 'prod' || raw === 'dev' ? raw : null;
}

type Refusal = { code: string; message: string; actions: string[] };

function refuse(io: ProgramIO, options: DesignFidelityCliOptions, refusal: Refusal): void {
  printResult(
    io,
    fail(COMMAND, refusal.code, refusal.message, { projectRoot: options.project }, refusal.actions),
    options.json === true
  );
  process.exitCode = USAGE_EXIT_CODE;
}

type Resolved = {
  projectRoot: string;
  sessionId: string;
  mode: FidelityMode;
  viewports: readonly Viewport[];
};

function resolveOptions(io: ProgramIO, options: DesignFidelityCliOptions): Resolved | null {
  const mode = modeOf(options.mode);
  if (mode === null) {
    refuse(io, options, {
      code: 'DESIGN_FIDELITY_MODE_INVALID',
      message: '--mode must be prod or dev',
      actions: []
    });
    return null;
  }
  const viewports = viewportList(options.viewport ?? FIDELITY_DEFAULT_VIEWPORTS);
  if (viewports === null) {
    refuse(io, options, {
      code: 'DESIGN_FIDELITY_VIEWPORT_INVALID',
      message: '--viewport must be a WxH list',
      actions: []
    });
    return null;
  }
  const projectRoot = resolve(options.project);
  const sessionId = options.sessionId ?? activeSessionId(projectRoot) ?? undefined;
  if (sessionId === undefined || !isSinglePathSegment(sessionId)) {
    refuse(io, options, {
      code: 'DESIGN_FIDELITY_REQUIRES_SESSION',
      message: 'the fidelity artifact is written under a session; no usable session resolved',
      actions: ['Run this work inside an active peaks session.']
    });
    return null;
  }
  return { projectRoot, sessionId, mode, viewports };
}

type RouteOptions = DesignFidelityCliOptions & { route: string };

/** The verdict for this run; token attribution needs the contract, a skip does not. */
async function verdictFor(
  options: RouteOptions,
  resolved: Resolved,
  capture: FidelityCaptureFn
): Promise<FidelityResult> {
  if (options.prototype === undefined || options.prototype.trim() === '') {
    return notApplicableFidelity(options.route, resolved.mode);
  }
  const tokens = readSpacingTokensStrict(designRootOf(options));
  if (!tokens.ok) return blockedFidelity(options.route, resolved.mode, tokens.reason);
  const prior = await readPriorPrototypeSha(
    resolved.projectRoot,
    resolved.sessionId,
    options.route
  );
  const result = await runFidelityOracle({
    projectRoot: resolved.projectRoot,
    app: options.app ?? null,
    route: options.route,
    prototype: options.prototype,
    implementation: options.implementation ?? null,
    mode: resolved.mode,
    viewports: resolved.viewports,
    tokens: tokens.tokens,
    priorSha256: prior.ok ? prior.sha256 : null,
    capture
  });
  // A prior record we could not read carries no binding, but it must not vanish:
  // the reason rides on this run's result so the artifact names it.
  if (prior.ok) return result;
  return {
    ...result,
    reason: result.reason === null ? prior.reason : `${result.reason}; ${prior.reason}`
  };
}

export async function runDesignFidelity(
  options: RouteOptions,
  io: ProgramIO,
  capture: FidelityCaptureFn = layoutCapture
): Promise<void> {
  const resolved = resolveOptions(io, options);
  if (resolved === null) return;
  let result: FidelityResult;
  try {
    result = await verdictFor(options, resolved, capture);
  } catch (error) {
    refuse(io, options, {
      code: 'DESIGN_FIDELITY_FAILED',
      message: getErrorMessage(error),
      actions: []
    });
    return;
  }
  try {
    const written = await writeFidelityEvidence({
      projectRoot: resolved.projectRoot,
      sessionId: resolved.sessionId,
      result
    });
    printResult(
      io,
      ok(COMMAND, {
        ...result,
        evidencePath: repoRelativeKey(written.markdownPath, resolved.projectRoot),
        sha256: written.sha256
      }),
      options.json === true
    );
    process.exitCode = exitCodeForFidelity(result.verdict);
  } catch (error) {
    refuse(io, options, {
      code: 'DESIGN_FIDELITY_EVIDENCE_WRITE_FAILED',
      message: getErrorMessage(error),
      actions: []
    });
  }
}

export function registerDesignFidelityCommand(program: Command, io: ProgramIO): void {
  // Mount on the existing `design` parent, never a bare second `design` group.
  const design = program.commands.find((command) => command.name() === 'design');
  if (design === undefined) {
    throw new Error(
      'registerDesignFidelityCommand: no `design` command on this program — ' +
        'design-commands must be registered first'
    );
  }
  addJsonOption(
    design
      .command('fidelity <route>')
      .description('Compare a prototype with the implementation and write the fidelity evidence')
      .requiredOption('--project <path>', 'project root')
      .option('--prototype <file|url>', 'prototype file or http(s) URL; omit for not-applicable')
      .option('--implementation <url>', 'URL of the running implementation')
      .option('--mode <mode>', 'prod or dev (default prod)')
      .option(
        '--viewport <list>',
        `comma-separated WxH viewports (default ${FIDELITY_DEFAULT_VIEWPORTS})`
      )
      .option('--app <path>', 'app root when the design contract does not sit at the project root')
      .option('--session-id <id>', 'session to write under (defaults to the active binding)')
  ).action((route: string, options: DesignFidelityCliOptions) =>
    runDesignFidelity({ ...options, route }, io)
  );
}
