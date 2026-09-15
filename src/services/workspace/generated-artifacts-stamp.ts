/**
 * Version stamp for the artifacts `peaks workspace init` generates into a
 * consumer project (G4, 2026-09-15).
 *
 * WHY THIS EXISTS. `initWorkspace` is the only writer of a consumer project's
 * generated config: `.claude/settings.local.json`, the offline
 * `.peaks/.claude-settings-template.json` copy, and the managed `.gitignore`
 * snippet. `ensureSession` early-returns as soon as a session is bound —
 * deliberately, see its own comment — so after the FIRST init nothing ever
 * re-runs the generator. `npm i -g peaks-loop@<newer>` therefore upgrades the
 * CLI and leaves the project's generated config exactly as the OLD release
 * wrote it.
 *
 * `.claude/settings.local.json` IS drift-checked against the current template
 * — but only when something calls `initWorkspace`, which is precisely the
 * event that stopped happening. The escape hatch (`peaks upgrade
 * --apply-init`) is real and idempotent. What was missing is anything that
 * tells the user — or the LLM driving them — that they need it. That is the
 * gap this module closes: a stamp the generator writes, and a detector that
 * can answer "the file on disk was produced by 4.0.40 while the installed
 * peaks-loop is 4.0.49".
 *
 * WHY A SEPARATE FILE AND NOT A KEY INSIDE THE ARTIFACTS.
 * `.claude/settings.local.json` is read by Claude Code, which owns its schema;
 * a version key peaks invented has no contract there and could be rejected or
 * silently ignored — a stamp nobody reads is worse than none. `.peaks/_runtime/`
 * is peaks' own gitignored tree and already holds exactly this kind of
 * machine-local bookkeeping (`session.json`, `.outer-session-cache.json`), so
 * the stamp lives beside them and needs no new `.gitignore` line.
 *
 * WHAT IS COMPARED. Two versions, because they move independently and a
 * mismatch of either means the same thing to the user (regenerate):
 *   - `packageVersion`  — the installed peaks-loop release. Moves on `npm i -g`.
 *   - `templateVersion` — `TEMPLATE_VERSION`, the shape of the hooks tree this
 *     release emits. Can move without a release the user would notice.
 *
 * The stamp records what the generator LAST WROTE. It is not a promise that
 * the on-disk artifacts still match it — a user may have hand-edited
 * `.claude/settings.local.json` since. That question is the existing
 * `templateContentMatches` comparator's, and it is asked on the next init,
 * which is what this detector tells the user to trigger.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CLI_VERSION } from 'peaks-loop-shared/version';

import { isExpectedFsMiss } from '../../shared/fs-utils.js';

import { TEMPLATE_VERSION } from './claude-settings-template.js';

/**
 * Where the stamp lives, relative to the project root.
 *
 * `.peaks/_runtime/` is gitignored by every peaks-loop project already (see
 * the root `.gitignore` snippet), so this file never shows up in
 * `git status` — which matters, because the whole point is that its content
 * changes on the user's machine and not in their repository.
 */
export const GENERATED_ARTIFACTS_STAMP_RELATIVE_PATH = join(
  '.peaks',
  '_runtime',
  'generated-artifacts.json'
);

/**
 * The artifacts whose generation the stamp describes. Used to answer "is
 * there anything on disk that could be stale?" — a project that has never run
 * `peaks workspace init` has nothing to refresh and must not be nagged.
 */
export const GENERATED_ARTIFACT_RELATIVE_PATHS: ReadonlyArray<string> = [
  join('.claude', 'settings.local.json'),
  join('.peaks', '.claude-settings-template.json')
];

export type GeneratedArtifactsStamp = {
  readonly stampVersion: 1;
  readonly packageVersion: string;
  readonly templateVersion: string;
  readonly writtenAt: string;
};

export type GeneratedArtifactsStaleness = {
  /** `true` only when a generated artifact exists AND its stamp is behind. */
  readonly stale: boolean;
  /**
   * Machine-readable reason codes, empty when `stale` is false:
   *   - `package-upgraded`   — on-disk stamp names an older peaks-loop release
   *   - `template-changed`   — on-disk stamp names an older template shape
   *   - `unstamped`          — artifacts exist but predate this stamp
   *   - `stamp-unreadable`   — a stamp file exists but is not parseable
   */
  readonly reasons: ReadonlyArray<string>;
  readonly onDisk: GeneratedArtifactsStamp | null;
  readonly expected: { readonly packageVersion: string; readonly templateVersion: string };
};

export function generatedArtifactsStampPath(projectRoot: string): string {
  return join(projectRoot, GENERATED_ARTIFACTS_STAMP_RELATIVE_PATH);
}

/** Does this project have any generated artifact on disk at all? */
function hasGeneratedArtifact(projectRoot: string): boolean {
  return GENERATED_ARTIFACT_RELATIVE_PATHS.some((rel) => existsSync(join(projectRoot, rel)));
}

/**
 * Read the stamp, or `null` when there is none / it is not the shape this
 * module writes. Tolerant on purpose: a malformed stamp must degrade to
 * "unstamped", never to a crash on the per-turn read path.
 *
 * The catch still NAMES what it tolerates rather than swallowing everything —
 * the same correction the two P1 sites in this slice got (see
 * `isExpectedFsMiss`). A missing file (raced away between `existsSync` and the
 * read) and a stamp we cannot parse both mean "no usable stamp"; a
 * `TypeError` from a broken dependency does not.
 */
export function readGeneratedArtifactsStamp(projectRoot: string): GeneratedArtifactsStamp | null {
  const stampPath = generatedArtifactsStampPath(projectRoot);
  if (!existsSync(stampPath)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(stampPath, 'utf8'));
  } catch (err) {
    if (!isExpectedFsMiss(err) && !(err instanceof SyntaxError)) throw err;
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const candidate = parsed as Record<string, unknown>;
  if (
    typeof candidate['packageVersion'] !== 'string' ||
    typeof candidate['templateVersion'] !== 'string' ||
    typeof candidate['writtenAt'] !== 'string'
  ) {
    return null;
  }
  return {
    stampVersion: 1,
    packageVersion: candidate['packageVersion'],
    templateVersion: candidate['templateVersion'],
    writtenAt: candidate['writtenAt']
  };
}

/**
 * Record what the generator just wrote. Called by `initWorkspace` on every
 * successful materialization — including the one that changes nothing —
 * because the stamp's job is "when did a release last regenerate this
 * project", not "when did the bytes change".
 *
 * `packageVersion` / `now` are injectable so a test can write a deliberately
 * old stamp without touching the clock or the package.
 */
export function writeGeneratedArtifactsStamp(
  projectRoot: string,
  options: { readonly packageVersion?: string; readonly now?: Date } = {}
): GeneratedArtifactsStamp {
  const stamp: GeneratedArtifactsStamp = {
    stampVersion: 1,
    packageVersion: options.packageVersion ?? CLI_VERSION,
    templateVersion: TEMPLATE_VERSION,
    writtenAt: (options.now ?? new Date()).toISOString()
  };
  const stampPath = generatedArtifactsStampPath(projectRoot);
  const dir = dirname(stampPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(stampPath, `${JSON.stringify(stamp, null, 2)}\n`, 'utf8');
  return stamp;
}

/**
 * Is this project's generated config behind the installed peaks-loop?
 *
 * Returns `stale: false` — with no reasons — for the two cases that are NOT
 * staleness:
 *   - the project has no generated artifact at all (never initialized), and
 *   - the stamp matches both expected versions.
 *
 * `unstamped` is reported only when an artifact EXISTS and no stamp does:
 * those are projects initialized by a release that predates this module, and
 * they are exactly the population the defect was reported against.
 */
export function detectStaleGeneratedArtifacts(projectRoot: string): GeneratedArtifactsStaleness {
  const expected = { packageVersion: CLI_VERSION, templateVersion: TEMPLATE_VERSION };
  const onDisk = readGeneratedArtifactsStamp(projectRoot);
  const artifactsPresent = hasGeneratedArtifact(projectRoot);

  if (!artifactsPresent) {
    return { stale: false, reasons: [], onDisk, expected };
  }

  if (existsSync(generatedArtifactsStampPath(projectRoot)) && onDisk === null) {
    return { stale: true, reasons: ['stamp-unreadable'], onDisk, expected };
  }

  if (onDisk === null) {
    return { stale: true, reasons: ['unstamped'], onDisk, expected };
  }

  const reasons: string[] = [];
  if (onDisk.packageVersion !== expected.packageVersion) reasons.push('package-upgraded');
  if (onDisk.templateVersion !== expected.templateVersion) reasons.push('template-changed');

  return { stale: reasons.length > 0, reasons, onDisk, expected };
}
