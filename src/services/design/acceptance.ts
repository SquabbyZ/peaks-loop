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

/** The sentence each blocked check code reports; `blockedMessage` falls back to the code. */
export const CHECK_BLOCKED_MESSAGES: Record<string, string> = {
  DESIGN_ENGINE_UNAVAILABLE: 'designlang is not installed; it is a hard dependency of peaks-loop.',
  DESIGN_ENGINE_VERSION_UNSUPPORTED:
    'The installed designlang major is not the one this adapter was written against.',
  DESIGN_BROWSER_UNAVAILABLE:
    'No Chromium or system Chrome was found; install a browser (peaks never downloads one).',
  DESIGN_RENDER_URL_MISSING:
    'No render URL is configured: pass --url, set PEAKS_DESIGN_URL, or record render.url or render.port in design/engine.json.',
  DESIGN_URL_UNTRUSTED:
    'The render URL or page is outside the trust boundary: use a loopback URL, or record this exact URL as render.url in design/engine.json.',
  DESIGN_RENDER_UNREACHABLE: 'The render URL did not answer; start the app or re-run with --start.',
  DESIGN_RENDER_NO_EVIDENCE:
    'A designlang check exited 0 without its JSON evidence; the render verdict cannot pass.',
  DESIGN_START_COMMAND_MISSING:
    'No render.startCommand is recorded in design/engine.json; record one or start the app yourself.',
  DESIGN_START_COMMAND_EXITED:
    'The start command exited before the render URL answered; fix the command or start the app yourself.',
  DESIGN_START_NOT_ALLOWED:
    'design/engine.json records startPolicy "never"; only a policy of "on-request" allows --start.',
  DESIGN_SESSION_ID_INVALID:
    'The session id used for the grade output must be a single path segment (no "..", "/", or "\\").',
  DESIGN_CONTRACT_INVALID:
    'design/tokens.json or design/engine.json is invalid; run `peaks design init` to rewrite both.'
};

export function blockedMessage(code: string): string {
  return CHECK_BLOCKED_MESSAGES[code] ?? code;
}

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

/** The next action each blocked check code offers; `pass` and `fail` carry their own. */
export const CHECK_BLOCKED_ACTIONS: Record<string, string[]> = {
  DESIGN_RENDER_REQUIRED: [
    'Re-run without --source-only to run G2, or record an acceptance with --allow-source-only and --accept-note "<their words>".'
  ],
  DESIGN_ENGINE_UNAVAILABLE: [
    'Install peaks-loop dependencies so designlang resolves; it is a hard dependency.'
  ],
  DESIGN_ENGINE_VERSION_UNSUPPORTED: [
    'Update peaks-loop or designlang so the installed major matches the adapter.'
  ],
  DESIGN_BROWSER_UNAVAILABLE: [
    'Install Chrome or Chromium (peaks never downloads a browser), then re-run the check.'
  ],
  DESIGN_RENDER_URL_MISSING: [
    'Pass --url, set PEAKS_DESIGN_URL, or record render.url or render.port in design/engine.json.'
  ],
  DESIGN_URL_UNTRUSTED: [
    'Use a loopback URL, or record the exact URL as render.url in design/engine.json.'
  ],
  DESIGN_RENDER_UNREACHABLE: [
    'Start the app, or record render.startCommand and re-run with --start.'
  ],
  DESIGN_RENDER_NO_EVIDENCE: [
    'Run the designlang check by hand to see why it printed no JSON, then re-run the check.'
  ],
  DESIGN_START_COMMAND_MISSING: [
    'Record render.startCommand with `peaks design init --start <command>`, or start the app yourself.'
  ],
  DESIGN_START_COMMAND_EXITED: [
    'Fix the recorded start command so it keeps running, then re-run with --start.'
  ],
  DESIGN_START_NOT_ALLOWED: [
    'Re-run `peaks design init --start <command>` so the policy is on-request, or start the app yourself.'
  ],
  DESIGN_SESSION_ID_INVALID: [
    'Pass --session-id with a single path segment (no ".." or path separators).'
  ],
  DESIGN_CHANGE_SET_UNKNOWN: [
    'Supply --files, or --rid with --session-id, or a --base ref so the change set is known.'
  ],
  DESIGN_SOURCE_CHECK_DEGRADED: [
    'Move the changed pages under design/paved-road.json pageRoots, or narrow --files to files the source scanner covers.'
  ],
  DESIGN_CONTRACT_INVALID: [
    'Run `peaks design init` to rewrite design/tokens.json and design/engine.json.'
  ],
  DESIGN_BASELINE_INVALID: [
    'Re-record the route baseline on a green run: schemaVersion 1 plus route, baseCommit and baselineUrl.'
  ],
  DESIGN_FIDELITY_MIN_INVALID: [
    'Pass --min as an integer 0..100 (the G3a default is 90), then re-run the check.'
  ],
  DESIGN_FIDELITY_URL_UNREACHABLE: [
    'Start the baseline and candidate renders; both must answer HTTP 200 before the comparison runs.'
  ],
  DESIGN_FIDELITY_NO_EVIDENCE: [
    'Run `designlang fidelity` by hand to see why it wrote no fidelity.json, then re-run the check.'
  ],
  DESIGN_FIDELITY_SELF_COMPARE: [
    'Point the baseline at a render of the base revision, not at the candidate URL.'
  ],
  DESIGN_RUBRIC_MISSING: [
    'Ask peaks-ui to write the archetype rubric under the session design directory, then re-run.'
  ],
  DESIGN_RUBRIC_INVALID: [
    'Ask peaks-ui to fix the rubric envelope (schemaVersion 1, matching rid/archetype, six 1-5 scores).'
  ]
};

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
