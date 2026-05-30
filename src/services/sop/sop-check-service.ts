import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isInsidePath } from '../../shared/path-utils.js';
import { readSopManifest } from './sop-service.js';
import type { SopGate, SopGateCheck, SopCheckResult } from './sop-types.js';

/**
 * SOP gate evaluation — Feature A, Slice 2.
 *
 * Evaluates a single gate to one of three verdicts: pass / fail / blocked.
 * "blocked" means the check could not be evaluated (e.g. unreadable target,
 * command not permitted, spawn failure) — a verdict, not an error. Only an
 * inability to start (SOP/gate missing) is an evaluator error.
 *
 * Security (OQ3/R1): command gates run via execFileSync with an argv array and
 * NO shell (no injection), a hard timeout, and cwd set to the project, and they
 * are refused unless explicitly permitted. file-exists/grep targets are pinned
 * inside the project root. NOTE: the command executable itself is NOT
 * sandboxed — a command gate can invoke any binary on the machine. The trust
 * boundary is "whoever authored the SOP"; --allow-commands is the gate.
 */

const GATE_COMMAND_TIMEOUT_MS = 30_000;

export type GateVerdict = {
  result: SopCheckResult;
  reason?: string;
};

export type CheckGateResult = GateVerdict & {
  id: string;
  gateId: string;
  phase: string;
};

export type CheckGateOptions = {
  projectRoot: string;
  id: string;
  gateId: string;
  allowCommands?: boolean;
  /** Override the command-gate timeout (ms). Defaults to GATE_COMMAND_TIMEOUT_MS. */
  commandTimeoutMs?: number;
};

export class SopCheckError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'SopCheckError';
    this.code = code;
  }
}

/** Resolve a user-authored relative path and require it to stay inside the project. */
function resolveInsideProject(projectRoot: string, target: string): string | null {
  const root = resolve(projectRoot);
  const resolved = resolve(root, target);
  return isInsidePath(resolved, root) ? resolved : null;
}

function evaluateFileExists(projectRoot: string, path: string): GateVerdict {
  const resolved = resolveInsideProject(projectRoot, path);
  if (resolved === null) {
    return { result: 'blocked', reason: `path "${path}" escapes the project root` };
  }
  return existsSync(resolved) ? { result: 'pass' } : { result: 'fail', reason: `file "${path}" does not exist` };
}

function evaluateGrep(projectRoot: string, file: string, pattern: string, absent: boolean): GateVerdict {
  const resolved = resolveInsideProject(projectRoot, file);
  if (resolved === null) {
    return { result: 'blocked', reason: `file "${file}" escapes the project root` };
  }
  if (!existsSync(resolved)) {
    return { result: 'blocked', reason: `file "${file}" cannot be read` };
  }
  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch {
    return { result: 'blocked', reason: `invalid grep pattern "${pattern}"` };
  }
  let content: string;
  try {
    content = readFileSync(resolved, 'utf8');
  } catch {
    return { result: 'blocked', reason: `file "${file}" cannot be read` };
  }
  const found = regex.test(content);
  // absent gate: pass when the pattern is NOT present ("must not contain X").
  const pass = absent ? !found : found;
  if (pass) {
    return { result: 'pass' };
  }
  return absent
    ? { result: 'fail', reason: `pattern "${pattern}" must be absent but was found in "${file}"` }
    : { result: 'fail', reason: `pattern "${pattern}" not found in "${file}"` };
}

function evaluateCommand(projectRoot: string, run: string[], expectExitZero: boolean, allowCommands: boolean, timeoutMs: number): GateVerdict {
  if (!allowCommands) {
    return { result: 'blocked', reason: 'command checks require --allow-commands' };
  }
  // Manifests reach here unvalidated (checkGate/advanceSop don't pre-lint), so
  // guard the untrusted shape rather than assert run[0]; an empty run is a
  // blocked verdict, not a thrown evaluator error.
  const [bin, ...args] = run;
  if (bin === undefined) {
    return { result: 'blocked', reason: 'command gate has no executable' };
  }
  let exitCode: number;
  try {
    execFileSync(bin, args, { cwd: resolve(projectRoot), timeout: timeoutMs, stdio: 'ignore' });
    exitCode = 0;
  } catch (error) {
    const err = error as { status?: unknown; killed?: boolean; code?: unknown };
    // Timeout surfaces as ETIMEDOUT on some platforms and killed+SIGTERM on others.
    if (err.code === 'ETIMEDOUT' || err.killed === true) {
      return { result: 'blocked', reason: `command timed out after ${timeoutMs}ms` };
    }
    if (typeof err.status === 'number') {
      exitCode = err.status;
    } else {
      return { result: 'blocked', reason: `command could not be run (${String(err.code ?? 'spawn error')})` };
    }
  }
  const zero = exitCode === 0;
  const pass = expectExitZero ? zero : !zero;
  return pass ? { result: 'pass' } : { result: 'fail', reason: `command exited ${exitCode} (expectExitZero=${expectExitZero})` };
}

function evaluateCheck(projectRoot: string, check: SopGateCheck, allowCommands: boolean, timeoutMs: number): GateVerdict {
  switch (check.type) {
    case 'file-exists':
      return evaluateFileExists(projectRoot, check.path);
    case 'grep':
      return evaluateGrep(projectRoot, check.file, check.pattern, check.absent === true);
    case 'command':
      return evaluateCommand(projectRoot, check.run, check.expectExitZero !== false, allowCommands, timeoutMs);
    default:
      return { result: 'blocked', reason: 'unknown check type' };
  }
}

export type EvaluateGateOptions = {
  allowCommands?: boolean;
  commandTimeoutMs?: number;
};

/** Evaluate a single gate's check to a pass/fail/blocked verdict. Shared by `sop check` and `sop advance`. */
export function evaluateGate(projectRoot: string, gate: SopGate, options: EvaluateGateOptions = {}): GateVerdict {
  return evaluateCheck(projectRoot, gate.check, options.allowCommands === true, options.commandTimeoutMs ?? GATE_COMMAND_TIMEOUT_MS);
}

export async function checkGate(options: CheckGateOptions): Promise<CheckGateResult> {
  // Definitions are global; the gate's check still evaluates against options.projectRoot.
  const manifest = await readSopManifest(options.id);
  if (manifest === null) {
    throw new SopCheckError('SOP_NOT_FOUND', `No SOP found for id "${options.id}"`);
  }
  const gate: SopGate | undefined = manifest.gates.find((candidate) => candidate.id === options.gateId);
  if (gate === undefined) {
    throw new SopCheckError('GATE_NOT_FOUND', `Gate "${options.gateId}" not found in SOP "${options.id}"`);
  }
  const evaluateOptions: EvaluateGateOptions = {};
  if (options.allowCommands !== undefined) {
    evaluateOptions.allowCommands = options.allowCommands;
  }
  if (options.commandTimeoutMs !== undefined) {
    evaluateOptions.commandTimeoutMs = options.commandTimeoutMs;
  }
  const verdict = evaluateGate(options.projectRoot, gate, evaluateOptions);
  const result: CheckGateResult = { id: options.id, gateId: gate.id, phase: gate.phase, result: verdict.result };
  if (verdict.reason !== undefined) {
    result.reason = verdict.reason;
  }
  return result;
}
