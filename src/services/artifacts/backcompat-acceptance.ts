/**
 * The commit-leg gate for back-compat windows that have CLOSED.
 *
 * `peaks request transition` stays soft on purpose: `missingPrerequisiteWarning`
 * reports a closed window as a warning so the workflow can still reach
 * `qa-handoff` and record the skip. This module is the other boundary. It
 * refuses a closed, missing window unless the tracked acceptance list carries a
 * current entry for that exact `path` + `until` pair.
 *
 * A MISSING LIST IS A FAILURE, NOT AN OPT-OUT. The commit leg is the hard
 * boundary the product asked for, so absence is reported like any other
 * malformed list. The remediation names the seeding path — `peaks workspace
 * init` writes the tracked list — and the LLM performs it; the user speaks or
 * picks, and never hand-authors JSON.
 *
 * WHO EDITS THE LIST. The LLM does, on the user's behalf: the user speaks or
 * picks, and the tracked JSON is a reviewed diff the LLM authors. No message
 * here asks a human to hand-author JSON.
 *
 * WHY THE GATE LIVES HERE AND NOT IN `artifact-prerequisites.ts`. That file is
 * over the file-size cap and a change may only shrink it, so this is the same
 * split its `prerequisite-checks.ts` sibling took. The public name is still
 * exported from `artifact-prerequisites.ts`; that module re-exports it, so
 * every caller keeps one import site.
 *
 * ONE RESOLVER, ONE COMPARATOR. Path resolution and the session-root tiers are
 * the ones the transition uses, and window comparison is
 * `compareReleaseVersions`, so the two legs cannot disagree about whether an
 * artifact exists or where a boundary sits.
 */

import { dirname, join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { pathExists } from 'peaks-loop-shared/fs';

import { CLI_VERSION } from 'peaks-loop-shared/version';

import { isUnsafePathInput } from '../../shared/path-safety.js';
import { compareReleaseVersions, missingPrerequisiteWarning } from './prerequisite-checks.js';
import {
  resolvePrerequisiteAbsolutePathWithFallback,
  sessionRootsFor,
  type SessionRoots
} from './prerequisite-path-resolver.js';
import type { ArtifactPrerequisite, RequestType } from './artifact-prerequisites.js';

/** The one tracked acceptance list. Adding an entry is a reviewed diff the LLM
 *  authors on the user's behalf; no source file keeps a second copy. */
const BACKCOMPAT_ACCEPTANCE_PATH = '.peaks/lint/backcompat-expired-acceptance.json';

type BackCompatAcceptance = {
  path: string;
  until: string;
  reason: string;
  reviewBy: string;
};

type BackCompatAcceptanceList = {
  accepted: BackCompatAcceptance[];
  /** Why the file cannot be believed. A missing file is one of these: the
   *  commit leg is HARD, so absence is reported, never used as an opt-out. */
  problem: string | null;
};

/** Every field an entry must carry, non-empty. `reviewBy` is the one that makes
 *  the list expire, so an entry without it is malformed rather than permissive. */
const REQUIRED_ACCEPTANCE_FIELDS = ['path', 'until', 'reason', 'reviewBy'] as const;

/** How many minor releases ahead of the installed build a `reviewBy` may sit.
 *  A list entry that jumps years ahead accepts without a near-term review, which
 *  is the same "forever" defect in a new field. */
const REVIEW_CAP_MINORS = 2;

/** The seeded list a new project receives, and the reason each window is
 *  accepted. `reviewBy` is DERIVED at seed time from the installed release, so a
 *  project initialized on a release boundary receives a current list rather
 *  than an already-expired one; it is bounded by the same two-minor cap the gate
 *  enforces. */
export function backcompatAcceptanceSeed(installedVersion: string = CLI_VERSION): string {
  const reviewBy = reviewCapFor(installedVersion);
  return JSON.stringify(
    {
      version: 1,
      note: "Expired backCompat windows accepted for the commit leg. The LLM edits this file on the user's behalf (the user only speaks or picks); adding an entry is a reviewed diff and reviewBy is enforced against a two-minor cap.",
      accepted: [
        {
          path: 'mut/mut-report.json',
          until: 'v2.14.0',
          reason:
            'No producer in this build: peaks mut * requires --input-sig (TACT.sig), and peaks tact read is not a registered command (backlog §9.2).',
          reviewBy
        },
        {
          path: 'rd/third-party-review-<rid>.md',
          until: 'v2.15.0',
          reason:
            'No reviewer configured: peaks reviewer status reports no-reviewer-config, and the prerequisite table soft-skips this artifact in that state. Documented deviation: this commit-leg gate does not re-evaluate the reviewer.providers conditional, so the window is accepted here regardless of that config.',
          reviewBy
        }
      ]
    },
    null,
    2
  );
}

function isBackCompatAcceptance(value: unknown): value is BackCompatAcceptance {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return REQUIRED_ACCEPTANCE_FIELDS.every(
    (field) => typeof entry[field] === 'string' && entry[field] !== ''
  );
}

/**
 * The tracked acceptances, or why they cannot be read.
 *
 * ABSENT is a problem, not an opt-out: the commit leg is the hard boundary, so
 * a project that lacks the list is told to seed it. The remediation names the
 * LLM as the actor — `peaks workspace init` seeds the file, and the user never
 * hand-authors JSON.
 */
async function loadBackCompatAcceptances(projectRoot: string): Promise<BackCompatAcceptanceList> {
  const absolute = join(projectRoot, '.peaks', 'lint', 'backcompat-expired-acceptance.json');
  if (!(await pathExists(absolute))) {
    return {
      accepted: [],
      problem: `${BACKCOMPAT_ACCEPTANCE_PATH} is absent. Ask the LLM to run \`peaks workspace init\` to seed the tracked list (the LLM edits it on the user's behalf), or to produce the missing artifacts`
    };
  }
  const unreadable = (why: string): BackCompatAcceptanceList => ({
    accepted: [],
    problem: `${BACKCOMPAT_ACCEPTANCE_PATH} ${why}, so expired back-compat windows cannot be judged`
  });
  let raw: string;
  try {
    raw = await readFile(absolute, 'utf8');
  } catch {
    return unreadable('cannot be read');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return unreadable('is not valid JSON');
  }
  if (parsed === null || typeof parsed !== 'object') {
    return unreadable('is not a JSON object');
  }
  const accepted = (parsed as { accepted?: unknown }).accepted;
  if (!Array.isArray(accepted) || !accepted.every(isBackCompatAcceptance)) {
    return unreadable('does not carry an "accepted" array of path/until/reason/reviewBy entries');
  }
  return { accepted, problem: null };
}

/**
 * Seed the tracked acceptance list for a project that has none. Idempotent: an
 * existing file is never overwritten, so a project's reviewed entries survive
 * every `peaks workspace init`. Called by `initWorkspace`.
 */
export function seedBackCompatAcceptance(projectRoot: string): void {
  const absolute = join(projectRoot, '.peaks', 'lint', 'backcompat-expired-acceptance.json');
  if (existsSync(absolute)) return;
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${backcompatAcceptanceSeed()}\n`, 'utf8');
}

/** One closed window whose artifact is absent. `path` is the DECLARED path
 *  (one key per artifact class); `aliases` are pre-rid keys an upgraded project
 *  may already track. */
type ClosedBackCompatWindow = { path: string; until: string; aliases: (string | undefined)[] };

/** Every `backCompat` requirement whose window has closed while its artifact is
 *  absent. A present artifact is excluded: its body checks belong to the
 *  transition, and an artifact that exists needs no acceptance. */
async function closedBackCompatWindows(
  requirements: ReadonlyArray<ArtifactPrerequisite>,
  installedVersion: string,
  requestId: string,
  roots: SessionRoots
): Promise<ClosedBackCompatWindow[]> {
  const closed: ClosedBackCompatWindow[] = [];
  for (const prerequisite of requirements) {
    const until = prerequisite.backCompatUntil;
    const relative = prerequisite.relativePath;
    const aliases = [prerequisite.legacyRelativePath, ...(prerequisite.legacyRelativePaths ?? [])];
    const softWarning = missingPrerequisiteWarning(prerequisite, relative, installedVersion);
    if (until === undefined || softWarning?.expiredWindow === undefined) continue;
    const absolute = await resolvePrerequisiteAbsolutePathWithFallback(
      roots.canonical,
      roots.legacy,
      prerequisite,
      requestId
    );
    if (absolute === null) closed.push({ path: relative, until, aliases });
  }
  return closed;
}

/** The furthest `reviewBy` this build accepts, as a release string. */
function reviewCapFor(installedVersion: string): string {
  const [major, minor] = installedVersion.replace(/^v/i, '').split(/[.-]/);
  const minorNumber = Number.parseInt(minor ?? '0', 10);
  return `v${major ?? '0'}.${(Number.isNaN(minorNumber) ? 0 : minorNumber) + REVIEW_CAP_MINORS}.0`;
}

/** The accepted entry that covers `window`, or the violation saying why none
 *  does.
 *
 *  `reviewBy` is exclusive (an entry reviewed for this release has reached its
 *  target) and capped (`reviewBy` may sit at most two minors ahead), so a list
 *  that only grows or that jumps far ahead cannot keep accepting. */
function judgeClosedWindow(
  list: BackCompatAcceptanceList,
  window: ClosedBackCompatWindow,
  installedVersion: string
): { accepted: BackCompatAcceptance } | { violation: string } {
  const paths = [window.path, ...window.aliases];
  const entry = list.accepted.find(
    (candidate) => paths.includes(candidate.path) && candidate.until === window.until
  );
  if (entry === undefined) {
    return {
      violation: `expired back-compat window and no current acceptance: ${window.path} — ${window.until} (installed ${installedVersion}); ask the LLM to add an entry to ${BACKCOMPAT_ACCEPTANCE_PATH} with a reason and a future reviewBy (the LLM edits the tracked file on the user's behalf), or produce the artifact`
    };
  }
  if (compareReleaseVersions(installedVersion, entry.reviewBy) >= 0) {
    return {
      violation: `expired back-compat window and no current acceptance: ${window.path} — ${window.until} (installed ${installedVersion}); reviewBy ${entry.reviewBy} has been reached — ask the LLM to renew it with a future reviewBy or produce the artifact`
    };
  }
  const cap = reviewCapFor(installedVersion);
  if (compareReleaseVersions(entry.reviewBy, cap) > 0) {
    return {
      violation: `back-compat acceptance reviewBy is beyond the review cap: ${window.path} — ${window.until}; reviewBy ${entry.reviewBy} is more than ${REVIEW_CAP_MINORS} minor releases ahead of installed ${installedVersion} (cap ${cap}) — ask the LLM to lower reviewBy to ${cap} or earlier`
    };
  }
  return { accepted: entry };
}

export type ExpiredBackCompatCommitGateOptions = {
  projectRoot: string;
  /** The evidence scope. Without one no artifact resolves, so every closed
   *  window is judged missing — the fail-closed answer. */
  sessionId?: string | undefined;
  requestType: RequestType;
  requestId: string;
  /** Injected so a caller can drive both sides of a window boundary; defaults
   *  to the release this build ships. */
  installedVersion?: string | undefined;
};

/**
 * The COMMIT-LEG verdict on back-compat windows that have closed.
 *
 * The table is read through the same accessor the transition uses, and the
 * import is dynamic because `artifact-prerequisites.ts` re-exports this module:
 * a static edge back would close a runtime import cycle. Same idiom, same
 * reason, as the lazy producer imports in `request-commands.ts`.
 */
export async function checkExpiredBackCompatCommitGate(
  options: ExpiredBackCompatCommitGateOptions
): Promise<{ violations: string[]; warnings: string[] }> {
  const { getPrerequisitesFor } = await import('./artifact-prerequisites.js');
  const installedVersion = options.installedVersion ?? CLI_VERSION;
  const softRequirements = getPrerequisitesFor('rd', 'qa-handoff', options.requestType).filter(
    (prerequisite) => prerequisite.backCompat === true
  );
  if (softRequirements.length === 0) return { violations: [], warnings: [] };
  // Same sink guard as `checkPrerequisites`: the session id is joined into both
  // roots below, so an unsafe value is refused where it would be used.
  if (options.sessionId !== undefined && isUnsafePathInput(options.sessionId)) {
    throw new Error(`Invalid session id: ${options.sessionId} (must be a single path segment)`);
  }
  const roots = sessionRootsFor(options.projectRoot, options.sessionId);
  const closed = await closedBackCompatWindows(
    softRequirements,
    installedVersion,
    options.requestId,
    roots
  );
  if (closed.length === 0) return { violations: [], warnings: [] };
  const list = await loadBackCompatAcceptances(options.projectRoot);
  const violations: string[] = list.problem === null ? [] : [list.problem];
  const warnings: string[] = [];
  for (const window of closed) {
    const decision = judgeClosedWindow(list, window, installedVersion);
    if ('accepted' in decision) {
      warnings.push(
        `accepted expired back-compat window: ${window.path} until ${window.until} (installed ${installedVersion}); reviewBy ${decision.accepted.reviewBy} — ${decision.accepted.reason}`
      );
      continue;
    }
    violations.push(decision.violation);
  }
  return { violations, warnings };
}
