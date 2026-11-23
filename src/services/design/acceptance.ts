/**
 * What `--allow-source-only` may record, and what it must refuse (spec §7.1 Q3).
 *
 * A source-only pass stands in for a render check the slice never ran, so it
 * is a human act: the note is the user's own words, the session names who
 * accepted, and an unattended run cannot record one. The CLI turns a refusal
 * into the usage exit code; the decision itself lives here, with no CLI types.
 */

import { getSessionId, getSessionIdCanonical } from '../session/session-manager.js';

export type AcceptanceRefusal = {
  readonly code: string;
  readonly message: string;
  readonly actions: string[];
};

export type AcceptanceInput = {
  readonly acceptNote?: string | undefined;
  readonly sessionId?: string | undefined;
};

/** The environment variable the interactive-only rule reads, so a test can pin it. */
export type AcceptanceEnv = { readonly CI?: string | undefined };

export const ACCEPT_NOTE_REQUIRED = 'DESIGN_ACCEPT_NOTE_REQUIRED';
export const SOURCE_ONLY_NOT_INTERACTIVE = 'DESIGN_SOURCE_ONLY_NOT_INTERACTIVE';
export const ACCEPT_NOTE_MESSAGE =
  "--allow-source-only requires --accept-note with the user's own words.";
export const ACCEPT_NOTE_ACTIONS = [
  'Ask the user to state the acceptance in their own words, then pass it verbatim.'
];
export const SOURCE_ONLY_DIAGNOSTIC =
  '--source-only reports the G1 layer only and never produces a pass; record an acceptance with --allow-source-only --accept-note "<the user\'s words>".';

const SOURCE_ONLY_ACTIONS = [
  'Ask the user to accept source-only interactively, then re-run with --session-id.'
];
const SOURCE_ONLY_CI_MESSAGE =
  '--allow-source-only is interactive-only: an unattended run cannot record an acceptance.';
const SOURCE_ONLY_SESSION_MESSAGE =
  '--allow-source-only needs a session: pass --session-id, or run from a project with an active session binding.';

/**
 * The session `peaks session info --active` reports, or null when the project
 * has no binding. The check records this id when `--session-id` is absent, so
 * the documented interactive invocation needs no extra flag.
 */
export function activeSessionId(projectRoot: string): string | null {
  return getSessionIdCanonical(projectRoot) ?? getSessionId(projectRoot);
}

/** The next action each blocked check code offers; `pass` and `fail` carry their own. */
export const CHECK_BLOCKED_ACTIONS: Record<string, string[]> = {
  DESIGN_RENDER_NOT_IMPLEMENTED: [
    'Ask the user whether to accept source-only; re-run with --allow-source-only and --accept-note "<their words>".'
  ],
  DESIGN_CHANGE_SET_UNKNOWN: [
    'Supply --files, or --rid with --session-id, or a --base ref so the change set is known.'
  ],
  DESIGN_SOURCE_CHECK_DEGRADED: [
    'Move the changed pages under design/paved-road.json pageRoots, or narrow --files to files the source scanner covers.'
  ],
  DESIGN_CONTRACT_INVALID: ['Run `peaks design init` to rewrite design/tokens.json.']
};

const ciIsSet = (value: string | undefined): boolean =>
  value !== undefined && value !== '' && value !== '0' && value.toLowerCase() !== 'false';

/** Null when the acceptance may be recorded; otherwise the usage refusal. */
export function acceptanceRefusal(
  input: AcceptanceInput,
  ci: string | undefined
): AcceptanceRefusal | null {
  if (ciIsSet(ci)) {
    return {
      code: SOURCE_ONLY_NOT_INTERACTIVE,
      message: SOURCE_ONLY_CI_MESSAGE,
      actions: SOURCE_ONLY_ACTIONS
    };
  }
  if ((input.sessionId ?? '').trim() === '') {
    return {
      code: SOURCE_ONLY_NOT_INTERACTIVE,
      message: SOURCE_ONLY_SESSION_MESSAGE,
      actions: SOURCE_ONLY_ACTIONS
    };
  }
  if ((input.acceptNote ?? '').trim() === '') {
    return {
      code: ACCEPT_NOTE_REQUIRED,
      message: ACCEPT_NOTE_MESSAGE,
      actions: ACCEPT_NOTE_ACTIONS
    };
  }
  return null;
}
