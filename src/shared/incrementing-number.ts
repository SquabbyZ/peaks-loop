/**
 * Utilities for generating incrementing numbered filenames.
 * Used by session-based artifact storage to create files like 001-feature.md.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The `<NNN>-` prefix family: EXACTLY three digits, anchored at the start. The one
 * definition the counting side (`getNextNumber`), the writing side
 * (`buildNumberedFilename`) and the stripping side (`requestIdFromFileName`) all
 * read, so neither side can widen the family without the others.
 *
 * Three digits is what the writer pads to for every number it can hand out, and a
 * WIDER pattern on the counting side is the whole defect this constant closes: with
 * `^(\d+)-` the leading YEAR of a bare date-shaped name (`2026-10-15-<slug>`) reads
 * as a file number. Four digits is out of family by construction — `\d{3}` is
 * followed by `-`, and `2026-` has a digit there.
 */
export const NUMBERED_PREFIX_RE = /^(\d{3})-/;

/**
 * Get the next available number in a directory.
 * Scans existing .md files and finds the highest IN-FAMILY numeric prefix.
 * Returns 1 if the directory is empty, missing, or holds no in-family name.
 *
 * A name whose leading digits are not a whole prefix in the family — a bare
 * date-shaped name, whose leading digits are a year — is ignored rather than
 * counted, so it can never move the answer.
 *
 * @param dirPath - Directory to scan for numbered files
 * @returns Next available number (1, 2, 3, ...)
 */
export function getNextNumber(dirPath: string): number {
  if (!existsSync(dirPath)) return 1;

  const files = readdirSync(dirPath).filter((f) => f.endsWith('.md'));
  if (files.length === 0) return 1;

  const numbers = files
    .map((f) => {
      const match = NUMBERED_PREFIX_RE.exec(f);
      return match && match[1] ? parseInt(match[1], 10) : NaN;
    })
    .filter((n) => !isNaN(n));

  return numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
}

/**
 * Build a numbered filename from a number and description.
 * Format: 001-description-slug.md
 *
 * @param number - The file number (will be zero-padded to 3 digits)
 * @param description - Human-readable description (converted to kebab-case slug)
 * @returns Formatted filename like "001-feature-name.md"
 */
/**
 * The `<NNN>` prefix in a numbered filename is COSMETIC — but that is a claim about
 * the NUMBER, not about the prefix's WIDTH. The width is `NUMBERED_PREFIX_RE`:
 * exactly three digits, the one family the counting, writing and stripping sides all
 * read. `getNextNumber` scans the directory's highest in-family prefix and adds one,
 * and nothing claims a number in between — so two writers running at once can both
 * read the same maximum and both stamp the same number. That is harmless only
 * because the number is not an identity: what names an artifact is the slug (the
 * request id), and every reader strips a prefix in the family. Measured 2026-10-12:
 * the sole consumers of the number are this module's writer path (`getNextNumber` ->
 * `buildNumberedFilename`) and the read side (`requestIdFromFileName`, which
 * discards it); the artifact service's duplicate check and lookup both key on the
 * slug. Read that as a constraint: give the number a meaning and you must claim it
 * atomically first, rather than assume this scan hands out unique values.
 *
 * WHY THE FAMILY IS STATED RATHER THAN ASSUMED — the defect this replaced. The
 * counting side once matched `^(\d+)-` while the stripping side knew only `^0\d{2}-`.
 * Two patterns on one naming rule disagree from the day they are written, and a
 * directory of nothing but bare date-shaped names is where it showed: the count
 * answered 2027 (the year 2026, plus one), the writer stamped `2027-` onto a fresh
 * artifact, and the stripping side handed back an id carrying a prefix the state
 * machine had never been given. A four-digit prefix is out of family, so
 * `buildNumberedFilename` refuses to write one instead of letting the writer walk
 * past the reader.
 */
// Windows supports up to 255 chars per filename component (and 260 for the
// full path). Pre-#015 the slug was silently truncated to 50 chars, which
// produced orphaned artefacts (the on-disk file no longer matched the
// request-id and the state machine could not find it). 255 is the OS-level
// ceiling; if a requestId exceeds that, `mkdir` / `writeFile` will surface a
// real ENAMETOOLONG error instead of a silent mismatch. We reserve 4 chars
// for the `<NNN>-` numeric prefix and 3 chars for the `.md` suffix, so
// the slug may be at most 248 chars (giving 4 + 248 + 3 = 255 total).
const MAX_FILENAME_LENGTH = 255;
const MAX_FILENAME_SLUG_LENGTH = MAX_FILENAME_LENGTH - 7;

/**
 * Convert a human-readable description into the kebab-case slug used in
 * numbered artifact filenames. Lowercases, collapses non-alphanumerics to
 * `-`, trims leading/trailing dashes, and caps at `MAX_FILENAME_SLUG_LENGTH`.
 *
 * Exported separately so lookup paths (e.g. `request-artifact-service.ts`)
 * can compute the SAME slug the writer produced and match on-disk filenames
 * case-insensitively — the writer lowercases, so a mixed-case request id
 */
export function slugifyDescription(description: string): string {
  return description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, MAX_FILENAME_SLUG_LENGTH);
}

export function buildNumberedFilename(number: number, description: string): string {
  const padded = String(number).padStart(3, '0');
  // The writer is held to the reader's own family. A number with no three-digit
  // spelling (1000 and up) would produce a prefix `requestIdFromFileName` does not
  // strip, and the artifact's id would then disagree with the id it was given —
  // the counting/stripping disagreement on a second axis. Refuse rather than widen
  // the reader: a four-digit prefix on a filename is a year to every reader.
  if (!NUMBERED_PREFIX_RE.test(`${padded}-`)) {
    throw new Error(
      `Cannot number a file ${number}: the prefix family is exactly three digits, and ${padded}- is ` +
        'outside it. A directory that has filled the family needs a second directory, not a fourth digit.'
    );
  }
  const slug = slugifyDescription(description);
  return `${padded}-${slug}.md`;
}

/**
 * The id a markdown artifact's filename carries, or null when the name is not a
 * markdown artifact at all. The READ side of `buildNumberedFilename`, in the same
 * module, so writer and reader cannot drift apart from each other.
 *
 * The prefix it strips is `NUMBERED_PREFIX_RE` — the same family `getNextNumber`
 * counts — so a name the writer produced always reads back as the id it was given.
 * A bare date-shaped stem carries no in-family prefix and is returned verbatim.
 *
 * The returned stem is not yet checked against the id pattern the artifact service
 * owns; a caller that needs a legal request id applies that there rather than the
 * pattern being imported here.
 */
export function requestIdFromFileName(fileName: string): string | null {
  if (!fileName.endsWith('.md')) return null;
  return fileName.replace(NUMBERED_PREFIX_RE, '').replace(/\.md$/, '');
}

/**
 * Get the next numbered file path in a directory.
 * Combines getNextNumber() and buildNumberedFilename().
 *
 * @param dirPath - Directory to scan
 * @param description - Description for the filename
 * @returns Full path to the new numbered file
 */
export function getNextNumberedFilePath(dirPath: string, description: string): string {
  const number = getNextNumber(dirPath);
  const filename = buildNumberedFilename(number, description);
  return join(dirPath, filename);
}
