// src/cli/commands/web-op-runner.ts
//
// `runWebOp` — resolve the session, ensure a daemon, invoke one op, and emit
// exactly one envelope. Split out of `web-commands.ts`, where this one function
// had reached 117 lines; the gates, their order and every envelope are
// unchanged.

import { fail, getErrorMessage, ok, type ResultEnvelope } from 'peaks-loop-shared/result';

import { ensureDaemon } from '../../services/web/daemon-supervisor.js';
import { degradedEnvelope } from '../../services/web/web-fallback.js';
import { isWebDisabled } from '../../services/web/web-install-service.js';
import { cappedEcho, resolveProfileName } from '../../services/web/web-login-profile.js';
import type { WebOp, WebOpResponse } from '../../services/web/web-protocol.js';
import { WebDaemonClient } from '../../services/web/web-client.js';
import { printResult, redactSensitiveErrorMessage, type ProgramIO } from '../cli-helpers.js';
import { noSession, resolveSession } from './web-command-shared.js';
import { emit, wrapPageData } from './web-op-payload.js';
import {
  daemonFailureEnvelope,
  PROFILE_NEXT_ACTIONS,
  profileRefusal,
  safeDaemonCode,
  wrapDiagnostics
} from './web-op-refusals.js';

/** A browser op is user-visible latency; 30 s is generous but bounded. */
const OP_TIMEOUT_MS = 30_000;

/** The resolved `--profile` (folded), its fold notice, or the refusal envelope. */
interface ProfileOutcome {
  readonly args: Record<string, unknown>;
  readonly warnings: readonly string[];
  readonly envelope: ResultEnvelope<unknown> | null;
}

/**
 * Resolve the session, ensure a daemon, invoke one op, and emit exactly one
 * envelope. `WRAPPED_OPS` is applied here, after the byte caps the daemon
 * already imposed, so the UNTRUSTED markers are never themselves truncated.
 *
 * The `PEAKS_WEB_DISABLED` gate is the FIRST thing that happens (tech-doc §5.1
 * step 1, AC5). Before the session lookup, so a project with no binding still
 * gets `WEB_DISABLED` rather than `NO_SESSION`; before `ensureDaemon`, so
 * nothing is spawned and no lock is taken; and therefore before anything that
 * could touch the browser cache.
 */
export async function runWebOp(
  io: ProgramIO,
  op: WebOp,
  args: Record<string, unknown>,
  asJson: boolean
): Promise<void> {
  const command = `peaks.web.${op}`;
  // Declared outside the try so the CATCH reports the fold too (S4's F5/S5 rule
  // for `login`, applied here): a run that dies after the name was resolved
  // knows the canonical name just as well as a successful one.
  let foldWarnings: readonly string[] = [];
  try {
    if (isWebDisabled(process.env)) {
      printResult(io, webDisabledEnvelope(op, args), asJson);
      process.exitCode = 1;
      return;
    }

    const profile = resolveWebProfile(command, args);
    foldWarnings = profile.warnings;
    if (profile.envelope !== null) {
      printResult(io, profile.envelope, asJson);
      process.exitCode = 1;
      return;
    }

    const session = resolveSession();
    if (session === null) {
      printResult(io, withFold(noSession(command), foldWarnings), asJson);
      process.exitCode = 1;
      return;
    }

    const response = await callWebDaemon(op, profile.args, session.projectRoot, session.sessionId);
    if (!response.ok || response.data === null) {
      const refusal = daemonRefusal({ op, command, response, opArgs: profile.args, foldWarnings });
      printResult(io, refusal, asJson);
      process.exitCode = 1;
      return;
    }

    const wrapped = wrapPageData(op, response.data);
    emit(
      io,
      ok(command, wrapped.data, [...foldWarnings, ...wrapDiagnostics(response.warnings)]),
      asJson,
      wrapped.human
    );
  } catch (error) {
    printResult(io, webOpFailure(op, command, error, foldWarnings), asJson);
    process.exitCode = 1;
  }
}

/** The `WEB_OP_FAILED` envelope for a throw anywhere in the run, fold included. */
function webOpFailure(
  op: WebOp,
  command: string,
  error: unknown,
  foldWarnings: readonly string[]
): ResultEnvelope<unknown> {
  return withFold(
    daemonFailureEnvelope({
      op,
      command,
      code: 'WEB_OP_FAILED',
      message: redactSensitiveErrorMessage(getErrorMessage(error)),
      nextActions: []
    }),
    foldWarnings
  );
}

/**
 * The `PEAKS_WEB_DISABLED` gate's envelope. The gate is statement #1, so a
 * `--profile` has NOT been through the resolver yet and is still unbounded
 * caller text; `degradedEnvelope` carries every string arg into the payload, so
 * it is capped here — the same cap the `login` gate applies, for the same reason
 * (S1's bounded output is a property of the envelope, not only of stdout).
 */
function webDisabledEnvelope(op: WebOp, args: Record<string, unknown>): ResultEnvelope<unknown> {
  return degradedEnvelope(op, 'PEAKS_WEB_DISABLED=1', 3, cappedProfileArg(args));
}

/**
 * The unusable-daemon envelope. The daemon no longer downloads (R3), so "the
 * browser is not installed" arrives as a refusal: it is AC5's tier-3 branch,
 * not an opaque op failure — the caller must be handed the same envelope (MCP
 * tool, install command, screenshot consequence) that the gate produces.
 */
function daemonRefusal(input: {
  readonly op: WebOp;
  readonly command: string;
  readonly response: WebOpResponse<Record<string, unknown>>;
  readonly opArgs: Record<string, unknown>;
  readonly foldWarnings: readonly string[];
}): ResultEnvelope<unknown> {
  const code = safeDaemonCode(input.response.code);
  if (code === 'WEB_INSTALL_REQUIRED') {
    const reason = `WEB_INSTALL_REQUIRED: ${input.response.message ?? ''}`;
    return withFold(degradedEnvelope(input.op, reason, 3, input.opArgs), input.foldWarnings);
  }
  return withFold(
    daemonFailureEnvelope({
      op: input.op,
      command: input.command,
      code,
      message: input.response.message,
      nextActions: input.response.nextActions
    }),
    input.foldWarnings
  );
}

/** Prepend the fold notice to an envelope's warnings; never rewrite them away. */
function withFold<T>(envelope: ResultEnvelope<T>, warnings: readonly string[]): ResultEnvelope<T> {
  return warnings.length === 0
    ? envelope
    : { ...envelope, warnings: [...warnings, ...envelope.warnings] };
}

/** The `PEAKS_WEB_DISABLED` gate's args: a `--profile` still raw, so still capped. */
function cappedProfileArg(args: Record<string, unknown>): Record<string, unknown> {
  return typeof args['profile'] === 'string'
    ? { ...args, profile: cappedEcho(args['profile']) }
    : args;
}

/**
 * A caller-supplied `--profile` is validated HERE, before anything is sent, and
 * the daemon runs the SAME resolver again on the payload it receives (a value
 * off the wire is not trusted). `resolveProfileName` folds to lower case, so the
 * canonical name is what travels, and the fold is reported rather than silent —
 * the contract `login` honours.
 */
function resolveWebProfile(command: string, args: Record<string, unknown>): ProfileOutcome {
  if (typeof args['profile'] !== 'string') {
    return { args, warnings: [], envelope: null };
  }
  const typed = args['profile'];
  let profile: string;
  try {
    profile = resolveProfileName(typed);
  } catch (error) {
    return {
      args,
      warnings: [],
      envelope: fail(
        command,
        'WEB_PROFILE_NAME_INVALID',
        profileRefusal(error),
        {},
        PROFILE_NEXT_ACTIONS
      )
    };
  }
  const warnings =
    profile === typed
      ? []
      : [`--profile ${JSON.stringify(cappedEcho(typed))} resolved to the profile "${profile}"`];
  return { args: { ...args, profile }, warnings, envelope: null };
}

/**
 * Ensure the daemon and invoke one op. The daemon reads `projectRoot` back from
 * `daemon.json` — the record it itself wrote — and that round-trip is the only
 * path that survives the macOS `/var` <-> `/private/var` symlink: the writer's
 * prefix may not match `projectRoot` resolved from `process.cwd()` (the kernel
 * resolves symlinks on `chdir`), and the integration test asserts on that exact
 * round-tripped value.
 */
async function callWebDaemon(
  op: WebOp,
  args: Record<string, unknown>,
  projectRoot: string,
  sessionId: string
): Promise<WebOpResponse<Record<string, unknown>>> {
  const info = await ensureDaemon(projectRoot, sessionId);
  return new WebDaemonClient(info).call<Record<string, unknown>>(
    op,
    {
      ...args,
      dispatchId: process.env['PEAKS_DISPATCH_ID'] ?? 'current',
      projectRoot: info.projectRoot,
      sessionId
    },
    OP_TIMEOUT_MS
  );
}
