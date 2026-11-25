/**
 * The sentence and the next action each blocked design check code reports.
 *
 * Extracted verbatim from `acceptance.ts` (S6 round 6) so the new
 * `DESIGN_ROUTE_MISMATCH` entry fits the file-size cap. Mechanical move only —
 * `acceptance.ts` re-exports every symbol from its original path, so no caller
 * changes. A blocked code with no next action tells the LLM nothing to do, so
 * the two records are kept side by side and every code is registered in both.
 */

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
  DESIGN_PAGE_UNUSABLE:
    'The page cannot be judged: it is blank, redirected to a sign-in wall, or rendered no text. An unusable page is blocked, never a fail.',
  DESIGN_ROUTE_MISMATCH:
    'The page did not render the route under check: its identity text, or the marker design/paved-road.json declared for the route, did not match. A route mismatch is blocked, never a fail.',
  DESIGN_RENDER_RETRYABLE:
    'designlang could not navigate the page before its budget elapsed; this is retryable — start the app and re-run the check.',
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
  DESIGN_PAGE_UNUSABLE: [
    'Start the app, open the exact page URL yourself, and point --url at a route that renders its content.'
  ],
  DESIGN_ROUTE_MISMATCH: [
    'Open the exact page URL yourself and confirm it renders the route under check; fix the route or sign in, or declare the marker design/paved-road.json routeMarkers matches in the page title or a heading.'
  ],
  DESIGN_RENDER_RETRYABLE: [
    'Start the app so the page answers, then re-run the check; a navigation timeout is not a design verdict.'
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
