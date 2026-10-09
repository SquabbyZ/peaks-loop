// src/cli/commands/web-op-refusals.ts
//
// How a `peaks web` op refuses: the diagnostic channel, the daemon failure
// envelope, and the refused-`--profile` pair of sentences. Split out of
// `web-commands.ts`; every wrap, every cap and every sentence is unchanged.

import { fail } from 'peaks-loop-shared/result';

import { capText, MAX_TEXT_BYTES } from '../../services/web/bounded-output.js';
import { wrapUntrusted } from '../../services/web/untrusted-envelope.js';
import type { WebOp } from '../../services/web/web-protocol.js';
import { getErrorMessage } from '../cli-helpers.js';
import { text } from './web-command-shared.js';

/**
 * What a caller can do after a refused `--profile` — the same sentence `login`
 * gives, because it is the same mistake and the same verb fixes it.
 */
export const PROFILE_NEXT_ACTIONS = [
  'Re-run with a name matching [a-z0-9._-], 1-64 chars',
  'Or run `peaks web login --profile <name>` to create that profile'
];

/**
 * The resolver's own message begins with the code, and `fail()` puts the code in
 * front of the message again — strip it, so human output does not read
 * `WEB_PROFILE_NAME_INVALID: WEB_PROFILE_NAME_INVALID: …` (the `login` verb does
 * the same).
 */
export function profileRefusal(error: unknown): string {
  return getErrorMessage(error).replace(/^WEB_PROFILE_NAME_INVALID:\s*/, '');
}

/**
 * A daemon- or page-derived diagnostic is DATA, never an instruction: it is
 * byte-capped and wrapped before it can reach `message` or `warnings` (AC4 /
 * R4 — the envelope must cover the diagnostic channel, not only `data`).
 *
 * This matters because Playwright's own error messages embed the matched
 * elements' HTML, so a page with two elements matching a selector can put
 * arbitrary text on a channel the CLI would otherwise print verbatim to stdout.
 */
function wrapDiagnostic(raw: unknown): string {
  const capped = capText(text(raw), MAX_TEXT_BYTES).text;
  return capped === '' ? '' : wrapUntrusted(capped);
}

/** Every daemon warning, capped and wrapped. Empty entries are dropped. */
export function wrapDiagnostics(values: readonly string[]): string[] {
  return values.map((value) => wrapDiagnostic(value)).filter((value) => value !== '');
}

/**
 * Our own static sentence, then the daemon's own words as a wrapped, capped
 * block. The daemon's `nextActions` are folded into that block rather than
 * forwarded: `printResult` prints `nextActions` to STDOUT as `next: …`, the
 * channel the notice calls instruction, and the daemon's text is not ours to
 * promote there.
 */
export function failureMessage(
  op: WebOp,
  message: unknown,
  nextActions: readonly string[]
): string {
  const detail = [text(message), ...nextActions.map((action) => text(action))]
    .filter((line) => line !== '')
    .join('\n');
  const wrapped = wrapDiagnostic(detail);
  return wrapped === ''
    ? `peaks web ${op} failed in the daemon`
    : `peaks web ${op} failed in the daemon\n${wrapped}`;
}

/**
 * A daemon-supplied `code` is printed on the envelope's first line, so only a
 * protocol-shaped identifier is accepted; anything else falls back to ours.
 */
export function safeDaemonCode(value: unknown): string {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value)
    ? value
    : 'WEB_OP_FAILED';
}

/** The unusable-daemon envelope: a named code, or the generic op failure. */
export function daemonFailureEnvelope(input: {
  readonly op: WebOp;
  readonly command: string;
  readonly code: string;
  readonly message: unknown;
  readonly nextActions: readonly string[];
}): ReturnType<typeof fail> {
  return fail(
    input.command,
    input.code,
    failureMessage(input.op, input.message, input.nextActions),
    {},
    []
  );
}
