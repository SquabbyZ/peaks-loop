/**
 * Reading the sha256-locked PRD handoff capsule and the project-level security
 * template. Split out of `security-audit-service.ts` so the audit service and
 * the declaration's producer can both depend on the readers without depending
 * on each other.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';

import { resolveHandoffPath } from '../prd/handoff-service.js';

/**
 * Handoff frontmatter — minimal projection of the peaks-prd v2.11.0 handoff
 * frontmatter. We only need sha256 for verification; the rest of the handoff
 * body is consumed by the parent LLM, not by this service.
 */
export interface HandoffFrontmatter {
  readonly sha256: string;
  readonly schemaVersion: number;
}

/**
 * Read the peaks-prd handoff frontmatter + body, verify sha256 matches
 * the body. Returns null on missing file or sha256 mismatch; otherwise
 * returns the parsed frontmatter + body string.
 *
 * Defensive: we read frontmatter via a 1-line regex match, not via
 * a YAML parser. The handoff service (`src/services/prd/handoff-service.ts`)
 * is the canonical writer; we only consume its output here.
 */
export function readAndVerifyHandoff(
  handoffPath: string,
  projectRoot: string
): { frontmatter: HandoffFrontmatter; body: string } | null {
  if (!handoffPath || !isAbsolute(handoffPath)) {
    const absolutePath = resolve(projectRoot, handoffPath);
    if (!existsSync(absolutePath)) return null;
    return readAndVerifyHandoff(absolutePath, projectRoot);
  }
  if (!existsSync(handoffPath)) return null;

  let raw: string;
  try {
    raw = readFileSync(handoffPath, 'utf8');
  } catch {
    // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }

  // Frontmatter pattern: `---` line, then key: value pairs, then `---` line.
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (match === null) return null;

  const frontmatterRaw = match[1]!;
  const body = match[2]!;

  const sha256Match = frontmatterRaw.match(/^sha256:\s*([a-f0-9]{64})\s*$/m);
  const schemaVersionMatch = frontmatterRaw.match(/^schemaVersion:\s*(\d+)\s*$/m);
  if (sha256Match === null || schemaVersionMatch === null) return null;

  const sha256Expected = sha256Match[1]!;
  const schemaVersion = parseInt(schemaVersionMatch[1]!, 10);
  const sha256Actual = createHash('sha256').update(body, 'utf8').digest('hex');

  if (sha256Expected !== sha256Actual) return null;

  return {
    frontmatter: { sha256: sha256Expected, schemaVersion },
    body
  };
}

/**
 * Read the project-level security-template.md. Returns the body
 * string (with frontmatter stripped) or null if the file is absent.
 * Does NOT validate the template content; the parent LLM validates
 * by reading.
 */
export function readSecurityTemplate(projectRoot: string): string | null {
  const templatePath = join(projectRoot, '.peaks', 'project-scan', 'security-template.md');
  if (!existsSync(templatePath)) return null;
  try {
    return readFileSync(templatePath, 'utf8');
  } catch {
    // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }
}

/** The verified handoff's sha256, or `unknown` when there is no capsule. */
export function resolveHandoffHash(projectRoot: string, sessionId: string, rid: string): string {
  const handoffPath = resolveHandoffPath({ projectRoot, sessionId, requestId: rid });
  if (handoffPath === null) return 'unknown';
  return readAndVerifyHandoff(handoffPath, projectRoot)?.frontmatter.sha256 ?? 'unknown';
}
