/**
 * Building a pre-compact checkpoint that carries enough to resume from.
 *
 * WHY THIS EXISTS. `writePreCompactCheckpoint` used to seed every field empty —
 * `currentPlan` said only "resume from auto-decisions.md", and
 * `openQuestions` / `recentDecisions` / `recentArtifactPaths` were `[]`. The
 * post-compact detector reads exactly those fields, so the resume it enabled had
 * nothing to restore. Measured 2026-11-16: a checkpoint written from a session
 * with an active request and a populated decisions log still contained seven
 * empty fields.
 *
 * The data was never missing — it was on disk and unread. This module reads it
 * and renders it into the shape `post-compact-checkpoint.ts` expects.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not compress, summarize with a
 * model, or truncate conversation history. peaks-loop cannot read the request
 * body and cannot initiate a compact (see the note on
 * `writeMainSessionCompactIntent`); what it CAN do is leave a complete, truthful
 * record of where the work stands, so the post-compact turn resumes instead of
 * re-deriving.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { getSessionDir } from '../session/getSessionDir.js';

/** How many decisions/artifacts a checkpoint carries. Bounded on purpose: a
 *  resume hint longer than this stops being scannable, and the full log stays
 *  on disk for anything older. */
const MAX_RECENT_DECISIONS = 5;
const MAX_RECENT_ARTIFACTS = 8;
const MAX_OPEN_QUESTIONS = 6;

/** One `## Auto-compact decision — <ts>` block from `txt/auto-decisions.md`. */
export type AutoDecisionEntry = {
  readonly decidedAt: string;
  readonly ratio: string | null;
  readonly resumeHint: string | null;
  readonly nextActions: readonly string[];
};

/** Read `txt/auto-decisions.md` and return its blocks, newest last. */
export function readAutoDecisions(projectRoot: string, sessionId: string): AutoDecisionEntry[] {
  const path = join(getSessionDir(projectRoot, sessionId), 'txt', 'auto-decisions.md');
  if (!existsSync(path)) return [];
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  const entries: AutoDecisionEntry[] = [];
  // A block starts at its heading and runs to the next heading or EOF. Parsing
  // line-by-line rather than with a regex keeps a `- key: value` whose value
  // itself contains ` | ` or a colon from being mangled.
  let current: { decidedAt: string; fields: Map<string, string> } | null = null;
  const flush = (): void => {
    if (current === null) return;
    const nextActionsRaw = current.fields.get('next-actions') ?? '';
    entries.push({
      decidedAt: current.decidedAt,
      ratio: current.fields.get('ratio') ?? null,
      resumeHint: current.fields.get('resume-hint') ?? null,
      nextActions: nextActionsRaw === '' ? [] : nextActionsRaw.split(' | ').filter((s) => s !== '')
    });
    current = null;
  };
  for (const line of raw.split('\n')) {
    const heading = /^## Auto-compact decision — (.+)$/.exec(line.trim());
    if (heading !== null) {
      flush();
      current = { decidedAt: (heading[1] ?? '').trim(), fields: new Map() };
      continue;
    }
    if (current === null) continue;
    const field = /^-\s+([a-z-]+):\s*(.*)$/.exec(line.trim());
    if (field !== null && field[1] !== undefined)
      current.fields.set(field[1], (field[2] ?? '').trim());
  }
  flush();
  return entries;
}

/** Files a resume would want to open first: the session's request artifacts. */
function recentArtifactPaths(projectRoot: string, sessionId: string): string[] {
  const sessionDir = getSessionDir(projectRoot, sessionId);
  const found: string[] = [];
  for (const role of ['rd', 'prd', 'qa', 'sc']) {
    const requestsDir = join(sessionDir, role, 'requests');
    if (!existsSync(requestsDir)) continue;
    let names: string[];
    try {
      names = readdirSync(requestsDir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (name.endsWith('.md')) {
        // DERIVED FROM `sessionDir`, never re-composed. A second hand-rolled
        // `.peaks/_runtime/<sid>` join is the bug class the canonical-path scan
        // exists for: it re-implements the layout instead of going through the
        // one function that validates the id, so a future layout change would
        // silently diverge. `sessionDir` is already the canonical root.
        found.push(relative(projectRoot, join(requestsDir, name)).split(sep).join('/'));
      }
    }
  }
  return found.slice(0, MAX_RECENT_ARTIFACTS);
}

/**
 * The populated fields for a checkpoint.
 *
 * `currentPlan` is built from what the session actually recorded — the newest
 * auto-compact decision's resume hint plus its next actions — and falls back to
 * a sentence that still says something true (no decisions yet) rather than the
 * old "resume from auto-decisions.md", which told a resumed turn to go read a
 * file that this checkpoint is supposed to have already summarized.
 */
export function buildCheckpointContent(input: {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly redLine?: boolean;
}): {
  readonly currentPlan: string;
  readonly openQuestions: string[];
  readonly recentDecisions: string[];
  readonly recentArtifactPaths: string[];
} {
  const decisions = readAutoDecisions(input.projectRoot, input.sessionId);
  const newest = decisions.at(-1);

  const planParts: string[] = [];
  if (newest !== undefined) {
    if (newest.resumeHint !== null && newest.resumeHint !== '') {
      planParts.push(newest.resumeHint);
    }
    if (newest.nextActions.length > 0) {
      planParts.push(`Next: ${newest.nextActions.join('; ')}`);
    }
  } else {
    planParts.push(
      'No auto-compact decision recorded yet this session; resume from the newest request artifact below.'
    );
  }
  if (input.redLine === true) {
    planParts.push('RED-LINE compact requested from the harness (not executed by peaks-loop).');
  }

  const recentDecisions = decisions
    .slice(-MAX_RECENT_DECISIONS)
    .reverse()
    .map((entry) => {
      const ratio = entry.ratio === null ? '' : ` @ ${entry.ratio}`;
      const hint = entry.resumeHint === null ? '' : ` — ${entry.resumeHint}`;
      return `${entry.decidedAt}${ratio}${hint}`;
    });

  return {
    currentPlan: planParts.join(' '),
    openQuestions: pendingQuestions(decisions),
    recentDecisions,
    recentArtifactPaths: recentArtifactPaths(input.projectRoot, input.sessionId)
  };
}

/**
 * Questions still open. The only durable record the session keeps is the
 * `next-actions` list of the newest decision, so an outstanding action IS an
 * open question from the resumed turn's point of view: it does not yet know
 * whether that action succeeded. Bounded so the resume stays short.
 */
function pendingQuestions(decisions: readonly AutoDecisionEntry[]): string[] {
  const newest = decisions.at(-1);
  if (newest === undefined) return [];
  return newest.nextActions.slice(0, MAX_OPEN_QUESTIONS);
}
