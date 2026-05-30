import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readRegistry } from './sop-registry-service.js';
import { readSopManifest } from './sop-service.js';
import { evaluateGate } from './sop-check-service.js';
import { sopStateDir } from './sop-paths.js';
import { isBypassLimitReached, recordBypass, MAX_BYPASSES_PER_SESSION } from '../mode/bypass-tracker.js';
import type { BlockedGate } from './sop-advance-service.js';

/**
 * Gate enforcement — Feature A, Slice 4 (the un-bypassable closure).
 *
 * `enforceBashCommand` is the brain behind the PreToolUse hook: given a Bash
 * command the agent is about to run, it finds every registered SOP whose phase
 * `guards` match that command, evaluates that phase's gates, and decides
 * allow/deny. A deny, surfaced by the hook as `permissionDecision: "deny"`,
 * blocks the tool call before Claude Code's permission checks — so the action
 * cannot happen while a gate fails, regardless of agent cooperation or
 * `--dangerously-skip-permissions`.
 *
 * TRUST RED LINE: this runs on (potentially) every Bash call. A bug here must
 * never brick the user's Claude Code. So every internal failure (unreadable
 * registry, malformed manifest, invalid guard regex) is FAIL-OPEN — it allows
 * the command and emits a warning. Only a genuine gate failure denies.
 *
 * Escape hatch: a one-shot bypass token (written by `peaks gate bypass`) for a
 * matched transition is consumed here and turns the deny into an allow, capped
 * per-project-per-SOP by the shared bypass tracker.
 */

const BYPASS_TOKENS_FILE = '.gate-bypass.json';

export type MatchedGuard = {
  sopId: string;
  phase: string;
  /** The non-passing gates that block this phase's guarded action. */
  failing: BlockedGate[];
};

export type EnforceDecision =
  | { decision: 'allow'; bypassed?: boolean; warnings?: string[] }
  | { decision: 'deny'; reason: string; matched: MatchedGuard[] };

type BypassToken = { phase: string; reason: string };

function bypassTokensPath(projectRoot: string, sopId: string): string {
  return join(sopStateDir(projectRoot, sopId), BYPASS_TOKENS_FILE);
}

function readBypassTokens(projectRoot: string, sopId: string): BypassToken[] {
  const path = bypassTokensPath(projectRoot, sopId);
  if (!existsSync(path)) {
    return [];
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((t): t is BypassToken => t !== null && typeof t === 'object' && typeof (t as BypassToken).phase === 'string');
  } catch {
    return [];
  }
}

function writeBypassTokens(projectRoot: string, sopId: string, tokens: BypassToken[]): void {
  const dir = sopStateDir(projectRoot, sopId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(bypassTokensPath(projectRoot, sopId), `${JSON.stringify(tokens, null, 2)}\n`, 'utf8');
}

function hasBypassToken(projectRoot: string, sopId: string, phase: string): boolean {
  return readBypassTokens(projectRoot, sopId).some((t) => t.phase === phase);
}

/** Remove the first matching bypass token (one-shot). Returns true if one was consumed. */
function consumeBypassToken(projectRoot: string, sopId: string, phase: string): boolean {
  const tokens = readBypassTokens(projectRoot, sopId);
  const index = tokens.findIndex((t) => t.phase === phase);
  if (index === -1) {
    return false;
  }
  tokens.splice(index, 1);
  writeBypassTokens(projectRoot, sopId, tokens);
  return true;
}

export class GateBypassError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'GateBypassError';
    this.code = code;
  }
}

/**
 * Record a one-shot bypass token for `<sopId>:<phase>` in this project. The next
 * `enforceBashCommand` that the transition blocks consumes it and allows once.
 * Capped per-project-per-SOP by MAX_BYPASSES_PER_SESSION.
 */
export function recordGateBypass(projectRoot: string, sopId: string, phase: string, reason: string): { count: number } {
  const root = sopStateDir(projectRoot, sopId);
  if (isBypassLimitReached(root)) {
    throw new GateBypassError('BYPASS_LIMIT_REACHED', `gate bypass limit reached (${MAX_BYPASSES_PER_SESSION} bypasses per SOP per project)`);
  }
  const tokens = readBypassTokens(projectRoot, sopId);
  writeBypassTokens(projectRoot, sopId, [...tokens, { phase, reason }]);
  const count = recordBypass(root);
  return { count };
}

function denyReason(matched: MatchedGuard[]): string {
  const lines = matched.map((m) => {
    const gates = m.failing.map((g) => `${g.gateId}=${g.result}${g.reason ? ` (${g.reason})` : ''}`).join(', ');
    return `SOP "${m.sopId}" phase "${m.phase}": ${gates}`;
  });
  const hint = matched
    .map((m) => `peaks gate bypass --sop ${m.sopId} --phase ${m.phase} --reason "<why>"`)
    .join(' ; ');
  return `Blocked by Peaks gate(s): ${lines.join(' | ')}. Satisfy the gate(s), or bypass once: ${hint}`;
}

/**
 * Decide whether a Bash command may run. Pure given the filesystem; never throws
 * (fail-open on any internal error). Returns allow/deny for the PreToolUse hook.
 */
export async function enforceBashCommand(projectRoot: string, command: string): Promise<EnforceDecision> {
  const warnings: string[] = [];

  let sopIds: string[];
  try {
    sopIds = (await readRegistry()).sops.map((sop) => sop.id);
  } catch (error) {
    return { decision: 'allow', warnings: [`gate enforce: could not read registry (${error instanceof Error ? error.message : 'error'}); allowing`] };
  }

  const matched: MatchedGuard[] = [];

  for (const sopId of sopIds) {
    let manifest;
    try {
      manifest = await readSopManifest(sopId);
    } catch (error) {
      warnings.push(`gate enforce: SOP "${sopId}" manifest unreadable (${error instanceof Error ? error.message : 'error'}); skipping`);
      continue;
    }
    if (manifest === null || !Array.isArray(manifest.guards) || manifest.guards.length === 0) {
      continue;
    }

    for (const guard of manifest.guards) {
      let regex: RegExp;
      try {
        regex = new RegExp(guard.bash);
      } catch {
        warnings.push(`gate enforce: SOP "${sopId}" guard has an invalid regex "${guard.bash}"; skipping`);
        continue;
      }
      if (!regex.test(command)) {
        continue;
      }
      const failing: BlockedGate[] = [];
      for (const gate of manifest.gates.filter((g) => g.phase === guard.phase)) {
        const verdict = evaluateGate(projectRoot, gate, { allowCommands: true });
        if (verdict.result !== 'pass') {
          failing.push(verdict.reason === undefined
            ? { gateId: gate.id, result: verdict.result }
            : { gateId: gate.id, result: verdict.result, reason: verdict.reason });
        }
      }
      if (failing.length > 0) {
        matched.push({ sopId, phase: guard.phase, failing });
      }
    }
  }

  if (matched.length === 0) {
    return warnings.length > 0 ? { decision: 'allow', warnings } : { decision: 'allow' };
  }

  // One-shot bypass: only allow if EVERY blocked transition has a token to spend
  // (don't burn tokens on a partial pass-through).
  const allBypassable = matched.every((m) => hasBypassToken(projectRoot, m.sopId, m.phase));
  if (allBypassable) {
    for (const m of matched) {
      consumeBypassToken(projectRoot, m.sopId, m.phase);
    }
    return { decision: 'allow', bypassed: true, ...(warnings.length > 0 ? { warnings } : {}) };
  }

  return { decision: 'deny', reason: denyReason(matched), matched };
}
