/** The `--gate` path of `peaks design check`: refuse without a request id or a
 * session, run the check, and write the conformance pair. The input builder and
 * echo helpers arrive as parameters, so neither command module imports the other. */
import { fail, ok } from 'peaks-loop-shared/result';

import { repoRelativeKey } from '../../shared/path-utils.js';
import {
  activeSessionId,
  DesignBaselineUrlScopeError,
  type AcceptanceEnv,
  type AcceptanceRefusal
} from '../../services/design/acceptance.js';
import {
  checkDesign,
  exitCodeForVerdict,
  type CheckDesignInput,
  type DesignCheckResult
} from '../../services/design/design-check.js';
import { writeConformanceEvidence } from '../../services/design/design-evidence.js';
import { getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { acceptanceFor, type DesignCheckCliOptions } from './design-check-input.js';

const USAGE_EXIT_CODE = 3;

export type DesignCheckEcho = {
  checkInput: (options: DesignCheckCliOptions, allowSourceOnly: boolean) => CheckDesignInput;
  checkWarnings: (options: DesignCheckCliOptions) => string[];
  checkNextActions: (result: DesignCheckResult) => string[];
};

function refuse(io: ProgramIO, options: DesignCheckCliOptions, refusal: AcceptanceRefusal): void {
  printResult(
    io,
    fail('design.check', refusal.code, refusal.message, { projectRoot: options.project }, [
      ...refusal.actions
    ]),
    options.json === true
  );
  process.exitCode = USAGE_EXIT_CODE;
}

async function writeAndPrint(
  options: DesignCheckCliOptions,
  io: ProgramIO,
  echo: DesignCheckEcho,
  target: { sessionId: string; rid: string; result: DesignCheckResult }
): Promise<void> {
  try {
    const written = await writeConformanceEvidence({
      projectRoot: options.project,
      sessionId: target.sessionId,
      rid: target.rid,
      result: target.result
    });
    const evidencePath = repoRelativeKey(written.markdownPath, options.project);
    const data = { ...target.result, evidencePath, sha256: written.sha256 };
    printResult(
      io,
      ok(
        'design.check',
        data,
        [...echo.checkWarnings(options), ...(target.result.warnings ?? [])],
        echo.checkNextActions(target.result)
      ),
      options.json === true
    );
    process.exitCode = exitCodeForVerdict(target.result.verdict);
  } catch (error) {
    refuse(io, options, {
      code: 'DESIGN_EVIDENCE_WRITE_FAILED',
      message: getErrorMessage(error),
      actions: ['Fix the evidence path or the filesystem, then re-run the gated check.']
    });
  }
}

export async function runGatedDesignCheck(
  options: DesignCheckCliOptions,
  io: ProgramIO,
  env: AcceptanceEnv,
  echo: DesignCheckEcho
): Promise<void> {
  const rid = options.rid;
  if (rid === undefined || rid.trim() === '') {
    refuse(io, options, {
      code: 'DESIGN_GATE_REQUIRES_RID',
      message: '--gate needs the request id the evidence belongs to.',
      actions: ['Re-run with --gate and --rid <rid>.']
    });
    return;
  }
  const sessionId = options.sessionId ?? activeSessionId(options.project) ?? undefined;
  if (sessionId === undefined || sessionId.trim() === '') {
    refuse(io, options, {
      code: 'DESIGN_GATE_REQUIRES_SESSION',
      message: '--gate records the evidence under the session runtime dir; no session resolved.',
      actions: ['Pass --session-id, or run this work inside an active peaks session.']
    });
    return;
  }
  const accepted = options.allowSourceOnly === true;
  const refusal = acceptanceFor(options, sessionId, env.CI);
  if (refusal !== null) {
    refuse(io, options, refusal);
    return;
  }
  try {
    const result = await checkDesign(echo.checkInput({ ...options, sessionId }, accepted));
    await writeAndPrint(options, io, echo, { sessionId, rid, result });
  } catch (error) {
    refuse(
      io,
      options,
      error instanceof DesignBaselineUrlScopeError
        ? { code: error.code, message: error.message, actions: error.actions }
        : { code: 'DESIGN_CHECK_FAILED', message: getErrorMessage(error), actions: [] }
    );
  }
}
