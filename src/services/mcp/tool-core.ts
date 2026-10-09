// src/services/mcp/tool-core.ts
//
// What both tool handlers are made of: the result shape, the argument-to-argv
// step, and the one place a CLI execution becomes an outcome. Split out of
// `tools.ts` because that file had grown past the repo's 300-line cap, and the
// cap is measured per file rather than per concept.
//
// ERRORS ARE NEVER FLATTENED HERE, either. A CLI failure becomes a `failure`
// string on the outcome, never an absent value: a read tool that answers
// "nothing there" when it actually failed is worse than one that errors, because
// the reader believes the empty answer (spec §9 rule 3).

import type { ReadOnlyWhitelistEntry } from '../readonly-surface/readonly-whitelist.js';
import { executeCliArgv, type CliExecution } from './cli-executor.js';

/** How much of one memory note's description travels back. */
export const MEMORY_EXCERPT_CHARS = 120;

/** Hard ceiling on matches returned, independent of what the CLI was asked for. */
export const MEMORY_MAX_RETURNED = 50;

export interface ToolTextContent {
  readonly type: 'text';
  readonly text: string;
}

export interface ToolCallResult {
  readonly content: readonly ToolTextContent[];
  /** Present and `true` only when something failed. Absent means success. */
  readonly isError?: boolean;
}

/** Injectable execution, so a test can drive a handler without a CLI. */
export type CliExecutor = (argv: readonly string[]) => Promise<CliExecution>;

export interface ToolCallContext {
  readonly execute?: CliExecutor;
  /** Directory the CLI runs in. Defaults to the server process's own. */
  readonly cwd?: string;
}

/**
 * Hand-written parameter defaults — the one place this module can drift from the
 * whitelist (spec §8.1 asks such places to be visible). `project` is a MANDATORY
 * option of `peaks request show`, and a status caller should not have to repeat
 * the directory the server already runs in. Nothing else is defaulted: every
 * other placeholder is either required by the caller or defaulted in the data.
 */
function defaultFor(param: string, context: ToolCallContext): string | undefined {
  return param === 'project' ? (context.cwd ?? process.cwd()) : undefined;
}

/**
 * A transported argument as the guard's input. The JSON transport carries
 * numbers for integer parameters and the guard can only judge a string, so
 * coercion happens here, at the boundary — and a wrong JSON type is NOT
 * stringified into something that looks like data: it becomes the empty string,
 * which the guard already refuses by name (`EMPTY`).
 */
function asGuardInput(supplied: unknown): string {
  if (typeof supplied === 'string') return supplied;
  if (typeof supplied === 'number') return String(supplied);
  return '';
}

/**
 * The values to render one entry with, or `undefined` when the caller did not
 * supply enough for this entry to run. A value the caller DID supply is always
 * present — it is handed to the guard, which is what decides whether it is
 * allowed, so nothing supplied can be silently skipped.
 */
export function valuesForEntry(
  entry: ReadOnlyWhitelistEntry,
  args: Readonly<Record<string, unknown>>,
  context: ToolCallContext
): Record<string, string> | undefined {
  const values: Record<string, string> = {};
  for (const [name, spec] of Object.entries(entry.params)) {
    const supplied = args[name];
    if (supplied !== undefined) {
      values[name] = asGuardInput(supplied);
      continue;
    }
    const fallback = spec.default === undefined ? defaultFor(name, context) : String(spec.default);
    if (fallback === undefined) return undefined;
    values[name] = fallback;
  }
  return values;
}

/** True when the CLI process itself failed, or its stdout was not a JSON envelope. */
function failureReasonOf(execution: CliExecution, envelope: unknown): string | undefined {
  const called = `peaks ${execution.argv.join(' ')}`;
  if (execution.launchError !== undefined) {
    return `The peaks CLI could not be started: ${execution.launchError}`;
  }
  if (execution.timedOut) {
    return `The peaks CLI did not finish in time and was killed: ${called}`;
  }
  if (execution.exitCode !== 0) {
    return `The peaks CLI exited with code ${String(execution.exitCode)}: ${called}`;
  }
  if (envelope === undefined) {
    return `The peaks CLI printed no JSON on stdout: ${called}`;
  }
  if (isFailedEnvelope(envelope)) {
    return `The peaks CLI reported failure: ${called}`;
  }
  return undefined;
}

function isFailedEnvelope(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'ok' in value && value.ok === false;
}

/** Parsed stdout, or the fact that it was not JSON at all — never a bare `undefined`. */
type ParsedStdout = { readonly parsed: true; readonly value: unknown } | { readonly parsed: false };

function parseStdout(stdout: string): ParsedStdout {
  try {
    return { parsed: true, value: JSON.parse(stdout) as unknown };
  } catch {
    return { parsed: false };
  }
}

/** One argv's outcome, kept whole so the caller can see every envelope. */
export interface EntryOutcome {
  readonly key: string;
  readonly execution: CliExecution;
  readonly envelope: unknown;
  readonly failure?: string;
}

/** Render the outcomes as a tool result, failing the call when any argv failed. */
export function resultOf(outcomes: readonly EntryOutcome[]): ToolCallResult {
  const payload: Record<string, unknown> = {};
  for (const outcome of outcomes) {
    payload[outcome.key] =
      outcome.envelope === undefined
        ? { ok: false, message: outcome.failure ?? 'no output', argv: outcome.execution.argv }
        : outcome.envelope;
  }
  const failures = outcomes.filter((outcome) => outcome.failure !== undefined);
  if (failures.length === 0) {
    return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
  }
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          ...payload,
          failures: failures.map((outcome) => ({ key: outcome.key, reason: outcome.failure }))
        })
      }
    ],
    isError: true
  };
}

/** A refused call: the parameter guard said no, before anything was executed. */
export function rejectedResult(entry: ReadOnlyWhitelistEntry, reason: string): ToolCallResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ entry: entry.id, reason }) }],
    isError: true
  };
}

/** Execute one already-validated argv and keep its whole outcome. */
export async function runArgv(
  key: string,
  argv: readonly string[],
  context: ToolCallContext
): Promise<EntryOutcome> {
  const execute: CliExecutor =
    context.execute ??
    ((args: readonly string[]) =>
      executeCliArgv(args, context.cwd === undefined ? {} : { cwd: context.cwd }));
  const execution = await execute(argv);
  const parsed = parseStdout(execution.stdout);
  const envelope = parsed.parsed ? parsed.value : undefined;
  const failure = failureReasonOf(execution, envelope);
  return failure === undefined
    ? { key, execution, envelope }
    : { key, execution, envelope, failure };
}
