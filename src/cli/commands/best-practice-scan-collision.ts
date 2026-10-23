/**
 *
 * The best-practice-scan artifact path, the record of which intent owns it,
 * and the refusal that replaced a silent overwrite (§12.3).
 *
 * The path keys on `(date, slug)` and the slug is capped at 32 characters, so
 * two different intents can land on one file. Before this, the second scan
 * silently overwrote the first one's recommendation and both exited 0 — one
 * scan's result was lost, with no error and no warning.
 *
 * The behaviour implemented here is ONE: the second scan REFUSES, naming the
 * collision. The path scheme itself is unchanged, so a scan that collides with
 * nothing still writes exactly where it wrote before.
 *
 * To tell "the same intent again" from "a different intent that landed on the
 * same path", every artifact this command writes starts with an intent-id
 * marker: the exact intent, JSON-encoded, on the first line. The marker is
 * always written FIRST, so a caller-supplied intent cannot forge a match by
 * putting a marker of its own into the text it carries.
 */
import { closeSync, existsSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';

import { fail } from 'peaks-loop-shared/result';

import { printResult, type ProgramIO } from '../cli-helpers.js';

export function bestPracticeDir(projectRoot: string): string {
  return join(projectRoot, 'best-practice');
}

/** `YYYY-MM-DD` is 10 characters, and the slug is capped at 32 so the filename
 *  stays a filename. Both are part of the pinned artifact path. */
const ISO_DATE_LENGTH = 10;
const SLUG_MAX_LENGTH = 32;

/** `<project>/best-practice/<date>-<slug>.md`. The slug is lossy by design:
 *  every character outside `[A-Za-z0-9_-]` collapses to `-` and the result is
 *  truncated to 32, so no intent can introduce a path separator. */
export function scanArtifactPath(projectRoot: string, slugSource: string): string {
  const dateStr = new Date().toISOString().slice(0, ISO_DATE_LENGTH);
  const slug = slugSource.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, SLUG_MAX_LENGTH) || 'intent';
  return join(bestPracticeDir(projectRoot), `${dateStr}-${slug}.md`);
}

/** The first line of every artifact this command writes: the exact intent,
 *  JSON-encoded. It is what tells "the same intent again" from "a different
 *  intent that landed on the same path". */
const INTENT_ID_PREFIX = '<!-- peaks-intent-id: ';
const INTENT_ID_SUFFIX = ' -->';
/** An intent longer than this cannot be read back; such an artifact is unattributable. */
const INTENT_ID_READ_LIMIT = 65_536;

export function intentIdLine(intent: string): string {
  return `${INTENT_ID_PREFIX}${JSON.stringify(intent)}${INTENT_ID_SUFFIX}`;
}

/** The intent the artifact at `path` was written for, or null when it records
 *  none (an artifact written before this marker existed) or cannot be read.
 *
 *  Only the FIRST line is read, and the marker is always written first, so a
 *  caller-supplied intent cannot forge a match by putting a marker of its own
 *  into the text it carries. */
export function readArtifactIntentId(path: string): string | null {
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(INTENT_ID_READ_LIMIT);
    const read = readSync(fd, buffer, 0, INTENT_ID_READ_LIMIT, 0);
    const firstLine = buffer.subarray(0, read).toString('utf8').split('\n')[0] ?? '';
    if (!firstLine.startsWith(INTENT_ID_PREFIX) || !firstLine.endsWith(INTENT_ID_SUFFIX)) {
      return null;
    }
    const encoded = firstLine.slice(
      INTENT_ID_PREFIX.length,
      firstLine.length - INTENT_ID_SUFFIX.length
    );
    let decoded: unknown;
    try {
      decoded = JSON.parse(encoded);
    } catch {
      // A marker that cannot be parsed is a marker that cannot be trusted:
      // `decoded` stays null, so the caller gets "no usable marker" and the
      // refusal stays fail-closed.
      decoded = null;
    }
    return typeof decoded === 'string' ? decoded : null;
  } finally {
    closeSync(fd);
  }
}

/**
 * The collision §12.3 recorded: the artifact path keys on `(date, slug)` and
 * the slug is capped at 32 characters, so two intents that agree in their
 * first 32 slug characters land on one file and the second silently overwrote
 * the first one's recommendation.
 *
 * The same intent again is NOT a collision — it is the same scan re-running,
 * and it overwrites as it always did. An artifact this command cannot
 * attribute is treated as another intent's: the refusal is unconditional,
 * because an artifact that cannot be named cannot be cleared.
 */
export type SlugCollision = {
  readonly project: string;
  readonly intent: string;
  readonly language: string;
  readonly artifactPath: string;
  readonly existingIntent: string | null;
};

/** The collision a scan would cause, or null when it would cause none. */
export function detectSlugCollision(
  project: string,
  intent: string,
  language: string
): SlugCollision | null {
  const primary = scanArtifactPath(project, intent);
  if (!existsSync(primary)) return null;
  const existingIntent = readArtifactIntentId(primary);
  if (existingIntent === intent) return null;
  return { project, intent, language, artifactPath: primary, existingIntent };
}

export const SLUG_COLLISION_MESSAGE =
  'best-practice-scan: SLUG COLLISION — this scan would overwrite an artifact that ' +
  'belongs to another intent, so nothing was written and nothing was overwritten. The ' +
  'artifact path keys on (date, slug) and the slug is capped at 32 characters, so two ' +
  'intents that agree in their first 32 slug characters land on one file.';

/**
 * Refuse a scan whose artifact path is already owned by another intent.
 *
 * Nothing is rendered: the refusal is the whole answer, exactly as the
 * synthetic and no-fragments refusals are.
 */
export function emitSlugCollisionRefusal(
  io: ProgramIO,
  asJson: boolean,
  collision: SlugCollision
): void {
  printResult(
    io,
    fail(
      'best-practice.scan',
      'BEST_PRACTICE_SCAN_SLUG_COLLISION',
      SLUG_COLLISION_MESSAGE,
      {
        project: collision.project,
        intent: collision.intent,
        language: collision.language,
        artifactPath: collision.artifactPath,
        existingIntent: collision.existingIntent,
        collision: true,
        step25: 'skipped-slug-collision'
      },
      [
        'Reword the intent so its first 32 slug characters differ, or delete the artifact that already owns the path',
        `Existing artifact: ${collision.artifactPath}`
      ]
    ),
    asJson
  );
}
