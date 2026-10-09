// The `peaks sub-agent dispatch` preflight: every refusal that can be decided from
// the argv alone, before the session id, the lease or the prompt blocks are touched.
// Returns the prompt-size decision, or `null` when a refusal was already printed.
import { printResult, type ProgramIO } from '../cli-helpers.js';
import { fail } from 'peaks-loop-shared/result';
import {
  evaluatePromptSize,
  type ContextGuardDecision
} from '../../services/context/context-guard.js';
import { TEST_TOOL_DETECTION_BLOCK } from '../../services/dispatch/test-tool-detection.js';
import {
  PROMPT_LIMIT_BYTES,
  RECOMMENDED_ROLES,
  validateRole,
  type DispatchOptions
} from './sub-agent-shared.js';

function rejectInvalidRole(io: ProgramIO, role: string, validation: string, asJson: boolean): null {
  printResult(
    io,
    fail(
      'sub-agent.dispatch',
      'INVALID_ROLE',
      validation,
      { role, toolCall: null, dispatchRecordPath: null } as never,
      [
        'Use a non-empty role string with no control characters.',
        `Recommended: ${RECOMMENDED_ROLES}.`
      ]
    ),
    asJson
  );
  process.exitCode = 1;
  return null;
}

function rejectRemovedAgentRole(io: ProgramIO, role: string, asJson: boolean): null {
  printResult(
    io,
    fail(
      'sub-agent.dispatch',
      'ROLE_REMOVED',
      'The agent role was removed in Slice 3',
      {
        role,
        reason: 'role-removed-in-slice-3',
        toolCall: null,
        dispatchRecordPath: null
      } as never,
      []
    ),
    asJson
  );
  process.exitCode = 1;
  return null;
}

function rejectMissingPrompt(io: ProgramIO, role: string, asJson: boolean): null {
  printResult(
    io,
    fail(
      'sub-agent.dispatch',
      'MISSING_PROMPT',
      '--prompt is required when --from-dag is not provided',
      { role, toolCall: null, dispatchRecordPath: null } as never,
      [
        'Re-run with either:',
        '  • `--prompt <text>` for single-role dispatch, OR',
        '  • `--from-dag <file>` for DAG-aware multi-slice dispatch (no --prompt needed; the per-slice prompt is generated from the DAG nodes).'
      ]
    ),
    asJson
  );
  process.exitCode = 1;
  return null;
}

// DOGFOOD ONLY: --prompt-length overrides the actual prompt content with
// a synthetic prompt of the given size in bytes. The original --prompt
// is still required (commander needs it). This avoids ARG_MAX limits
// on Windows when the dogfood prompt is > 200KB.
function applyPromptLengthOverride(options: DispatchOptions): void {
  if (typeof options.promptLength === 'string' && options.promptLength.length > 0) {
    const len = Number.parseInt(options.promptLength, 10);
    if (Number.isInteger(len) && len > 0) {
      options.prompt = 'x'.repeat(len);
    }
  }
}

function rejectPromptTooLarge(
  io: ProgramIO,
  role: string,
  promptLength: number,
  asJson: boolean
): null {
  printResult(
    io,
    fail(
      'sub-agent.dispatch',
      'PROMPT_TOO_LARGE',
      `prompt exceeds ${PROMPT_LIMIT_BYTES} bytes (got ${promptLength})`,
      { role, toolCall: null, dispatchRecordPath: null } as never,
      [
        'Truncate the prompt or split into multiple dispatches.',
        'Pass --force to override the 80% threshold at CLI (NOT allowed at hook layer).'
      ]
    ),
    asJson
  );
  process.exitCode = 1;
  return null;
}

function rejectGuardDecision(
  io: ProgramIO,
  role: string,
  args: { promptLength: number; decision: ContextGuardDecision },
  asJson: boolean
): null {
  const { promptLength, decision } = args;
  printResult(
    io,
    fail(
      'sub-agent.dispatch',
      decision.code,
      `prompt size ${promptLength} bytes exceeds threshold (tier=${decision.evaluation.tier}, ratio=${decision.evaluation.ratio.toFixed(3)})`,
      {
        role,
        toolCall: null,
        dispatchRecordPath: null
      } as never,
      [
        decision.suggest ?? 'Trim prompt or pass --force to override at CLI.',
        'PreToolUse hook layer will still reject regardless of --force (RL-30 strict).'
      ]
    ),
    asJson
  );
  process.exitCode = 1;
  return null;
}

export function preflightDispatch(
  io: ProgramIO,
  role: string,
  options: DispatchOptions,
  asJson: boolean
): { decision: ContextGuardDecision; prompt: string } | null {
  const validation = validateRole(role);
  if (validation !== null) {
    return rejectInvalidRole(io, role, validation, asJson);
  }
  // Slice 3 (on-demand-ecc) D-012: the `agent` role was removed in
  // 4.0.0-beta.11 — there is no longer a subprocess path for it
  // (the upstream ECC v2.0.0 ships no `ecc` binary). This guard
  // sits AFTER role validation but BEFORE the missing-prompt
  // check so an action-path dispatch with a valid prompt still
  // returns a clear ROLE_REMOVED envelope + exit 1. Note that
  // Commander short-circuits `--help` BEFORE `.action()` fires,
  // so `peaks sub-agent dispatch agent --help` continues to
  // exit 0 with the help text — that is intentional, not a bug.
  if (role === 'agent') {
    return rejectRemovedAgentRole(io, role, asJson);
  }
  if (!options.prompt || options.prompt.length === 0) {
    return rejectMissingPrompt(io, role, asJson);
  }

  // Slice 4.0.8 RD §4 D4c required `--graph-node` here, before the session
  // id existed, so the only recovery it could offer was prose. The node is
  // now provisioned inside the try block below, once `sid` is known.
  applyPromptLengthOverride(options);
  if (options.prompt.length + TEST_TOOL_DETECTION_BLOCK.length > PROMPT_LIMIT_BYTES) {
    return rejectPromptTooLarge(io, role, options.prompt.length, asJson);
  }

  // G9 CLI 兜底 — evaluate prompt size against the threshold table.
  const decision = evaluatePromptSize(options.prompt.length, { force: options.force === true });
  if (!decision.allow) {
    return rejectGuardDecision(io, role, { promptLength: options.prompt.length, decision }, asJson);
  }

  // The prompt the caller composes with: the `--prompt` the caller passed, or the
  // synthetic one `--prompt-length` substituted for it. Handed back explicitly so a
  // caller that has only the argv cannot mistake an absent prompt for an empty one.
  return { decision, prompt: options.prompt };
}
