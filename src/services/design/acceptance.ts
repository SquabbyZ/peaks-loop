/**
 * What `--allow-source-only` may record, what the check refuses, and the text
 * every blocked code reports (spec §7.1 Q3).
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
export const EXEMPLAR_NOT_INTERACTIVE = 'DESIGN_EXEMPLAR_NOT_INTERACTIVE';
/** Which acceptance the refusal is about; both follow the same interactive-only rule. */
export type AcceptanceKind = 'source-only' | 'exemplar';
export const ACCEPT_NOTE_MESSAGE =
  "--allow-source-only requires --accept-note with the user's own words.";
export const EXEMPLAR_NOTE_MESSAGE =
  "--skip-exemplar requires --accept-note with the user's own words.";
export const ACCEPT_NOTE_ACTIONS = [
  'Ask the user to state the acceptance in their own words, then pass it verbatim.'
];
export const SOURCE_ONLY_DIAGNOSTIC =
  '--source-only reports the G1 layer only and never produces a pass; record an acceptance with --allow-source-only --accept-note "<the user\'s words>".';

/** The S1/G2 refusal text: one sentence per blocked code, so the CLI never invents one. */
export const NOT_ADOPTED_MESSAGE =
  'No design contract is adopted for this app; run `peaks design init` first.';
export const CHANGE_SET_UNKNOWN_MESSAGE =
  'The change set is empty, unreadable, or names no file in this app; an empty change set is blocked, not a pass.';
export const RENDER_REQUIRED_MESSAGE =
  'G2 (render) did not run; a design check needs a render verdict. Re-run without --source-only, or record an acceptance with --allow-source-only --accept-note.';
export const DEGRADED_MESSAGE =
  'The changed UI files could not be read by the source scanner (unsupported file family, deleted file, or outside pageRoots); a zero-file scan is blocked, never a pass.';
export const CONTRACT_INVALID_MESSAGE =
  'design/tokens.json has no usable token groups; run `peaks design init` to rewrite design/tokens.json and design/engine.json.';
/** Every changed file is excluded, so the scan has nothing to judge (not a block). */
export const EXCLUDED_MESSAGE =
  'Every changed file is covered by an exclude entry in design/paved-road.json; there is nothing in this change set for the source scan to judge.';

/** The result overrides an empty change set earns: excluded is not-applicable, else blocked. */
export function emptyChangeSetOverrides(
  failure: string | null,
  allExcluded: boolean
): { verdict: 'blocked' | 'not-applicable'; errorCode?: string; message: string } {
  if (allExcluded) return { verdict: 'not-applicable', message: EXCLUDED_MESSAGE };
  return {
    verdict: 'blocked',
    errorCode: 'DESIGN_CHANGE_SET_UNKNOWN',
    message: failure ?? CHANGE_SET_UNKNOWN_MESSAGE
  };
}

/** An acceptance without the user's own words is a usage error, never a verdict. */
export class DesignCheckUsageError extends Error {
  readonly code = 'DESIGN_ACCEPT_NOTE_REQUIRED';
  constructor() {
    super("--allow-source-only requires --accept-note with the user's own words.");
    this.name = 'DesignCheckUsageError';
  }
}

/** Throw the usage error when a source-only acceptance has no note. */
export function requireAcceptNote(input: {
  readonly allowSourceOnly?: boolean | undefined;
  readonly acceptNote?: string | undefined;
}): void {
  if (input.allowSourceOnly === true && (input.acceptNote ?? '').trim() === '') {
    throw new DesignCheckUsageError();
  }
}

/**
 * `--baseline-url` names ONE route's baseline, so it is a usage error when the
 * change touches more routes than that: the alternative is comparing every
 * route against one page. The CLI maps this to the usage exit code and writes
 * nothing.
 */
export class DesignBaselineUrlScopeError extends Error {
  readonly code = 'DESIGN_BASELINE_URL_SCOPE';
  readonly actions = ["Run the check once per changed route, passing that route's baseline URL."];

  constructor(routes: readonly string[]) {
    const touched =
      routes.length === 0 ? 'no changed route' : `${String(routes.length)} (${routes.join(', ')})`;
    super(
      `--baseline-url applies only when exactly one changed route is in scope; this change has ` +
        `${touched}. Record each baseline in the baseline store instead, or check one route at a time.`
    );
    this.name = 'DesignBaselineUrlScopeError';
  }
}

/**
 * What each blocked check code reports and the next action it offers live in
 * `check-blocked.ts`; they are re-exported here so every caller keeps its path.
 */
export { CHECK_BLOCKED_ACTIONS, CHECK_BLOCKED_MESSAGES, blockedMessage } from './check-blocked.js';

const SOURCE_ONLY_ACTIONS = [
  'Ask the user to accept source-only interactively, then re-run with --session-id.'
];
const EXEMPLAR_ACTIONS = [
  'Ask the user to accept skipping the exemplar check, then re-run with --session-id.'
];
const SOURCE_ONLY_CI_MESSAGE =
  '--allow-source-only is interactive-only: an unattended run cannot record an acceptance.';
const SOURCE_ONLY_SESSION_MESSAGE =
  '--allow-source-only needs a session: pass --session-id, or run from a project with an active session binding.';
const EXEMPLAR_CI_MESSAGE =
  '--skip-exemplar is interactive-only: an unattended run cannot record an acceptance.';
const EXEMPLAR_SESSION_MESSAGE =
  '--skip-exemplar needs a session: pass --session-id, or run from a project with an active session binding.';

type AcceptanceText = {
  readonly code: string;
  readonly ciMessage: string;
  readonly sessionMessage: string;
  readonly noteMessage: string;
  readonly actions: string[];
  readonly noteActions: string[];
};

/** The refusal text for one acceptance flag; the rule itself is shared. */
function acceptanceText(kind: AcceptanceKind): AcceptanceText {
  if (kind === 'exemplar') {
    return {
      code: EXEMPLAR_NOT_INTERACTIVE,
      ciMessage: EXEMPLAR_CI_MESSAGE,
      sessionMessage: EXEMPLAR_SESSION_MESSAGE,
      noteMessage: EXEMPLAR_NOTE_MESSAGE,
      actions: EXEMPLAR_ACTIONS,
      noteActions: EXEMPLAR_ACTIONS
    };
  }
  return {
    code: SOURCE_ONLY_NOT_INTERACTIVE,
    ciMessage: SOURCE_ONLY_CI_MESSAGE,
    sessionMessage: SOURCE_ONLY_SESSION_MESSAGE,
    noteMessage: ACCEPT_NOTE_MESSAGE,
    actions: SOURCE_ONLY_ACTIONS,
    noteActions: ACCEPT_NOTE_ACTIONS
  };
}

/**
 * The session `peaks session info --active` reports, or null when the project
 * has no binding. The check records this id when `--session-id` is absent, so
 * the documented interactive invocation needs no extra flag.
 */
export function activeSessionId(projectRoot: string): string | null {
  return getSessionIdCanonical(projectRoot) ?? getSessionId(projectRoot);
}

const ciIsSet = (value: string | undefined): boolean =>
  value !== undefined && value !== '' && value !== '0' && value.toLowerCase() !== 'false';

/** Null when the acceptance may be recorded; otherwise the usage refusal. */
export function acceptanceRefusal(
  input: AcceptanceInput,
  ci: string | undefined,
  kind: AcceptanceKind = 'source-only'
): AcceptanceRefusal | null {
  const text = acceptanceText(kind);
  if (ciIsSet(ci)) {
    return { code: text.code, message: text.ciMessage, actions: text.actions };
  }
  if ((input.sessionId ?? '').trim() === '') {
    return { code: text.code, message: text.sessionMessage, actions: text.actions };
  }
  if ((input.acceptNote ?? '').trim() === '') {
    return { code: ACCEPT_NOTE_REQUIRED, message: text.noteMessage, actions: text.noteActions };
  }
  return null;
}
