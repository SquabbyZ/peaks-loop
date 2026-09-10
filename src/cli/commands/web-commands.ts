/**
 * `peaks web open|text|snap|click|shot|metrics` — the S1 command surface.
 *
 * Layer rule (tech-doc §1.1): this file owns commander wiring, option parsing,
 * `--json`, `printResult` and `process.exitCode`. It owns ZERO path
 * construction and ZERO Playwright calls — those live in `src/services/web/*`.
 *
 * The envelope is built once, in `runWebOp`, and that is also the single place
 * `WRAPPED_OPS` is applied — one place, not six. Every page- or daemon-derived
 * string that leaves this process (payload, diagnostic, warning) is capped and
 * wrapped here, because this is the boundary the model actually reads.
 */
import type { Command } from 'commander';
import { fail, getErrorMessage, ok, type ResultEnvelope } from 'peaks-loop-shared/result';

import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { getCurrentSessionId } from '../../services/skills/skill-presence-service.js';
import { capText, MAX_TEXT_BYTES } from '../../services/web/bounded-output.js';
import { ensureDaemon } from '../../services/web/daemon-supervisor.js';
import { wrapUntrusted, WRAPPED_OPS } from '../../services/web/untrusted-envelope.js';
import { WebDaemonClient } from '../../services/web/web-client.js';
import { degradedEnvelope } from '../../services/web/web-fallback.js';
import { isWebDisabled } from '../../services/web/web-install-service.js';
import { cappedEcho, resolveProfileName } from '../../services/web/web-login-profile.js';
import type { WebOp } from '../../services/web/web-protocol.js';
import {
  addJsonOption,
  printResult,
  redactSensitiveErrorMessage,
  type ProgramIO
} from '../cli-helpers.js';
import { registerWebLifecycleCommands } from './web-lifecycle-commands.js';

/** A browser op is user-visible latency; 30 s is generous but bounded. */
const OP_TIMEOUT_MS = 30_000;

interface VerbSpec {
  readonly name: string;
  readonly op: WebOp;
  readonly description: string;
  readonly argument: { readonly name: string; readonly description: string } | null;
  /**
   * `--profile <name>` — declared on `open` and nowhere else (design §2 lists it
   * only there). Any other verb taking a profile would invent behaviour nobody
   * asked for and multiply the isolation questions for no requested benefit.
   */
  readonly takesProfile?: true;
  readonly toArgs: (
    positional: readonly (string | undefined)[],
    profile: string | undefined
  ) => Record<string, unknown>;
}

/**
 * The option text names the read-only half out loud: a caller who browses with a
 * profile must not assume the profile was refreshed by it.
 */
const PROFILE_OPTION_DESCRIPTION =
  'navigate with a saved login profile (`peaks web login --profile <name>`): [a-z0-9._-], ' +
  '1-64 chars, upper case folds to lower. The profile is READ-ONLY here — this run loads it ' +
  'and never writes it back, so browser activity is not saved into it.';

const WEB_VERBS: readonly VerbSpec[] = [
  {
    name: 'open',
    op: 'open',
    description:
      'Navigate the dispatch browser context to <url>. With --profile, the page loads that ' +
      'saved login.',
    argument: { name: '<url>', description: 'absolute URL to load' },
    takesProfile: true,
    toArgs: (positional, profile) => ({
      url: positional[0] ?? '',
      ...(profile === undefined ? {} : { profile })
    })
  },
  {
    name: 'text',
    op: 'text',
    description: 'Return the visible text of the page (or of [selector]), byte-capped.',
    argument: { name: '[selector]', description: 'CSS selector (default: body)' },
    toArgs: (positional) => ({ selector: positional[0] })
  },
  {
    name: 'snap',
    op: 'snap',
    description: 'Return a pruned ARIA snapshot of the page (or of [selector]), byte-capped.',
    argument: { name: '[selector]', description: 'CSS selector (default: body)' },
    toArgs: (positional) => ({ selector: positional[0] })
  },
  {
    name: 'click',
    op: 'click',
    description: 'Click the element matching <selector> in the dispatch browser context.',
    argument: { name: '<selector>', description: 'CSS selector to click' },
    toArgs: (positional) => ({ selector: positional[0] ?? '' })
  },
  {
    name: 'shot',
    op: 'shot',
    description: 'Screenshot the page (or [selector]) into the session web/ directory.',
    argument: { name: '[selector]', description: 'CSS selector (default: full page)' },
    toArgs: (positional) => ({ selector: positional[0] })
  },
  {
    name: 'metrics',
    op: 'metrics',
    description: 'Return Core Web Vitals for the dispatch page, or why they are unavailable.',
    argument: null,
    toArgs: () => ({})
  }
];

export function registerWebCommands(program: Command, io: ProgramIO): void {
  const web = program
    .command('web')
    .description(
      'Bounded, isolated browser access driven by a pinned local Playwright. This is the primary ' +
        'browser path; `peaks playwright` is kept as the MCP fallback. Every artifact lands under ' +
        '.peaks/_runtime/<sessionId>/web/ — never in the project root.'
    );

  for (const verb of WEB_VERBS) {
    const takesArgument = verb.argument !== null;
    let command = web.command(verb.name).description(verb.description);
    if (verb.argument !== null) {
      command = command.argument(verb.argument.name, verb.argument.description);
    }
    if (verb.takesProfile === true) {
      command = command.option('--profile <name>', PROFILE_OPTION_DESCRIPTION);
    }
    command = addJsonOption(command);
    // Commander calls the handler as (…declaredArgs, options, command), so the
    // options object sits at the declared-argument count — not at the end.
    command.action(async (...actionArgs: unknown[]) => {
      const options = actionArgs[takesArgument ? 1 : 0] as
        | { json?: boolean; profile?: string }
        | undefined;
      const rawArgument = actionArgs[0];
      const positional = takesArgument
        ? [typeof rawArgument === 'string' ? rawArgument : undefined]
        : [];
      await runWebOp(io, verb.op, verb.toArgs(positional, options?.profile), options?.json === true);
    });
  }

  registerWebLifecycleCommands(web, io);
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
      // The gate is statement #1, so a `--profile` has NOT been through the
      // resolver yet and is still unbounded caller text. `degradedEnvelope`
      // carries every string arg into the payload, so it is capped here — the
      // same cap the `login` gate applies, for the same reason (S1's bounded
      // output is a property of the envelope, not only of stdout).
      const gateArgs =
        typeof args['profile'] === 'string'
          ? { ...args, profile: cappedEcho(args['profile']) }
          : args;
      printResult(io, degradedEnvelope(op, 'PEAKS_WEB_DISABLED=1', 3, gateArgs), asJson);
      process.exitCode = 1;
      return;
    }

    // A caller-supplied `--profile` is validated HERE, before anything is sent,
    // and the daemon runs the SAME resolver again on the payload it receives (a
    // value off the wire is not trusted). `resolveProfileName` folds to lower
    // case, so the canonical name is what travels, and the fold is reported
    // rather than silent — the contract `login` honours.
    let profile: string | undefined;
    if (typeof args['profile'] === 'string') {
      const typed = args['profile'];
      try {
        profile = resolveProfileName(typed);
      } catch (error) {
        printResult(
          io,
          fail(command, 'WEB_PROFILE_NAME_INVALID', profileRefusal(error), {}, PROFILE_NEXT_ACTIONS),
          asJson
        );
        process.exitCode = 1;
        return;
      }
      if (profile !== typed) {
        foldWarnings = [
          `--profile ${JSON.stringify(cappedEcho(typed))} resolved to the profile "${profile}"`
        ];
      }
    }
    const opArgs: Record<string, unknown> =
      profile === undefined ? args : { ...args, profile };

    const projectRoot = resolveCanonicalProjectRoot(process.cwd());
    const sessionId = getCurrentSessionId(projectRoot);
    if (sessionId === null) {
      printResult(
        io,
        withFold(
          fail(command, 'NO_SESSION', 'No peaks session is bound to this project root', {}, [
            'Bind a session first (the LLM runs `peaks workspace init` on your behalf)'
          ]),
          foldWarnings
        ),
        asJson
      );
      process.exitCode = 1;
      return;
    }

    const info = await ensureDaemon(projectRoot, sessionId);
    const response = await new WebDaemonClient(info).call<Record<string, unknown>>(
      op,
      { ...opArgs, dispatchId: dispatchId(), projectRoot, sessionId },
      OP_TIMEOUT_MS
    );

    if (!response.ok || response.data === null) {
      const code = safeDaemonCode(response.code);
      // The daemon no longer downloads (R3), so "the browser is not installed"
      // arrives as a refusal. It is AC5's tier-3 branch, not an opaque op
      // failure: the caller must be handed the same envelope — MCP tool,
      // install command, screenshot consequence — that the gate produces.
      printResult(
        io,
        code === 'WEB_INSTALL_REQUIRED'
          ? withFold(
              degradedEnvelope(op, `WEB_INSTALL_REQUIRED: ${response.message ?? ''}`, 3, opArgs),
              foldWarnings
            )
          : withFold(
              fail(command, code, failureMessage(op, response.message, response.nextActions), {}, []),
              foldWarnings
            ),
        asJson
      );
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
    printResult(
      io,
      withFold(
        fail(
          command,
          'WEB_OP_FAILED',
          failureMessage(op, redactSensitiveErrorMessage(getErrorMessage(error)), []),
          {},
          []
        ),
        foldWarnings
      ),
      asJson
    );
    process.exitCode = 1;
  }
}

/**
 * What a caller can do after a refused `--profile` — the same sentence `login`
 * gives, because it is the same mistake and the same verb fixes it.
 */
const PROFILE_NEXT_ACTIONS = [
  'Re-run with a name matching [a-z0-9._-], 1-64 chars',
  'Or run `peaks web login --profile <name>` to create that profile'
];

/**
 * The resolver's own message begins with the code, and `fail()` puts the code in
 * front of the message again — strip it, so human output does not read
 * `WEB_PROFILE_NAME_INVALID: WEB_PROFILE_NAME_INVALID: …` (the `login` verb does
 * the same).
 */
function profileRefusal(error: unknown): string {
  return getErrorMessage(error).replace(/^WEB_PROFILE_NAME_INVALID:\s*/, '');
}

/** Prepend the fold notice to an envelope's warnings; never rewrite them away. */
function withFold<T>(envelope: ResultEnvelope<T>, warnings: readonly string[]): ResultEnvelope<T> {
  return warnings.length === 0 ? envelope : { ...envelope, warnings: [...warnings, ...envelope.warnings] };
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
function wrapDiagnostics(values: readonly string[]): string[] {
  return values.map((value) => wrapDiagnostic(value)).filter((value) => value !== '');
}

/**
 * Our own static sentence, then the daemon's own words as a wrapped, capped
 * block. The daemon's `nextActions` are folded into that block rather than
 * forwarded: `printResult` prints `nextActions` to STDOUT as `next: …`, the
 * channel the notice calls instruction, and the daemon's text is not ours to
 * promote there.
 */
function failureMessage(op: WebOp, message: unknown, nextActions: readonly string[]): string {
  const detail = [text(message), ...nextActions.map((action) => text(action))]
    .filter((line) => line !== '')
    .join('\n');
  const wrapped = wrapDiagnostic(detail);
  return wrapped === '' ? `peaks web ${op} failed in the daemon` : `peaks web ${op} failed in the daemon\n${wrapped}`;
}

/**
 * A daemon-supplied `code` is printed on the envelope's first line, so only a
 * protocol-shaped identifier is accepted; anything else falls back to ours.
 */
function safeDaemonCode(value: unknown): string {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? value : 'WEB_OP_FAILED';
}

interface WrappedPayload {
  readonly data: Record<string, unknown>;
  /** Raw human-mode stdout, or `null` for verbs whose output is not page content. */
  readonly human: string | null;
}

/**
 * Wrap the page-controlled part of each verb's payload (AC4 / §6.2) and pick
 * the bytes that human mode prints verbatim. `shot` is unwrapped: its path and
 * byte count are ours, not the page's.
 */
function wrapPageData(op: WebOp, raw: Record<string, unknown>): WrappedPayload {
  if (!WRAPPED_OPS.has(op)) {
    return { data: raw, human: null };
  }
  switch (op) {
    case 'open': {
      const title = wrapUntrusted(text(raw['title']));
      return { data: { url: wrapUntrusted(text(raw['url'])), title }, human: title };
    }
    case 'text': {
      const value = wrapUntrusted(text(raw['text']));
      return {
        data: { text: value, truncated: raw['truncated'] === true, droppedBytes: count(raw['droppedBytes']) },
        human: value
      };
    }
    case 'snap': {
      const snapshot = wrapUntrusted(text(raw['snapshot']));
      return {
        data: {
          snapshot,
          droppedNodes: count(raw['droppedNodes']),
          depthCapped: raw['depthCapped'] === true,
          nodeCapped: raw['nodeCapped'] === true,
          truncated: raw['truncated'] === true,
          droppedBytes: count(raw['droppedBytes'])
        },
        human: snapshot
      };
    }
    case 'click': {
      const result = wrapUntrusted(text(raw['result']));
      return { data: { result }, human: result };
    }
    case 'metrics': {
      // The rendered lines come from the daemon's payload, so they are capped
      // here as well as at the producer: this is the boundary that reaches
      // stdout, and the ceiling must hold whatever the daemon sends.
      const metrics = wrapUntrusted(capText(renderMetrics(raw), MAX_TEXT_BYTES).text);
      return { data: { metrics }, human: metrics };
    }
    default:
      return { data: raw, human: null };
  }
}

/**
 * Print the envelope. Failures and `--json` go through `printResult`; a
 * successful wrapped op in human mode prints its payload RAW, because the
 * UNTRUSTED delimiters must stay on their own lines (AC4) and AC2 measures the
 * byte count of exactly this stdout.
 */
function emit<T>(
  io: ProgramIO,
  result: ResultEnvelope<T>,
  asJson: boolean,
  humanPayload: string | null
): void {
  if (!result.ok || asJson || humanPayload === null) {
    printResult(io, result, asJson);
    return;
  }
  io.stdout(humanPayload);
  for (const warning of result.warnings) {
    io.stderr(`warning: ${warning}`);
  }
}

/** `available: false` is reported as such — never as fabricated zeros (C4). */
function renderMetrics(raw: Record<string, unknown>): string {
  if (raw['available'] !== true) {
    return `available: false\nreason: ${text(raw['reason']) || 'unavailable'}`;
  }
  const values = (raw['values'] ?? {}) as Record<string, unknown>;
  const lines = Object.entries(values).map(([key, value]) => `${key}: ${String(value)}`);
  return lines.length > 0 ? lines.join('\n') : 'available: true';
}

function dispatchId(): string {
  return process.env['PEAKS_DISPATCH_ID'] ?? 'current';
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function count(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}
