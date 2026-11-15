/**
 * Reading an existing scan's machine fields back out, and deciding whether it is
 * a shell.
 *
 * Split out of `project-scan-field-refresh.ts` to stay under the `src/**`
 * 300-line cap. The distinction this module owns is the one the refresh turns on:
 * a file that was never populated is a SHELL and may be rewritten without asking;
 * a file with either field populated is SEDIMENT and may not.
 */

import { isMap, parseDocument } from 'yaml';

import { frontmatterOf } from './project-scan-frontmatter.js';

function isEmptyMap(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.keys(value).length === 0;
}

/**
 * The on-disk `techStack` map, as string rows. Anything that is not a plain
 * object of scalars is treated as empty, so a malformed value cannot leak into
 * the merge and be written back as a nested blob.
 */
export function readTechStack(content: string): Record<string, string> {
  const frontmatter = frontmatterOf(content);
  if (frontmatter === null) return {};
  const doc = parseDocument(frontmatter);
  if (doc.errors.length > 0 || !isMap(doc.contents)) return {};
  const parsed = doc.toJS() as Record<string, unknown> | null;
  const techStack = parsed?.['techStack'];
  if (techStack === null || typeof techStack !== 'object' || Array.isArray(techStack)) return {};
  const rows: Record<string, string> = {};
  for (const [key, value] of Object.entries(techStack as Record<string, unknown>)) {
    if (typeof value === 'string') rows[key] = value;
  }
  return rows;
}

/**
 * True when the file was never meaningfully populated: empty `architecture` AND
 * an empty `techStack`. Such a file is a shell, not sediment — the installed
 * base of consumer projects holds them, so it is upgraded without any gesture.
 * A file with EITHER field populated is sediment and refreshes only on request.
 */
export function isUnpopulatedProjectScan(content: string): boolean {
  const frontmatter = frontmatterOf(content);
  if (frontmatter === null) return false;
  const doc = parseDocument(frontmatter);
  if (doc.errors.length > 0 || !isMap(doc.contents)) return false;
  const fields = doc.toJS() as Record<string, unknown> | null;
  if (fields === null) return false;
  const architecture = fields['architecture'];
  const architectureEmpty = typeof architecture !== 'string' || architecture.trim() === '';
  return architectureEmpty && isEmptyMap(fields['techStack']);
}
