/**
 * `peaks code gate-step-08` — the remedy arm.
 *
 * The Step 0.8 gate fires before every Bash call, so the remedy it prints
 * (`peaks code detect-job ...`) is itself a Bash call the gate would refuse.
 * This module reads the PreToolUse payload that names the command and prints
 * the named allow when that command is the remedy.
 */

import { ok } from 'peaks-loop-shared/result';

import { printResult, type ProgramIO } from '../cli-helpers.js';
import type { Step08Verdict } from '../../services/code/step-08-gate.js';
import { pluckObject, pluckString } from '../../services/ide/hook-translator.js';

const HOOK_STDIN_TIMEOUT_MS = 2_000;

type AllowRemedyCommandVerdict = Extract<Step08Verdict, { kind: 'allow-remedy-command' }>;

/**
 * Read the PreToolUse payload the Bash matcher pipes in. A TTY means a manual
 * invocation with nothing to read. The timer guards against a pipe the parent
 * never closes — this gate runs before EVERY Bash call, so it must not be the
 * thing that hangs one.
 */
function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return Promise.resolve('');
  return new Promise<string>((resolveStdin) => {
    let data = '';
    let settled = false;
    const finish = (value: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.stdin.pause();
      resolveStdin(value);
    };
    const timer = setTimeout(() => finish(''), HOOK_STDIN_TIMEOUT_MS);
    timer.unref();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += String(chunk);
    });
    process.stdin.on('end', () => finish(data));
    process.stdin.on('error', () => finish(''));
  });
}

/** JSON.parse whose failure is a value, not a silent null return. */
function parseJson(raw: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

/** The `tool_input.command` of the hook payload, or undefined when there is none. */
function commandFromHookPayload(raw: string): string | undefined {
  if (raw.trim().length === 0) return undefined;
  const parsed = parseJson(raw);
  if (!parsed.ok) return undefined;
  const toolInput =
    pluckObject(parsed.value, ['tool_input']) ?? pluckObject(parsed.value, ['input']);
  if (toolInput === undefined) return undefined;
  return pluckString(toolInput, ['command']);
}

/** The command the hook is gating, when the payload carries one. */
export async function readHookCommand(): Promise<string | undefined> {
  return commandFromHookPayload(await readStdin());
}

export function printGateStep08RemedyCommand(
  verdict: AllowRemedyCommandVerdict,
  hintActions: readonly string[],
  io: ProgramIO,
  json?: boolean
): void {
  const envelope = ok(
    'code.gate-step-08',
    {
      allow: true,
      mode: 'remedy-command',
      decision: null,
      nextSlice: null
    },
    [],
    [verdict.reason, ...hintActions]
  );
  printResult(io, envelope, json);
}
