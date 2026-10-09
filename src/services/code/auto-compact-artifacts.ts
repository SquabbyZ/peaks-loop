/**
 * The files one auto-compact run writes: checkpoint, intent and decision log.
 *
 * Split out of `auto-compact-orchestrator.ts` (file-size cap campaign). The
 * orchestrator re-exports every name declared here, so existing importers keep
 * using `./auto-compact-orchestrator.js` unchanged.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getSessionDir } from '../session/getSessionDir.js';
import {
  describeHarnessWindowSync,
  type HarnessWindowSyncResult
} from '../context/harness-window-config.js';
import type { ConvergencePlan } from '../context/auto-compact-types.js';

/**
 * What the caller is told to do next. The harness-window notice rides along because
 * the run also rewrites the harness's own settings, so it says so too: the user
 * accepted that write on the condition 要告知, and a write only one of the two
 * syncing commands reports is not a notice.
 */
export function compactNextActions(
  isRedLine: boolean,
  harnessWindow: HarnessWindowSyncResult | null
): readonly string[] {
  if (isRedLine) {
    return [
      'RED-LINE: harness compact requested — sub-agent dispatch is NOT blocked; keep working',
      'Post-compact resume picks up the convergence plan from auto-decisions.md',
      'Next `peaks code context-now` probe will confirm the ratio dropped; if it keeps climbing and the harness has not compacted, report that to the user and hand control back',
      describeHarnessWindowSync(harnessWindow)
    ];
  }
  return [
    'Pre-compact dispatched — IDE compact in progress (async)',
    'Post-compact resume picks up the convergence plan from auto-decisions.md',
    'Next `peaks code auto-compact` probe will confirm ratio dropped below 0.85',
    describeHarnessWindowSync(harnessWindow)
  ];
}

const PRE_COMPACT_REASON = 'pre-compact-auto' as const;
/**
 * Append a one-row convergence decision to the LLM-readable log.
 * The LLM reads this on the post-compact turn to pick up exactly
 * where it left off (vs. blindly trusting the IDE's compressed
 * transcript).
 */
export function appendAutoDecisionLog(input: {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly plan: ConvergencePlan;
}): void {
  // Repair R6: same hand-rolled join as `writePreCompactCheckpoint`. All four
  // session-scoped paths in this file now go through the axis builder; none
  // composes the join itself, so none can resolve outside the project root.
  const dir = join(getSessionDir(input.projectRoot, input.sessionId), 'txt');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const logPath = join(dir, 'auto-decisions.md');
  const row = [
    '',
    `## Auto-compact decision — ${input.plan.createdAt}`,
    `- ratio: ${(input.plan.ratio * 100).toFixed(1)}%`,
    `- checkpoint: ${input.plan.checkpointPath}`,
    `- next-actions: ${input.plan.nextActions.join(' | ')}`,
    `- resume-hint: ${input.plan.resumeHint}`,
    ''
  ].join('\n');
  if (!existsSync(logPath)) {
    writeFileSync(logPath, `# peaks-code auto-decisions log\n${row}`, 'utf8');
    return;
  }
  const existing = readFileSync(logPath, 'utf8');
  writeFileSync(logPath, `${existing}${row}`, 'utf8');
}
/**
 * main-session compact intent so the main-session LLM picks it up on
 * its next turn and fires `/compact` in-band. Without this file the
 * orchestrator's "main-session compact" request is invisible to the
 * main Claude Code window (defeats the whole point of auto-compact
 * for the main context).
 *
 * The file is gitignored under `.peaks/_runtime/<sessionId>/txt/` and
 * is one-shot: the LLM should `mv` it to `.consumed` after firing
 * `/compact`. A re-run will overwrite.
 *
 * write survives, but nothing consumes the file, and its `nextAction` asks
 * for a `/compact` the model cannot invoke (the Skill tool exposes only
 * `/init` and `/security-review`; hooks can observe or veto, never initiate).
 * Retained deliberately for the sibling A2 slice, which owns harness-side
 * state re-injection. Not a capability peaks-loop has today.
 */
export function writeMainSessionCompactIntent(input: {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly ratio: number;
  readonly redLine: boolean;
  readonly now: Date;
}): void {
  const dir = join(getSessionDir(input.projectRoot, input.sessionId), 'txt');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, 'auto-compact-pending.json');
  const payload = {
    schemaVersion: 1,
    pending: true,
    target: 'main',
    requestedAt: input.now.toISOString(),
    ratio: input.ratio,
    redLine: input.redLine,
    nextAction:
      'next LLM turn MUST fire `/compact` then `mv .peaks/_runtime/<sid>/txt/auto-compact-pending.json .peaks/_runtime/<sid>/txt/auto-compact-pending.consumed.json`'
  };
  writeFileSync(path, JSON.stringify(payload, null, 2), 'utf8');
}
/**
 * Write a pre-compact checkpoint. The shape mirrors `peaks session
 * checkpoint` so D7's post-compact-detect picks it up unchanged.
 */
export function writePreCompactCheckpoint(input: {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly now: Date;
  readonly redLine?: boolean;
}): string {
  // Repair R6: this used to hand-roll the session join, which is the one shape
  // `getSessionDir`'s own header records as NOT covered by the guard — an
  // unsafe id resolved outside the project root and the checkpoint was written
  // there. The gate above now refuses an unresolvable id before this point, but
  // `--force` outranks that gate, so this join has to hold on its own.
  const dir = join(getSessionDir(input.projectRoot, input.sessionId), 'checkpoints');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const prefix = input.redLine === true ? 'red-line-' : 'pre-compact-';
  const filename = `${prefix}${input.now.toISOString().replace(/[:.]/g, '-')}.json`;
  const path = join(dir, filename);
  const content = {
    schemaVersion: 1,
    reason: input.redLine === true ? 'pre-compact-red-line' : PRE_COMPACT_REASON,
    sessionId: input.sessionId,
    createdAt: input.now.toISOString(),
    // D7 reads `mode`, `currentPlan`, `openQuestions`, `recentDecisions`
    // out of this JSON. We seed empty arrays; the post-compact LLM
    // rehydrates from the auto-decisions log + open question list.
    mode: 'full-auto',
    currentPlan:
      input.redLine === true
        ? 'RED-LINE compact REQUESTED from the harness (not executed by peaks-loop); work continues'
        : 'auto-compact in progress; resume from auto-decisions.md',
    openQuestions: [] as string[],
    recentDecisions: [] as string[],
    recentArtifactPaths: [] as string[],
    gitStatus: '',
    skillsActive: ['peaks-code'],
    todoState: [] as string[]
  };
  writeFileSync(path, JSON.stringify(content, null, 2), 'utf8');
  return path;
}
