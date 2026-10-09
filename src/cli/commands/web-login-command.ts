// src/cli/commands/web-login-command.ts
//
// `peaks web login --profile <name>` — the only path that persists a login.
// Split out of `web-lifecycle-commands.ts`; the verb name, its options, the
// gate-first order, the fold notices and every envelope shape are unchanged.

import type { Command } from 'commander';
import { fail, getErrorMessage, ok, type ResultEnvelope } from 'peaks-loop-shared/result';
import { degradedEnvelope } from '../../services/web/web-fallback.js';
import { isWebDisabled } from '../../services/web/web-install-service.js';
import {
  cappedEcho,
  loginStorageStatePath,
  resolveProfileName,
  runHeadedLogin
} from '../../services/web/web-login-profile.js';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';

/** The `degradedEnvelope` tier a disabled-web refusal reports (tech-doc §5.1). */
const WEB_DISABLED_TIER = 3;

/** What a caller can actually do after a refusal or an unclosed login. */
const LOGIN_NEXT_ACTIONS = [
  'Re-run `peaks web login --profile <name>` when the user is ready to log in',
  'Close the headed browser window when the login is finished — closing it is what saves the session'
];

/**
 * The fold, said out loud on the one path that CANNOT fold (S4 repair, code F5 /
 * security S5).
 *
 * The gate is statement #1 (tech-doc §5.1), so on this path the name was never
 * validated and never folded — which is exactly why this refusal must not look
 * like it disagrees with a live run about the profile. It reports what happened
 * (nothing was folded, this is what was typed) rather than implying a canonical
 * name was used, and it claims nothing about whether the name would be accepted.
 * The echo is capped by the same helper the guard uses.
 */
function gateFoldNotice(rawProfile: string | undefined): string[] {
  if (rawProfile === undefined || rawProfile === rawProfile.toLowerCase()) {
    return [];
  }
  return [
    `--profile ${JSON.stringify(cappedEcho(rawProfile))} was NOT folded: PEAKS_WEB_DISABLED is ` +
      'checked before the profile name, so this refusal echoes what was typed, not a canonical ' +
      'profile. A run that gets past the gate lower-cases the name first.'
  ];
}

/** The disabled-web refusal, with the fold notice appended when there is one. */
function webDisabledLoginEnvelope(rawProfile: string | undefined): ResultEnvelope<unknown> {
  const gateEnvelope = degradedEnvelope(
    'login',
    'PEAKS_WEB_DISABLED=1',
    WEB_DISABLED_TIER,
    rawProfile === undefined ? {} : { profile: cappedEcho(rawProfile) }
  );
  return { ...gateEnvelope, warnings: [...gateEnvelope.warnings, ...gateFoldNotice(rawProfile)] };
}

function profileRequiredEnvelope(): ReturnType<typeof fail> {
  return fail(
    'peaks.web.login',
    'WEB_PROFILE_REQUIRED',
    '`peaks web login` requires --profile <name>: it is the only verb that persists a login, ' +
      'and there is no default profile — without a name nothing is written',
    {},
    LOGIN_NEXT_ACTIONS
  );
}

/**
 * `resolveProfileName`'s canonical name, or the refusal envelope to print.
 * The helper's own message already begins with the code, and `fail()` puts the
 * code in front of the message again — strip it, so human output does not read
 * `WEB_PROFILE_NAME_INVALID: WEB_PROFILE_NAME_INVALID: …`.
 */
function resolveLoginProfile(
  rawProfile: string
): { profile: string } | { refusal: ReturnType<typeof fail> } {
  try {
    return { profile: resolveProfileName(rawProfile) };
  } catch (error) {
    const detail = getErrorMessage(error).replace(/^WEB_PROFILE_NAME_INVALID:\s*/, '');
    return {
      refusal: fail('peaks.web.login', 'WEB_PROFILE_NAME_INVALID', detail, {}, LOGIN_NEXT_ACTIONS)
    };
  }
}

/**
 * The two sides are deliberately not the same value — the left is what the
 * caller TYPED (echoed through `cappedEcho`, since it is still caller input),
 * the right is the canonical name the run uses from here on.
 */
function loginFoldWarnings(rawProfile: string, profile: string): string[] {
  return rawProfile === profile
    ? []
    : [`--profile ${JSON.stringify(cappedEcho(rawProfile))} resolved to the profile "${profile}"`];
}

/** The headed-browser instructions the user reads while the login is open. */
function announceHeadedLogin(io: ProgramIO, profile: string): () => void {
  return () => {
    io.stderr(
      [
        `peaks web login: a headed browser is open for profile "${profile}" — log in there yourself.`,
        'Close the browser window when you are done: that is what saves the session, to ' +
          `${loginStorageStatePath(profile)}.`,
        'The session is captured while the window is open, so the saved state can be up to a ' +
          'second older than what you see — finish logging in before you close it.'
      ].join('\n')
    );
  };
}

type LoginOutcome = Awaited<ReturnType<typeof runHeadedLogin>>;

/**
 * S1's F1. This is the ONLY path on which the runner returns `ok: false` AND a
 * warning (a login whose context never opened and whose headed browser then
 * refused to close — a browser nothing can then stop, because `stop` is
 * daemon-scoped). `fail()` hard-codes `warnings: []`, so the warning is spread
 * back over it, the shape `degradedEnvelope` uses.
 */
function loginFailedEnvelope(
  command: string,
  outcome: LoginOutcome,
  foldWarnings: readonly string[]
): ResultEnvelope<unknown> {
  return {
    ...fail(command, outcome.code, outcome.message, {}, LOGIN_NEXT_ACTIONS),
    warnings: [...foldWarnings, ...outcome.warnings]
  };
}

/**
 * The success envelope — counts, never the values: the file holds live session
 * cookies and this envelope reaches a terminal (and a transcript).
 *
 * R5: a capture that was written but could not be read back is `ok` — the file
 * did land, so it is not a failure — but it is not a clean success either. The
 * code is what an ok-only consumer cannot miss.
 */
function loginResultEnvelope(
  command: string,
  outcome: LoginOutcome,
  foldWarnings: readonly string[]
): ResultEnvelope<unknown> {
  const envelope = ok(
    command,
    {
      profile: outcome.profile,
      storageStatePath: outcome.storageStatePath,
      bytes: outcome.bytes,
      cookies: outcome.cookies,
      origins: outcome.origins
    },
    [...foldWarnings, ...outcome.warnings]
  );
  return outcome.code === '' ? envelope : { ...envelope, code: outcome.code };
}

/**
 * The catch-all failure envelope. A run that reached `resolveProfileName` knows
 * the canonical name, so a failure before the browser was even up reports the
 * fold like every other path (S4 repair, code F5 / security S5).
 */
function loginThrewEnvelope(
  command: string,
  error: unknown,
  foldWarnings: readonly string[]
): ResultEnvelope<unknown> {
  return {
    ...fail(
      command,
      'WEB_LOGIN_FAILED',
      `peaks web login failed: ${getErrorMessage(error)}`,
      {},
      LOGIN_NEXT_ACTIONS
    ),
    warnings: [...foldWarnings]
  };
}

/**
 * `peaks web login --profile <name>` — the only path that persists a login
 * (design §2/§5, PRD R7).
 *
 * `--profile` is enforced HERE rather than with commander's `requiredOption`,
 * because `requiredOption` refuses before this handler runs — and then the
 * `PEAKS_WEB_DISABLED` gate would no longer be statement #1 (tech-doc §5.1,
 * AC5). A profile-less login refuses without touching the profile root: no
 * directory, no storage state, no browser.
 */
export async function runWebLogin(
  io: ProgramIO,
  asJson: boolean,
  rawProfile: string | undefined
): Promise<void> {
  const command = 'peaks.web.login';
  // Declared out here so the CATCH can report it too (S4 repair, security S5 /
  // code F3): a launch failure happens AFTER the name was resolved, so a run
  // that dies on `WEB_LAUNCH_FAILED` knows the canonical name just as well as
  // one that succeeds, and must not be the one path where the fold is silent.
  let foldWarnings: string[] = [];
  try {
    if (isWebDisabled(process.env)) {
      printResult(io, webDisabledLoginEnvelope(rawProfile), asJson);
      process.exitCode = 1;
      return;
    }

    if (rawProfile === undefined || rawProfile === '') {
      printResult(io, profileRequiredEnvelope(), asJson);
      process.exitCode = 1;
      return;
    }

    const resolved = resolveLoginProfile(rawProfile);
    if ('refusal' in resolved) {
      printResult(io, resolved.refusal, asJson);
      process.exitCode = 1;
      return;
    }
    const profile = resolved.profile;

    foldWarnings = loginFoldWarnings(rawProfile, profile);

    const outcome = await runHeadedLogin({
      profile,
      announce: announceHeadedLogin(io, profile)
    });

    if (!outcome.ok) {
      printResult(io, loginFailedEnvelope(command, outcome, foldWarnings), asJson);
      process.exitCode = 1;
      return;
    }

    printResult(io, loginResultEnvelope(command, outcome, foldWarnings), asJson);
  } catch (error) {
    printResult(io, loginThrewEnvelope(command, error, foldWarnings), asJson);
    process.exitCode = 1;
  }
}

export function registerWebLoginCommand(web: Command, io: ProgramIO): void {
  addJsonOption(
    web
      .command('login')
      .description(
        'Open a HEADED browser so the user can log in themselves, then persist that session to ' +
          '~/.peaks/web-profiles/<name>/storageState.json. Run it only when the user asks for a ' +
          'persistent login: it writes live session cookies to disk. --profile is required, and ' +
          'without it nothing is persisted.'
      )
      .option(
        '--profile <name>',
        'the login profile to persist (required; [a-z0-9._-], 1-64 chars — upper case folds to lower)'
      )
  ).action((options: { json?: boolean; profile?: string }) =>
    runWebLogin(io, options.json === true, options.profile)
  );
}
