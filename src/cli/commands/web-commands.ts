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
import type { WebOp } from '../../services/web/web-protocol.js';
import {
  addJsonOption,
  printResult,
  redactSensitiveErrorMessage,
  type ProgramIO
} from '../cli-helpers.js';

/** A browser op is user-visible latency; 30 s is generous but bounded. */
const OP_TIMEOUT_MS = 30_000;

interface VerbSpec {
  readonly name: string;
  readonly op: WebOp;
  readonly description: string;
  readonly argument: { readonly name: string; readonly description: string } | null;
  readonly toArgs: (positional: readonly (string | undefined)[]) => Record<string, unknown>;
}

const WEB_VERBS: readonly VerbSpec[] = [
  {
    name: 'open',
    op: 'open',
    description: 'Navigate the dispatch browser context to <url>.',
    argument: { name: '<url>', description: 'absolute URL to load' },
    toArgs: (positional) => ({ url: positional[0] ?? '' })
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
    command = addJsonOption(command);
    // Commander calls the handler as (…declaredArgs, options, command), so the
    // options object sits at the declared-argument count — not at the end.
    command.action(async (...actionArgs: unknown[]) => {
      const options = actionArgs[takesArgument ? 1 : 0] as { json?: boolean } | undefined;
      const rawArgument = actionArgs[0];
      const positional = takesArgument
        ? [typeof rawArgument === 'string' ? rawArgument : undefined]
        : [];
      await runWebOp(io, verb.op, verb.toArgs(positional), options?.json === true);
    });
  }
}

/**
 * Resolve the session, ensure a daemon, invoke one op, and emit exactly one
 * envelope. `WRAPPED_OPS` is applied here, after the byte caps the daemon
 * already imposed, so the UNTRUSTED markers are never themselves truncated.
 */
export async function runWebOp(
  io: ProgramIO,
  op: WebOp,
  args: Record<string, unknown>,
  asJson: boolean
): Promise<void> {
  const command = `peaks.web.${op}`;
  try {
    const projectRoot = resolveCanonicalProjectRoot(process.cwd());
    const sessionId = getCurrentSessionId(projectRoot);
    if (sessionId === null) {
      printResult(
        io,
        fail(command, 'NO_SESSION', 'No peaks session is bound to this project root', {}, [
          'Bind a session first (the LLM runs `peaks workspace init` on your behalf)'
        ]),
        asJson
      );
      process.exitCode = 1;
      return;
    }

    const info = await ensureDaemon(projectRoot, sessionId);
    const response = await new WebDaemonClient(info).call<Record<string, unknown>>(
      op,
      { ...args, dispatchId: dispatchId(), projectRoot, sessionId },
      OP_TIMEOUT_MS
    );

    if (!response.ok || response.data === null) {
      printResult(
        io,
        fail(
          command,
          safeDaemonCode(response.code),
          failureMessage(op, response.message, response.nextActions),
          {},
          []
        ),
        asJson
      );
      process.exitCode = 1;
      return;
    }

    const wrapped = wrapPageData(op, response.data);
    emit(io, ok(command, wrapped.data, wrapDiagnostics(response.warnings)), asJson, wrapped.human);
  } catch (error) {
    printResult(
      io,
      fail(
        command,
        'WEB_OP_FAILED',
        failureMessage(op, redactSensitiveErrorMessage(getErrorMessage(error)), []),
        {},
        []
      ),
      asJson
    );
    process.exitCode = 1;
  }
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
