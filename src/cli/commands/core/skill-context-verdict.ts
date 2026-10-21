// Split out of `core/skill-command.ts`. The
// loop-hygiene verdict is a pure projection: it probes context pressure and
// renders the advisory `nextActions`; it never compacts.
import { readContextPercent } from '../../../services/context/auto-compact-reader.js';
import { evaluateCompactTrigger } from '../../../services/code/auto-compact-orchestrator.js';
import type { AutoCompactMode } from '../../../services/code/auto-compact-modes.js';
import {
  resolveBatchPresenceReminder,
  type BatchContextReminder
} from '../../../services/batch/batch-context-reminder.js';
import { resolveAutoCompactProfile } from '../../../services/mode/mode-status-service.js';
import { getSessionId } from '../../../services/session/session-manager.js';
import { resolveOuterSessionId } from '../../../services/session/binding-status-service.js';

/**
 * The loop-hygiene verdict attached to every ACTIVE `skill.presence` read.
 *
 * Why it lives here instead of only in a SKILL.md body: the zero-pause
 * contract ("auto-compact is the skill's own action, never the user's")
 * was already written into `peaks-code/SKILL.md`, including an explicit
 * ban on the exact phrasing "prompt the user to run `/compact`" — and it
 * was still violated. A SKILL.md body is loaded once and is then
 * compacted away, so the rule stops governing at precisely the moment
 * context pressure makes it matter. `skill.presence` is the one call
 * EVERY skill makes on EVERY turn, in EVERY consumer project and EVERY
 * mode, so a value carried here cannot be forgotten, and no skill has to
 * be edited for the obligation to reach the model.
 *
 * READ-ONLY by contract. It probes and reports; it never compacts.
 * Executing `peaks code auto-compact` stays the skill's own action — a
 * side effect here would fire on every single turn.
 *
 * THE ONE WRITE. The batch reminder records the phase it last spoke in,
 * so the batch says its reminder once per phase instead of once per turn.
 * That marker is written only when the phase changed or when the batch
 * spoke, and it lives in the batch's own directory under the session —
 * never in the presence marker itself.
 *
 * Failure swallows to `null`: the hygiene verdict is advisory and must
 * never be able to break the presence read itself.
 *
 * THE BATCH REMINDER IS CARRIED HERE TOO. A batch's context reminder (the
 * ratio zone, the phase boundary) is another statement about the window,
 * and it reaches the model through the same carrier — so a batch sentence
 * cannot bypass the zero-pause contract by living somewhere else. The
 * sentence itself is built by the batch module (it owns the wording); it
 * is APPENDED here, and it states a fact rather than asking anybody to do
 * anything.
 */
export function buildContextVerdict(
  ratio: number,
  mode: AutoCompactMode,
  batch?: BatchContextReminder | null
): {
  context: { ratioPct: string; action: string; mode: string };
  nextActions: string[];
} {
  const trigger = evaluateCompactTrigger(ratio, mode);
  const ratioPct = `${(ratio * 100).toFixed(1)}%`;
  // `auto-fire` belongs in the in-zone set: it is the tier where
  // peaks-loop preempts rather than asking the LLM to decide.
  const inZone =
    trigger.kind === 'auto-fire' || trigger.kind === 'pre-compact' || trigger.kind === 'red-line';
  const nextActions: string[] = inZone
    ? [
        `Context at ${ratioPct} is in the '${trigger.kind}' zone (mode=${mode}).`,
        'Run `peaks code auto-compact --project .` YOURSELF now, then continue. Do NOT ask the user to run /compact — that is the regression the zero-pause contract forbids.'
      ]
    : [];
  if (batch !== null && batch !== undefined && batch.text.length > 0) {
    nextActions.push(batch.text);
  }
  return {
    context: { ratioPct, action: trigger.kind, mode },
    nextActions
  };
}

export function contextVerdict(projectRoot: string): {
  context: { ratioPct: string; action: string; mode: string } | null;
  nextActions: string[];
} {
  try {
    const sessionId = getSessionId(projectRoot);
    if (sessionId === null) return { context: null, nextActions: [] };
    const mode = resolveAutoCompactProfile(projectRoot);
    // `outerSessionId` is NOT optional in practice: without it the
    // adapter cannot find the harness transcript and falls back to
    // conservative-zero, reporting a serene "0.0%" that never crosses
    // any threshold. Same resolution order the orchestrator uses.
    const outerSessionId = resolveOuterSessionId(projectRoot, sessionId, process.env);
    const probe = readContextPercent({ projectRoot, sessionId, outerSessionId, env: process.env });
    // The batch reminder rides the same carrier as the zone instruction:
    // the batch in flight is found among the session's batch records, and
    // its sentence is a statement about the window, not a request. It is
    // resolved INSIDE this try — the batch lookup reads files, and a
    // corrupt batch record must not be able to break the presence read.
    const batch = resolveBatchPresenceReminder({
      projectRoot,
      sessionId,
      ratio: probe.ratio,
      mode
    });
    return buildContextVerdict(probe.ratio, mode, batch);
  } catch {
    return { context: null, nextActions: [] };
  }
}
